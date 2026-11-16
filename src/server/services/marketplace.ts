import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { InventoryItem, MarketplaceSale, Prisma } from "@/generated/prisma/client";
import type { MarketplacePlatform } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/db";
import { DomainError, ForbiddenError, NotFoundError, isUniqueViolation } from "@/server/errors";
import { assertCustomer, type Actor } from "@/server/auth/actor";
import { storage } from "@/server/storage";
import { MARKETPLACE_PLATFORM } from "@/lib/labels";
import { audit } from "./audit";
import { sniffMime } from "./files";
import { withEffects, type Effects } from "./notifications";
import { cancelShipmentForPlatform, createShipmentTx, markDroppedOffByPlatform } from "./shipments";
import { addBusinessDays, exactStockMatch, saleStateFrom } from "@/lib/match-title";

/**
 * COMPTES DE VENTE LIÉS (Vinted, Vestiaire Collective)
 * L'extension navigateur « Packio Connect », installée par le client et
 * authentifiée par un jeton personnel, transmet ses annonces, ses ventes et
 * les bordereaux générés par la plateforme. Une vente rattachée à un article
 * du stock crée automatiquement l'expédition chez le préparateur ; le
 * bordereau est joint dès qu'il est disponible.
 */

const TOKEN_PREFIX = "pkx_";
const TOKEN_RE = /^pkx_[A-Za-z0-9_-]{40}$/;
const MAX_ACTIVE_TOKENS = 5;
const MAX_LABEL_BYTES = 5 * 1024 * 1024;
const LABEL_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
/** Format des SKU Packio (cf. inventory.uniqueSku : « SKU- » + 7 caractères Crockford). */
const SKU_RE = /\bSKU-[0-9A-HJKMNP-TV-Z]{7}\b/gi;
const SHIPPED_STATUSES = ["DROPPED_OFF", "IN_TRANSIT", "DELIVERED", "CANCELLED"] as const;

const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");
const platformLabel = (p: MarketplacePlatform) => MARKETPLACE_PLATFORM[p];

// -----------------------------------------------------------------------------
// Jetons de l'extension
// -----------------------------------------------------------------------------

/** Crée un jeton personnel ; la valeur en clair n'est renvoyée qu'une seule fois. */
export async function createExtensionToken(actor: Actor, label: string) {
  const customerId = assertCustomer(actor);
  const name = label.trim().slice(0, 60) || "Extension Packio Connect";
  const active = await db.extensionToken.count({ where: { customerId, revokedAt: null } });
  if (active >= MAX_ACTIVE_TOKENS) {
    throw new DomainError("TOO_MANY_TOKENS", `Vous avez déjà ${MAX_ACTIVE_TOKENS} jetons actifs : révoquez-en un avant d'en créer un nouveau.`);
  }
  const token = TOKEN_PREFIX + randomBytes(30).toString("base64url");
  const row = await db.extensionToken.create({
    data: { customerId, tokenHash: hashToken(token), prefix: token.slice(0, 10), label: name },
  });
  await audit({ actor, action: "extension.token_created", entityType: "customer", entityId: customerId, summary: `${name} (${row.prefix}…)` });
  return { id: row.id, token, prefix: row.prefix, label: row.label };
}

export async function revokeExtensionToken(actor: Actor, id: string) {
  const customerId = assertCustomer(actor);
  const row = await db.extensionToken.findUnique({ where: { id } });
  if (!row || row.customerId !== customerId) throw new NotFoundError("Jeton introuvable.");
  if (row.revokedAt) return row;
  const updated = await db.extensionToken.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit({ actor, action: "extension.token_revoked", entityType: "customer", entityId: customerId, summary: `${row.label} (${row.prefix}…)` });
  return updated;
}

/**
 * Révocation par l'extension de son propre jeton (remplacé lors d'une
 * reconnexion en un clic, ou déconnexion). Sans effet si le jeton est inconnu.
 */
export async function revokeOwnExtensionToken(raw: string | null | undefined): Promise<boolean> {
  if (!raw || !TOKEN_RE.test(raw)) return false;
  const row = await db.extensionToken.findUnique({ where: { tokenHash: hashToken(raw) }, include: { customer: { select: { userId: true } } } });
  if (!row || row.revokedAt) return false;
  await db.extensionToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  await audit({
    actor: { userId: row.customer.userId, role: "CUSTOMER" },
    action: "extension.token_revoked",
    entityType: "customer",
    entityId: row.customerId,
    summary: `${row.label} (${row.prefix}…), révoqué par l'extension`,
  });
  return true;
}

/** Authentifie un appel de l'extension ; renvoie l'identifiant client ou null. */
export async function authenticateExtensionToken(raw: string | null | undefined): Promise<string | null> {
  if (!raw || !TOKEN_RE.test(raw)) return null;
  const row = await db.extensionToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { customer: { select: { id: true, user: { select: { status: true } } } } },
  });
  if (!row || row.revokedAt) return null;
  if (row.customer.user.status !== "ACTIVE") return null;
  // Écriture limitée : au plus une mise à jour toutes les 5 minutes.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 5 * 60 * 1000) {
    await db.extensionToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return row.customerId;
}

// -----------------------------------------------------------------------------
// Synchronisation
// -----------------------------------------------------------------------------

const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());
const cents = z.number().int().min(0).max(100_000_000).optional();

/** Champs facultatifs venant des plateformes : un format inattendu est ignoré, jamais bloquant. */
const optionalDate = z.preprocess((v) => {
  if (v === null || v === undefined || v === "") return undefined;
  const d = new Date(typeof v === "number" && v < 1e12 ? v * 1000 : (v as string));
  return Number.isNaN(d.getTime()) ? undefined : d;
}, z.date().optional());
const looseText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined), z.string().optional());
const optionalId = z.preprocess((v) => (v === null || v === undefined || v === "" ? undefined : String(v)), z.string().trim().max(80).optional());

export const syncPayloadSchema = z.object({
  platform: z.enum(["VINTED", "VESTIAIRE"]),
  account: z.object({ externalUserId: z.coerce.string().trim().min(1).max(80), username: optionalText(120) }),
  listings: z
    .array(
      z.object({
        externalId: z.coerce.string().trim().min(1).max(80),
        title: z.string().trim().min(1).max(300),
        description: optionalText(5000),
        url: optionalText(1000),
        priceCents: cents,
        currency: optionalText(3),
        photoUrl: optionalText(1000),
        status: optionalText(30),
      }),
    )
    .max(500)
    .default([]),
  sales: z
    .array(
      z.object({
        externalOrderId: z.coerce.string().trim().min(1).max(80),
        externalItemId: optionalId,
        title: z.string().trim().min(1).max(300),
        priceCents: cents,
        currency: optionalText(3),
        buyerName: optionalText(120),
        soldAt: z.coerce.date(),
        /** Taille de l'article. */
        size: looseText(40),
        photoUrl: looseText(1000),
        /** Date limite d'envoi indiquée par la plateforme. */
        shipBy: optionalDate,
        /** État de la vente sur la plateforme (texte libre : annulée, envoyée…). */
        status: looseText(60),
        /** Vente en lot : un article par ligne (un seul carton, un seul bordereau). */
        items: z
          .array(
            z.object({
              externalItemId: optionalId,
              title: z.preprocess((v) => (typeof v === "string" ? v.slice(0, 300) : v), z.string().trim().min(1)),
              size: looseText(40),
              photoUrl: looseText(1000),
              priceCents: cents,
            }),
          )
          .max(30)
          .optional()
          .catch(undefined),
      }),
    )
    .max(200)
    .default([]),
});

export type SyncPayload = z.input<typeof syncPayloadSchema>;

/** Délai d'envoi Vinted (jours ouvrés) utilisé quand la plateforme ne transmet pas la date limite. */
const VINTED_SHIP_DAYS = 5;

function findSkus(...texts: (string | undefined)[]) {
  const out = new Set<string>();
  for (const t of texts) for (const m of t?.matchAll(SKU_RE) ?? []) out.add(m[0].toUpperCase());
  return [...out];
}

const httpsOnly = (url: string | undefined | null) => (url && url.startsWith("https://") ? url : null);

/** Articles du stock disponibles pour une prise automatique (hors dropshipping). */
async function availableStock(tx: Tx, customerId: string) {
  return tx.inventoryItem.findMany({
    where: { customerId, dropship: false, quantityAvailable: { gt: 0 } },
    select: { id: true, name: true, quantityAvailable: true },
    orderBy: { receivedAt: "asc" },
    take: 1000,
  });
}

/** Données transmises par l'extension (idempotent : un rejeu ne crée rien de nouveau). */
export async function syncFromExtension(customerId: string, payload: unknown) {
  const data = syncPayloadSchema.parse(payload);
  const platform = data.platform as MarketplacePlatform;
  const now = new Date();
  const result = { listings: 0, linkedListings: 0, newSales: 0, shipmentsCreated: 0, cancelled: 0, shipped: 0 };

  const account = await db.marketplaceAccount.upsert({
    where: { customerId_platform_externalUserId: { customerId, platform, externalUserId: data.account.externalUserId } },
    create: { customerId, platform, externalUserId: data.account.externalUserId, username: data.account.username ?? null, lastSyncAt: now },
    update: { username: data.account.username ?? undefined, lastSyncAt: now },
  });

  // Annonces (rattachement automatique par SKU Packio cité dans l'annonce, pour les anciennes annonces).
  const skus = findSkus(...data.listings.flatMap((l) => [l.title, l.description]));
  const items = skus.length ? await db.inventoryItem.findMany({ where: { customerId, sku: { in: skus } }, select: { id: true, sku: true } }) : [];
  const itemBySku = new Map(items.map((i) => [i.sku.toUpperCase(), i.id]));
  for (const l of data.listings) {
    const existing = await db.marketplaceListing.findUnique({ where: { customerId_platform_externalId: { customerId, platform, externalId: l.externalId } } });
    const autoItem = findSkus(l.title, l.description).map((s) => itemBySku.get(s)).find(Boolean) ?? null;
    const fields = {
      title: l.title,
      url: l.url ?? null,
      priceCents: l.priceCents ?? null,
      currency: (l.currency ?? "eur").toLowerCase(),
      photoUrl: l.photoUrl ?? null,
      status: l.status ?? "active",
      lastSeenAt: now,
    };
    if (existing) {
      const link = !existing.inventoryItemId && autoItem ? { inventoryItemId: autoItem } : {};
      // Une annonce vendue le reste, même si l'extension renvoie un état plus ancien.
      const status = existing.status === "sold" && (await db.marketplaceSale.count({ where: { listingId: existing.id } })) ? "sold" : fields.status;
      await db.marketplaceListing.update({ where: { id: existing.id }, data: { ...fields, status, ...link } });
      if ("inventoryItemId" in link) result.linkedListings++;
    } else {
      await db.marketplaceListing
        .create({ data: { customerId, platform, externalId: l.externalId, ...fields, inventoryItemId: autoItem } })
        .catch((err) => {
          if (!isUniqueViolation(err)) throw err;
        });
      if (autoItem) result.linkedListings++;
    }
    result.listings++;
  }

  // Ventes.
  for (const s of data.sales) {
    const state = saleStateFrom(s.status);
    const bundle = s.items && s.items.length > 1 ? s.items : null;
    const created = await withEffects(async (tx, fx) => {
      const existing = await tx.marketplaceSale.findUnique({ where: { customerId_platform_externalOrderId: { customerId, platform, externalOrderId: s.externalOrderId } } });
      if (existing) {
        // Détails arrivés après coup (taille, date limite, compte) : complétés sans rien écraser.
        const patch: Prisma.MarketplaceSaleUpdateInput = {};
        if (!existing.accountId) patch.account = { connect: { id: account.id } };
        if (!existing.size && s.size) patch.size = s.size;
        if (!existing.photoUrl && httpsOnly(s.photoUrl ?? s.items?.[0]?.photoUrl)) patch.photoUrl = httpsOnly(s.photoUrl ?? s.items?.[0]?.photoUrl);
        if (s.shipBy && (!existing.shipBy || existing.shipByEstimated)) {
          patch.shipBy = s.shipBy;
          patch.shipByEstimated = false;
        }
        if (Object.keys(patch).length) await tx.marketplaceSale.update({ where: { id: existing.id }, data: patch });
        return null;
      }
      const listingOf = async (externalItemId?: string) =>
        externalItemId ? tx.marketplaceListing.findUnique({ where: { customerId_platform_externalId: { customerId, platform, externalId: externalItemId } } }) : null;
      const stock = state === "active" ? await availableStock(tx, customerId) : [];
      // Prise sur le stock : annonce déjà associée à un article, sinon nom identique (un seul article possible).
      const left = new Map(stock.map((i) => [i.id, i.quantityAvailable]));
      const pick = (listingItemId: string | null | undefined, title: string, size?: string | null) => {
        const candidates = stock.filter((i) => (left.get(i.id) ?? 0) > 0);
        const id = (listingItemId && (left.get(listingItemId) ?? 0) > 0 ? listingItemId : null) ?? exactStockMatch(title, size, candidates)?.id ?? null;
        if (id) left.set(id, (left.get(id) ?? 0) - 1);
        return id;
      };
      const listing = bundle ? null : await listingOf(s.externalItemId);
      const lineRows = [];
      if (bundle) {
        for (const [position, line] of bundle.entries()) {
          const l = await listingOf(line.externalItemId);
          lineRows.push({
            position,
            externalItemId: line.externalItemId ?? null,
            title: line.title,
            size: line.size ?? null,
            photoUrl: httpsOnly(line.photoUrl),
            priceCents: line.priceCents ?? null,
            listingId: l?.id ?? null,
            inventoryItemId: state === "active" ? pick(l?.inventoryItemId, line.title, line.size) : null,
          });
        }
      }
      const singleItemId = bundle ? null : state === "active" ? pick(listing?.inventoryItemId, s.title, s.size) : null;
      const matched = bundle ? lineRows.every((l) => l.inventoryItemId) : !!singleItemId;
      const shipBy = s.shipBy ?? (platform === "VINTED" ? addBusinessDays(s.soldAt, VINTED_SHIP_DAYS) : null);
      let sale: MarketplaceSale;
      try {
        sale = await tx.marketplaceSale.create({
          data: {
            customerId,
            platform,
            accountId: account.id,
            externalOrderId: s.externalOrderId,
            listingId: listing?.id ?? null,
            title: s.title,
            priceCents: s.priceCents ?? null,
            currency: (s.currency ?? "eur").toLowerCase(),
            buyerName: s.buyerName ?? null,
            soldAt: s.soldAt,
            size: s.size ?? null,
            photoUrl: httpsOnly(s.photoUrl ?? bundle?.[0]?.photoUrl ?? listing?.photoUrl),
            shipBy,
            shipByEstimated: !s.shipBy && !!shipBy,
            // Ventes déjà annulées ou déjà parties au moment où Packio les découvre : rangées, sans alerte.
            status: state === "cancelled" ? "CANCELLED" : state === "shipped" ? "SHIPPED_ELSEWHERE" : matched ? "MATCHED" : "NEW",
            cancelledAt: state === "cancelled" ? now : null,
            platformShippedAt: state === "shipped" ? now : null,
            inventoryItemId: singleItemId,
            lines: lineRows.length ? { create: lineRows } : undefined,
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) return null;
        throw err;
      }
      for (const id of [listing?.id, ...lineRows.map((l) => l.listingId)]) {
        if (id) await tx.marketplaceListing.updateMany({ where: { id, status: { not: "sold" } }, data: { status: "sold" } });
      }
      if (state !== "active") return sale;
      const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: customerId }, select: { userId: true } });
      const price = sale.priceCents !== null ? ` (${(sale.priceCents / 100).toLocaleString("fr-FR", { style: "currency", currency: sale.currency.toUpperCase() })})` : "";
      const what = bundle ? `Lot de ${bundle.length} articles vendu${price}` : `Vendu${price}`;
      fx.notify(customer.userId, {
        type: "MARKETPLACE_SALE",
        title: `Vente ${platformLabel(platform)} : « ${sale.title} »`,
        body: matched
          ? `${what}. Pris dans votre stock : votre préparateur l'expédie ; le bordereau sera joint dès qu'il sera généré sur ${platformLabel(platform)}.`
          : `${what}. Dans « Toutes mes ventes », choisissez : vente normale, vente dropshipping ou supprimer.`,
        link: "/client/ventes",
        forceEmail: true,
      });
      return sale;
    });
    if (created) {
      if (created.status !== "CANCELLED" && created.status !== "SHIPPED_ELSEWHERE") result.newSales++;
      if (created.status === "MATCHED" && (await tryCreateSaleShipment(created.id))) result.shipmentsCreated++;
      continue;
    }
    // Vente déjà connue : l'annulation ou le départ du colis est suivi.
    const known = await db.marketplaceSale.findUnique({ where: { customerId_platform_externalOrderId: { customerId, platform, externalOrderId: s.externalOrderId } }, select: { id: true } });
    if (!known) continue;
    if (state === "cancelled" && (await handlePlatformCancellation(known.id))) result.cancelled++;
    if (state === "shipped" && (await handlePlatformShipped(known.id))) result.shipped++;
  }
  return result;
}

/** Statuts d'une commande en dropshipping encore attendue chez le préparateur. */
const DROPSHIP_ORDER_PENDING = ["REGISTERED", "SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER", "PICKED_UP", "RECEIVED", "QUALITY_CHECK"];

/**
 * Vente annulée sur la plateforme : l'expédition est bloquée si le colis n'est
 * pas encore déposé, l'article reste en stock, client et préparateur sont
 * prévenus. Renvoie true si l'annulation vient d'être prise en compte.
 */
export async function handlePlatformCancellation(saleId: string): Promise<boolean> {
  return withEffects(async (tx, fx) => {
    const sale = await lockSale(tx, saleId);
    if (sale.cancelledAt || sale.status === "IGNORED" || sale.status === "SHIPPED_ELSEWHERE") return false;
    const platform = platformLabel(sale.platform);
    const order = sale.dropshipOrderId ? await tx.supplierOrder.findUnique({ where: { id: sale.dropshipOrderId } }) : null;
    const shipmentId = sale.shipmentId ?? order?.dropshipShipmentId ?? null;
    const outcome = shipmentId ? await cancelShipmentForPlatform(tx, fx, shipmentId, `Vente ${platform} n° ${sale.externalOrderId} annulée`) : null;
    const dropshipPending = !!order && DROPSHIP_ORDER_PENDING.includes(order.status);
    const dropshipInStock = !!order && order.status === "IN_STOCK" && outcome !== "too_late";
    const body =
      outcome === "too_late"
        ? `Le colis était déjà parti : voyez avec l'acheteur et ${platform} pour le retour.`
        : dropshipPending
          ? `Votre commande en dropshipping ${order.reference} est en route : annulez-la chez le fournisseur si c'est encore possible. À son arrivée, vous choisirez de garder l'article en stock ou de le renvoyer au fournisseur.`
          : dropshipInStock
            ? "L'expédition est bloquée. L'article est chez votre préparateur : choisissez de le garder en stock ou de le renvoyer au fournisseur."
            : outcome === "cancelled"
              ? "L'expédition a été bloquée avant le dépôt : l'article reste dans votre stock chez votre préparateur."
              : "Rien à faire : elle est retirée de vos ventes à traiter.";
    await tx.marketplaceSale.update({
      where: { id: sale.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), notes: outcome === "too_late" ? "Annulée après le dépôt du colis : retour à voir avec l'acheteur." : null },
    });
    if (dropshipPending) {
      const prep = await tx.preparerProfile.findUniqueOrThrow({ where: { id: order.preparerId }, select: { userId: true } });
      fx.notify(prep.userId, {
        type: "ORDER_UPDATED",
        title: "Vente annulée : ne pas expédier",
        body: `${order.reference} : la vente ${platform} a été annulée. À réception, mettez l'article en stock sans l'expédier ; le client choisira quoi en faire.`,
        link: `/preparateur/receptions/${order.id}`,
      });
    }
    const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: sale.customerId }, select: { userId: true } });
    fx.notify(customer.userId, {
      type: "MARKETPLACE_SALE_CANCELLED",
      title: `Vente annulée : « ${sale.title} »`,
      body: `${platform} indique que la vente n° ${sale.externalOrderId} est annulée. ${body}`,
      link: "/client/ventes?ventes=annulees",
      forceEmail: true,
    });
    await audit({ actor: { userId: customer.userId, role: "CUSTOMER" }, action: "marketplace.sale_cancelled", entityType: "customer", entityId: sale.customerId, summary: `Vente ${platform} n° ${sale.externalOrderId} annulée (${outcome ?? "sans expédition"})` }, tx);
    return true;
  });
}

/**
 * La plateforme indique le colis parti : l'expédition Packio est marquée
 * déposée si le préparateur ne l'a pas encore fait ; une vente jamais traitée
 * a été expédiée par le client lui-même (« Expédiée hors Packio »).
 */
export async function handlePlatformShipped(saleId: string): Promise<boolean> {
  return withEffects(async (tx, fx) => {
    const sale = await lockSale(tx, saleId);
    if (sale.platformShippedAt || ["IGNORED", "CANCELLED", "SHIPPED_ELSEWHERE"].includes(sale.status)) return false;
    const now = new Date();
    const order = sale.dropshipOrderId ? await tx.supplierOrder.findUnique({ where: { id: sale.dropshipOrderId } }) : null;
    const shipmentId = sale.shipmentId ?? order?.dropshipShipmentId ?? null;
    if (!shipmentId && !order) {
      await tx.marketplaceSale.update({ where: { id: sale.id }, data: { status: "SHIPPED_ELSEWHERE", platformShippedAt: now, notes: null } });
      return true;
    }
    if (shipmentId) await markDroppedOffByPlatform(tx, fx, shipmentId, platformLabel(sale.platform));
    await tx.marketplaceSale.update({ where: { id: sale.id }, data: { platformShippedAt: now } });
    return true;
  });
}

/**
 * Crée l'expédition d'une vente rattachée (une seule fois). Sans stock
 * disponible ou sans préparateur, la vente reste « Article identifié » avec
 * une note, sans bloquer la synchronisation.
 */
async function tryCreateSaleShipment(saleId: string): Promise<boolean> {
  try {
    return await withEffects(async (tx, fx) => {
      const sale = await lockSale(tx, saleId);
      if (sale.status !== "MATCHED" || sale.shipmentId) return false;
      const lines = await tx.marketplaceSaleLine.findMany({ where: { saleId }, orderBy: { position: "asc" } });
      const ids = lines.length ? lines.map((l) => l.inventoryItemId) : [sale.inventoryItemId];
      if (ids.some((id) => !id)) return false;
      const counts = new Map<string, number>();
      for (const id of ids as string[]) counts.set(id, (counts.get(id) ?? 0) + 1);
      const items = await tx.inventoryItem.findMany({ where: { id: { in: [...counts.keys()] } } });
      const label = await tx.file.findFirst({ where: { marketplaceSaleId: sale.id, purpose: "SHIPPING_LABEL", shipmentId: null, deletedAt: null }, orderBy: { createdAt: "desc" } });
      return createSaleShipmentTx(
        tx,
        fx,
        sale,
        items.map((item) => ({ item, quantity: counts.get(item.id)! })),
        label?.id ?? null,
      );
    });
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    await db.marketplaceSale.update({ where: { id: saleId }, data: { notes: `Expédition non créée : ${err.message}`.slice(0, 500) } });
    return false;
  }
}

async function lockSale(tx: Tx, saleId: string) {
  await tx.$queryRaw`SELECT "id" FROM "marketplace_sales" WHERE "id" = ${saleId} FOR UPDATE`;
  const sale = await tx.marketplaceSale.findUnique({ where: { id: saleId } });
  if (!sale) throw new NotFoundError("Vente introuvable.");
  return sale;
}

async function createSaleShipmentTx(tx: Tx, fx: Effects, sale: MarketplaceSale, picks: { item: InventoryItem; quantity: number }[], labelFileId: string | null): Promise<boolean> {
  const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: sale.customerId }, select: { userId: true, currentPreparerId: true } });
  if (!customer.currentPreparerId) {
    throw new DomainError("NO_PREPARER", "Aucun préparateur n'est attribué à votre compte.");
  }
  if (!picks.length) throw new DomainError("NO_ITEMS", "Choisissez l'article vendu.");
  for (const { item, quantity } of picks) {
    if (item.customerId !== sale.customerId) throw new ForbiddenError();
    if (item.quantityAvailable < quantity) throw new DomainError("STOCK", `« ${item.name} » n'est plus disponible en stock.`);
  }
  const platform = platformLabel(sale.platform);
  const account = sale.accountId ? await tx.marketplaceAccount.findUnique({ where: { id: sale.accountId }, select: { username: true, externalUserId: true } }) : null;
  const count = picks.reduce((s, p) => s + p.quantity, 0);
  const details = [
    `Vente ${platform} n° ${sale.externalOrderId}`,
    account ? `compte ${account.username ?? account.externalUserId}` : null,
    count > 1 ? `lot de ${count} articles dans un seul carton` : null,
    sale.size ? `taille ${sale.size}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const shipment = await createShipmentTx(tx, fx, {
    customerId: sale.customerId,
    actorUserId: customer.userId,
    system: true,
    kind: "SALE",
    items: picks.map((p) => ({ itemId: p.item.id, quantity: p.quantity })),
    recipientName: sale.buyerName ?? `Acheteur ${platform}`,
    addressLine1: "Adresse indiquée sur le bordereau",
    postalCode: "",
    city: "Voir bordereau",
    country: "FR",
    labelMode: labelFileId ? "CUSTOMER_PROVIDED" : "PREPARER_PROVIDED",
    labelFileId,
    dueAt: sale.shipBy,
    instructions: `${details}${labelFileId ? "" : " : bordereau joint automatiquement dès sa génération par le client"}`,
  });
  await tx.marketplaceSale.update({ where: { id: sale.id }, data: { status: "SHIPMENT_CREATED", shipmentId: shipment.id, notes: null } });
  return true;
}

// -----------------------------------------------------------------------------
// Bordereaux
// -----------------------------------------------------------------------------

export async function attachSaleLabel(customerId: string, input: { platform: MarketplacePlatform; externalOrderId: string; filename: string; data: Buffer }) {
  if (input.data.length === 0) throw new DomainError("EMPTY", "Fichier vide.");
  if (input.data.length > MAX_LABEL_BYTES) throw new DomainError("TOO_LARGE", "Bordereau trop volumineux (5 Mo maximum).");
  const mime = sniffMime(input.data);
  if (!mime || !LABEL_TYPES.includes(mime)) throw new DomainError("TYPE", "Format de bordereau non autorisé (PDF, JPEG, PNG ou WebP).");
  const sha256 = createHash("sha256").update(input.data).digest("hex");

  const sale = await db.marketplaceSale.findUnique({
    where: { customerId_platform_externalOrderId: { customerId, platform: input.platform, externalOrderId: input.externalOrderId } },
  });
  if (!sale) throw new NotFoundError("Vente inconnue : synchronisez d'abord vos ventes.");
  // Vente supprimée par le client : le bordereau (adresse de l'acheteur) n'est pas conservé.
  if (sale.status === "IGNORED") return { fileId: null, duplicate: false, shipmentId: null, ignored: true };

  const duplicate = await db.file.findFirst({ where: { marketplaceSaleId: sale.id, sha256, deletedAt: null } });
  if (duplicate) return { fileId: duplicate.id, duplicate: true, shipmentId: sale.shipmentId };

  const customer = await db.customerProfile.findUniqueOrThrow({ where: { id: customerId }, select: { userId: true, currentPreparerId: true } });
  const ext = mime === "application/pdf" ? "pdf" : mime.split("/")[1];
  const storageKey = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
  await storage().put(storageKey, input.data, mime);
  const filename = (input.filename.split(/[\\/]/).pop() ?? "bordereau").replace(/[^\p{L}\p{N}._\- ]/gu, "_").slice(0, 120) || "bordereau";

  const outcome = await withEffects(async (tx, fx) => {
    const locked = await lockSale(tx, sale.id);
    const again = await tx.file.findFirst({ where: { marketplaceSaleId: sale.id, sha256, deletedAt: null } });
    if (again) return { fileId: again.id, duplicate: true, shipmentId: locked.shipmentId };
    // Vente en dropshipping : le bordereau suit la commande, puis son expédition à l'acheteur.
    const dropOrder = locked.dropshipOrderId ? await tx.supplierOrder.findUnique({ where: { id: locked.dropshipOrderId } }) : null;
    const shipmentId = locked.shipmentId ?? dropOrder?.dropshipShipmentId ?? null;
    const shipment = shipmentId ? await tx.outboundShipment.findUnique({ where: { id: shipmentId } }) : null;
    const file = await tx.file.create({
      data: {
        storageKey,
        filename,
        mimeType: mime,
        sizeBytes: input.data.length,
        sha256,
        purpose: "SHIPPING_LABEL",
        uploadedById: customer.userId,
        customerId,
        preparerId: shipment?.preparerId ?? customer.currentPreparerId,
        marketplaceSaleId: sale.id,
        shipmentId: shipment?.id ?? null,
        supplierOrderId: !shipment && dropOrder && dropOrder.status !== "CANCELLED" ? dropOrder.id : null,
      },
    });
    if (shipment) {
      if (!(SHIPPED_STATUSES as readonly string[]).includes(shipment.status)) {
        if (shipment.labelMode === "PREPARER_PROVIDED") {
          await tx.outboundShipment.update({ where: { id: shipment.id }, data: { labelMode: "CUSTOMER_PROVIDED" } });
        }
        await tx.shipmentEvent.create({ data: { shipmentId: shipment.id, status: shipment.status, actorId: customer.userId, note: `Bordereau ${platformLabel(locked.platform)} ajouté automatiquement` } });
        const prep = await tx.preparerProfile.findUniqueOrThrow({ where: { id: shipment.preparerId }, select: { userId: true } });
        fx.notify(prep.userId, {
          type: "SHIPMENT_UPDATED",
          title: "Bordereau disponible",
          body: `${shipment.reference} : le bordereau ${platformLabel(locked.platform)} est disponible, il suffit de l'imprimer.`,
          link: `/preparateur/expeditions/${shipment.id}`,
        });
      }
      return { fileId: file.id, duplicate: false, shipmentId: shipment.id };
    }
    if (dropOrder && dropOrder.status !== "CANCELLED") {
      const prep = await tx.preparerProfile.findUniqueOrThrow({ where: { id: dropOrder.preparerId }, select: { userId: true } });
      fx.notify(prep.userId, {
        type: "SHIPMENT_UPDATED",
        title: "Bordereau reçu (dropshipping)",
        body: `${dropOrder.reference} : le bordereau ${platformLabel(locked.platform)} est arrivé ; il sera joint à l'expédition dès la réception de l'article.`,
        link: `/preparateur/receptions/${dropOrder.id}`,
      });
    }
    return { fileId: file.id, duplicate: false, shipmentId: null as string | null, pending: locked.status === "MATCHED" };
  });

  if (!outcome.duplicate && !outcome.shipmentId && "pending" in outcome && outcome.pending) {
    if (await tryCreateSaleShipment(sale.id)) {
      const updated = await db.marketplaceSale.findUniqueOrThrow({ where: { id: sale.id }, select: { shipmentId: true } });
      return { fileId: outcome.fileId, duplicate: false, shipmentId: updated.shipmentId };
    }
  }
  return { fileId: outcome.fileId, duplicate: outcome.duplicate, shipmentId: outcome.shipmentId };
}

// -----------------------------------------------------------------------------
// Actions du client
// -----------------------------------------------------------------------------

async function ownItem(customerId: string, itemId: string) {
  const item = await db.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item || item.customerId !== customerId) throw new NotFoundError("Article introuvable.");
  if (item.dropship) throw new DomainError("DROPSHIP", "Un article en dropshipping ne peut pas être rattaché à une annonce.");
  return item;
}

/** Rattache (ou détache) une annonce à un article du stock ; traite ses ventes en attente. */
export async function linkListingToItem(actor: Actor, input: { listingId: string; itemId: string | null }) {
  const customerId = assertCustomer(actor);
  const listing = await db.marketplaceListing.findUnique({ where: { id: input.listingId } });
  if (!listing || listing.customerId !== customerId) throw new NotFoundError("Annonce introuvable.");
  const item = input.itemId ? await ownItem(customerId, input.itemId) : null;
  await db.marketplaceListing.update({ where: { id: listing.id }, data: { inventoryItemId: item?.id ?? null } });
  let shipments = 0;
  if (item) {
    const pending = await db.marketplaceSale.findMany({ where: { customerId, listingId: listing.id, status: "NEW" }, orderBy: { soldAt: "asc" } });
    for (const sale of pending) {
      await db.marketplaceSale.update({ where: { id: sale.id }, data: { inventoryItemId: item.id, status: "MATCHED" } });
      if (await tryCreateSaleShipment(sale.id)) shipments++;
    }
  }
  return { shipments };
}

/** Associe une vente à un article du stock, puis crée l'expédition. */
export async function matchSaleToItem(actor: Actor, input: { saleId: string; itemId: string }) {
  return matchSaleToItems(actor, { saleId: input.saleId, itemIds: [input.itemId] });
}

/**
 * « Vente normale » : le client indique le ou les articles vendus (un par
 * article du lot) ; l'expédition part en un seul carton, avec un seul bordereau.
 */
export async function matchSaleToItems(actor: Actor, input: { saleId: string; itemIds: string[] }) {
  const customerId = assertCustomer(actor);
  const sale = await db.marketplaceSale.findUnique({ where: { id: input.saleId }, include: { lines: { orderBy: { position: "asc" } } } });
  if (!sale || sale.customerId !== customerId) throw new NotFoundError("Vente introuvable.");
  if (sale.shipmentId || sale.status === "SHIPMENT_CREATED") throw new DomainError("ALREADY_SHIPPED", "Une expédition existe déjà pour cette vente.");
  if (sale.status === "CANCELLED") throw new DomainError("CANCELLED", "Cette vente a été annulée.");
  if (sale.status === "SHIPPED_ELSEWHERE") throw new DomainError("SHIPPED_ELSEWHERE", "Ce colis est déjà parti en dehors de Packio.");
  if (sale.status === "IGNORED") throw new DomainError("DELETED", "Cette vente a été supprimée.");
  if (sale.status === "DROPSHIP" || sale.dropshipOrderId) throw new DomainError("DROPSHIP", "Cette vente est déjà traitée en dropshipping.");
  const wanted = sale.lines.length || 1;
  const ids = input.itemIds.filter(Boolean);
  if (ids.length !== wanted) {
    throw new DomainError("ITEMS", wanted > 1 ? `Choisissez un article de votre stock pour chacun des ${wanted} articles du lot.` : "Choisissez l'article vendu.");
  }
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, qty] of counts) {
    const item = await ownItem(customerId, id);
    if (item.quantityAvailable < qty) throw new DomainError("STOCK", `« ${item.name} » n'est plus disponible en stock (${item.quantityAvailable} disponible(s)).`);
  }
  if (sale.lines.length) {
    for (const [i, line] of sale.lines.entries()) {
      await db.marketplaceSaleLine.update({ where: { id: line.id }, data: { inventoryItemId: ids[i] } });
      if (line.listingId) await db.marketplaceListing.updateMany({ where: { id: line.listingId, inventoryItemId: null }, data: { inventoryItemId: ids[i] } });
    }
    await db.marketplaceSale.update({ where: { id: sale.id }, data: { status: "MATCHED", notes: null } });
  } else {
    await db.marketplaceSale.update({ where: { id: sale.id }, data: { inventoryItemId: ids[0], status: "MATCHED", notes: null } });
    if (sale.listingId) await db.marketplaceListing.updateMany({ where: { id: sale.listingId, inventoryItemId: null }, data: { inventoryItemId: ids[0] } });
  }
  const created = await tryCreateSaleShipment(sale.id);
  if (!created) {
    const after = await db.marketplaceSale.findUniqueOrThrow({ where: { id: sale.id } });
    throw new DomainError("SHIPMENT", after.notes ?? "L'expédition n'a pas pu être créée.");
  }
  return db.marketplaceSale.findUniqueOrThrow({ where: { id: sale.id } });
}

export type ManualSaleInput = {
  platform: MarketplacePlatform;
  title: string;
  externalOrderId?: string | null;
  priceCents?: number | null;
  buyerName?: string | null;
  size?: string | null;
  shipBy?: Date | null;
  labelFileId?: string | null;
};

/**
 * Vente ajoutée à la main (sans l'extension) : elle rejoint « Toutes mes
 * ventes » avec les mêmes boutons. Le bordereau éventuel suit l'expédition.
 */
export async function createManualSale(actor: Actor, input: ManualSaleInput) {
  const customerId = assertCustomer(actor);
  const externalOrderId = input.externalOrderId?.trim() || `MANUEL-${randomBytes(4).toString("hex").toUpperCase()}`;
  const label = input.labelFileId ? await db.file.findUnique({ where: { id: input.labelFileId } }) : null;
  if (input.labelFileId) {
    const owned = label && (label.customerId ? label.customerId === customerId : label.uploadedById === actor.userId);
    if (!label || !owned || label.shipmentId || label.marketplaceSaleId || label.deletedAt || !LABEL_TYPES.includes(label.mimeType)) {
      throw new DomainError("LABEL", "Bordereau invalide.", { fieldErrors: { labelFileIds: "Bordereau invalide" } });
    }
  }
  const sale = await withEffects(async (tx) => {
    const stock = await availableStock(tx, customerId);
    const itemId = exactStockMatch(input.title, input.size, stock)?.id ?? null;
    let created: MarketplaceSale;
    try {
      created = await tx.marketplaceSale.create({
        data: {
          customerId,
          platform: input.platform,
          externalOrderId,
          title: input.title.trim(),
          priceCents: input.priceCents ?? null,
          buyerName: input.buyerName?.trim() || null,
          size: input.size?.trim() || null,
          shipBy: input.shipBy ?? null,
          soldAt: new Date(),
          manual: true,
          status: itemId ? "MATCHED" : "NEW",
          inventoryItemId: itemId,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new DomainError("DUPLICATE", "Cette vente existe déjà dans Packio.", { fieldErrors: { externalOrderId: "Déjà enregistrée" } });
      throw err;
    }
    if (label) await tx.file.update({ where: { id: label.id }, data: { marketplaceSaleId: created.id, customerId, purpose: "SHIPPING_LABEL" } });
    await audit({ actor, action: "marketplace.sale_added", entityType: "customer", entityId: customerId, summary: `Vente ${platformLabel(input.platform)} ajoutée à la main : ${created.title}` }, tx);
    return created;
  });
  if (sale.status === "MATCHED") await tryCreateSaleShipment(sale.id);
  return db.marketplaceSale.findUniqueOrThrow({ where: { id: sale.id } });
}

/**
 * Vente annulée alors que l'article (commandé en dropshipping) est déjà chez
 * le préparateur : le client le garde dans son stock (il occupe alors une
 * place). Pour le renvoyer au fournisseur, il passe par une expédition.
 */
export async function keepCancelledSaleItems(actor: Actor, saleId: string) {
  const customerId = assertCustomer(actor);
  const sale = await db.marketplaceSale.findUnique({ where: { id: saleId } });
  if (!sale || sale.customerId !== customerId) throw new NotFoundError("Vente introuvable.");
  if (sale.status !== "CANCELLED" || !sale.dropshipOrderId) throw new DomainError("STATE", "Rien à garder en stock pour cette vente.");
  const res = await db.inventoryItem.updateMany({ where: { customerId, supplierOrderId: sale.dropshipOrderId, dropship: true, quantityAvailable: { gt: 0 } }, data: { dropship: false } });
  await audit({ actor, action: "marketplace.cancelled_kept", entityType: "customer", entityId: customerId, summary: `${res.count} article(s) gardé(s) en stock après annulation de la vente ${sale.externalOrderId}` });
  return { kept: res.count };
}

/**
 * « Supprimer » : vente sans rapport avec Packio (article expédié par le client
 * lui-même). Le nom de l'acheteur et les bordereaux sont effacés ; seule une
 * trace minimale (plateforme, n° de commande, titre) est conservée pour que la
 * synchronisation ne recrée pas la vente.
 */
export async function deleteSale(actor: Actor, saleId: string) {
  const customerId = assertCustomer(actor);
  return withEffects(async (tx, fx) => {
    const sale = await lockSale(tx, saleId);
    if (sale.customerId !== customerId) throw new NotFoundError("Vente introuvable.");
    if (sale.status === "IGNORED") return sale;
    if (sale.dropshipOrderId) {
      const order = await tx.supplierOrder.findUnique({ where: { id: sale.dropshipOrderId }, select: { status: true } });
      if (order && order.status !== "CANCELLED") {
        throw new DomainError("ALREADY_SHIPPED", "Une commande en dropshipping existe pour cette vente : annulez-la d'abord depuis la page de la commande.");
      }
    }
    if (sale.shipmentId) {
      const shipment = await tx.outboundShipment.findUnique({ where: { id: sale.shipmentId }, select: { status: true } });
      if (shipment && shipment.status !== "CANCELLED") {
        throw new DomainError("ALREADY_SHIPPED", "Cette vente est expédiée par Packio : annulez d'abord l'expédition depuis sa page.");
      }
    }
    const labels = await tx.file.findMany({ where: { marketplaceSaleId: sale.id, deletedAt: null }, select: { id: true, storageKey: true } });
    if (labels.length) {
      await tx.file.updateMany({ where: { id: { in: labels.map((l) => l.id) } }, data: { deletedAt: new Date() } });
      fx.after(async () => {
        for (const l of labels) await storage().delete(l.storageKey);
      });
    }
    const updated = await tx.marketplaceSale.update({ where: { id: sale.id }, data: { status: "IGNORED", buyerName: null, notes: null, inventoryItemId: null } });
    await audit(
      { actor, action: "marketplace.sale_deleted", entityType: "customer", entityId: customerId, summary: `Vente ${platformLabel(sale.platform)} n° ${sale.externalOrderId} supprimée (non expédiée par Packio)` },
      tx,
    );
    return updated;
  });
}

// -----------------------------------------------------------------------------
// Lectures
// -----------------------------------------------------------------------------

export const SALE_FILTERS = ["toutes", "a-traiter", "packio", "dropshipping", "annulees"] as const;
export type SaleFilter = (typeof SALE_FILTERS)[number];

const PENDING_SALE: Prisma.MarketplaceSaleWhereInput = { status: { in: ["NEW", "MATCHED"] }, shipmentId: null, dropshipOrderId: null };
const saleFilterWhere: Record<SaleFilter, Prisma.MarketplaceSaleWhereInput> = {
  toutes: { status: { not: "IGNORED" } },
  "a-traiter": PENDING_SALE,
  packio: { shipmentId: { not: null }, status: { notIn: ["IGNORED", "DROPSHIP", "CANCELLED"] } },
  dropshipping: { status: "DROPSHIP" },
  annulees: { status: "CANCELLED" },
};

export async function listMarketplaceOverview(customerId: string, opts: { salesFilter?: SaleFilter; salesLimit?: number } = {}) {
  const filter = opts.salesFilter ?? "toutes";
  const limit = Math.min(Math.max(opts.salesLimit ?? 30, 1), 300);
  const [accounts, tokens, sales, saleCounts, stockItems] = await Promise.all([
    db.marketplaceAccount.findMany({ where: { customerId }, orderBy: { lastSyncAt: "desc" } }),
    db.extensionToken.findMany({
      // Jetons révoqués affichés 7 jours (l'historique complet reste dans le journal d'audit).
      where: { customerId, OR: [{ revokedAt: null }, { revokedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }] },
      orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      select: { id: true, prefix: true, label: true, lastUsedAt: true, revokedAt: true, createdAt: true },
      take: 20,
    }),
    db.marketplaceSale.findMany({
      where: { customerId, ...saleFilterWhere[filter] },
      orderBy: { soldAt: "desc" },
      take: limit + 1,
      include: {
        inventoryItem: { select: { id: true, name: true, files: { where: { purpose: "PRODUCT_PHOTO", deletedAt: null }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true } } } },
        shipment: { select: { id: true, reference: true, status: true, carrier: true, trackingNumber: true } },
        dropshipOrder: {
          select: {
            id: true,
            reference: true,
            status: true,
            carrier: true,
            trackingNumber: true,
            dropshipShipment: { select: { id: true, reference: true, status: true, carrier: true, trackingNumber: true } },
            // Vente annulée : articles reçus en dropshipping qui attendent le choix du client.
            inventoryItems: { where: { dropship: true, quantityAvailable: { gt: 0 } }, select: { id: true, name: true } },
          },
        },
        listing: { select: { url: true, photoUrl: true } },
        account: { select: { username: true, externalUserId: true } },
        lines: { orderBy: { position: "asc" }, include: { inventoryItem: { select: { id: true, name: true } } } },
        _count: { select: { files: { where: { purpose: "SHIPPING_LABEL", deletedAt: null } } } },
      },
    }),
    Promise.all(SALE_FILTERS.map((f) => db.marketplaceSale.count({ where: { customerId, ...saleFilterWhere[f] } }))),
    db.inventoryItem.findMany({
      where: { customerId, dropship: false, quantityAvailable: { gt: 0 } },
      orderBy: { receivedAt: "desc" },
      select: { id: true, name: true, quantityAvailable: true, receivedAt: true },
      take: 300,
    }),
  ]);
  return {
    accounts,
    tokens,
    sales: sales.slice(0, limit),
    salesFilter: filter,
    hasMoreSales: sales.length > limit,
    saleCounts: Object.fromEntries(SALE_FILTERS.map((f, i) => [f, saleCounts[i]])) as Record<SaleFilter, number>,
    stockItems,
  };
}

/** Annonces rattachées à un article et annonces disponibles pour un rattachement. */
export async function listingsForItem(customerId: string, itemId: string) {
  const item = await db.inventoryItem.findUnique({ where: { id: itemId }, select: { customerId: true } });
  if (!item || item.customerId !== customerId) throw new NotFoundError("Article introuvable.");
  const [linked, available] = await Promise.all([
    db.marketplaceListing.findMany({ where: { customerId, inventoryItemId: itemId }, orderBy: { lastSeenAt: "desc" } }),
    db.marketplaceListing.findMany({ where: { customerId, inventoryItemId: null, status: { not: "sold" } }, orderBy: { lastSeenAt: "desc" }, take: 100 }),
  ]);
  return { linked, available };
}

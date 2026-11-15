import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { InventoryItem, MarketplaceSale } from "@/generated/prisma/client";
import type { MarketplacePlatform } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/db";
import { DomainError, ForbiddenError, NotFoundError, isUniqueViolation } from "@/server/errors";
import { assertCustomer, type Actor } from "@/server/auth/actor";
import { storage } from "@/server/storage";
import { MARKETPLACE_PLATFORM } from "@/lib/labels";
import { audit } from "./audit";
import { sniffMime } from "./files";
import { withEffects, type Effects } from "./notifications";
import { createShipmentTx } from "./shipments";

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
        externalItemId: z.preprocess((v) => (v === null || v === undefined || v === "" ? undefined : String(v)), z.string().trim().max(80).optional()),
        title: z.string().trim().min(1).max(300),
        priceCents: cents,
        currency: optionalText(3),
        buyerName: optionalText(120),
        soldAt: z.coerce.date(),
      }),
    )
    .max(200)
    .default([]),
});

export type SyncPayload = z.input<typeof syncPayloadSchema>;

function findSkus(...texts: (string | undefined)[]) {
  const out = new Set<string>();
  for (const t of texts) for (const m of t?.matchAll(SKU_RE) ?? []) out.add(m[0].toUpperCase());
  return [...out];
}

/** Données transmises par l'extension (idempotent : un rejeu ne crée rien de nouveau). */
export async function syncFromExtension(customerId: string, payload: unknown) {
  const data = syncPayloadSchema.parse(payload);
  const platform = data.platform as MarketplacePlatform;
  const now = new Date();
  const result = { listings: 0, linkedListings: 0, newSales: 0, shipmentsCreated: 0 };

  await db.marketplaceAccount.upsert({
    where: { customerId_platform_externalUserId: { customerId, platform, externalUserId: data.account.externalUserId } },
    create: { customerId, platform, externalUserId: data.account.externalUserId, username: data.account.username ?? null, lastSyncAt: now },
    update: { username: data.account.username ?? undefined, lastSyncAt: now },
  });

  // Annonces (rattachement automatique par SKU Packio cité dans l'annonce).
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
    const created = await withEffects(async (tx, fx) => {
      const existing = await tx.marketplaceSale.findUnique({ where: { customerId_platform_externalOrderId: { customerId, platform, externalOrderId: s.externalOrderId } } });
      if (existing) return null;
      const listing = s.externalItemId
        ? await tx.marketplaceListing.findUnique({ where: { customerId_platform_externalId: { customerId, platform, externalId: s.externalItemId } } })
        : null;
      const item = listing?.inventoryItemId ? await tx.inventoryItem.findUnique({ where: { id: listing.inventoryItemId } }) : null;
      let sale: MarketplaceSale;
      try {
        sale = await tx.marketplaceSale.create({
          data: {
            customerId,
            platform,
            externalOrderId: s.externalOrderId,
            listingId: listing?.id ?? null,
            title: s.title,
            priceCents: s.priceCents ?? null,
            currency: (s.currency ?? "eur").toLowerCase(),
            buyerName: s.buyerName ?? null,
            soldAt: s.soldAt,
            status: item ? "MATCHED" : "NEW",
            inventoryItemId: item?.id ?? null,
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) return null;
        throw err;
      }
      if (listing && listing.status !== "sold") await tx.marketplaceListing.update({ where: { id: listing.id }, data: { status: "sold" } });
      const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: customerId }, select: { userId: true } });
      const price = sale.priceCents !== null ? ` (${(sale.priceCents / 100).toLocaleString("fr-FR", { style: "currency", currency: sale.currency.toUpperCase() })})` : "";
      fx.notify(customer.userId, {
        type: "MARKETPLACE_SALE",
        title: `Vente ${platformLabel(platform)} : « ${sale.title} »`,
        body: item
          ? `Vendu${price}. L'article « ${item.name} » de votre stock est envoyé à votre préparateur ; le bordereau sera joint dès qu'il sera généré sur ${platformLabel(platform)}.`
          : `Vendu${price}. Associez cette vente à un article de votre stock pour que votre préparateur l'expédie.`,
        link: "/client/ventes",
        forceEmail: true,
      });
      return sale;
    });
    if (!created) continue;
    result.newSales++;
    if (created.status === "MATCHED" && (await tryCreateSaleShipment(created.id))) result.shipmentsCreated++;
  }
  return result;
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
      if (sale.status !== "MATCHED" || sale.shipmentId || !sale.inventoryItemId) return false;
      const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: sale.inventoryItemId } });
      const label = await tx.file.findFirst({ where: { marketplaceSaleId: sale.id, purpose: "SHIPPING_LABEL", shipmentId: null, deletedAt: null }, orderBy: { createdAt: "desc" } });
      return createSaleShipmentTx(tx, fx, sale, item, label?.id ?? null);
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

async function createSaleShipmentTx(tx: Tx, fx: Effects, sale: MarketplaceSale, item: InventoryItem, labelFileId: string | null): Promise<boolean> {
  const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: sale.customerId }, select: { userId: true, currentPreparerId: true } });
  if (!customer.currentPreparerId) {
    throw new DomainError("NO_PREPARER", "Aucun préparateur n'est attribué à votre compte.");
  }
  if (item.customerId !== sale.customerId) throw new ForbiddenError();
  if (item.quantityAvailable < 1) {
    throw new DomainError("STOCK", `« ${item.name} » n'est plus disponible en stock.`);
  }
  const platform = platformLabel(sale.platform);
  const shipment = await createShipmentTx(tx, fx, {
    customerId: sale.customerId,
    actorUserId: customer.userId,
    system: true,
    kind: "SALE",
    items: [{ itemId: item.id, quantity: 1 }],
    recipientName: sale.buyerName ?? `Acheteur ${platform}`,
    addressLine1: "Adresse indiquée sur le bordereau",
    postalCode: "",
    city: "Voir bordereau",
    country: "FR",
    labelMode: labelFileId ? "CUSTOMER_PROVIDED" : "PREPARER_PROVIDED",
    labelFileId,
    instructions: `Vente ${platform} n° ${sale.externalOrderId}${labelFileId ? "" : " : bordereau joint automatiquement dès sa génération par le client"}`,
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
    const shipment = locked.shipmentId ? await tx.outboundShipment.findUnique({ where: { id: locked.shipmentId } }) : null;
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
  const customerId = assertCustomer(actor);
  const sale = await db.marketplaceSale.findUnique({ where: { id: input.saleId } });
  if (!sale || sale.customerId !== customerId) throw new NotFoundError("Vente introuvable.");
  if (sale.shipmentId || sale.status === "SHIPMENT_CREATED") throw new DomainError("ALREADY_SHIPPED", "Une expédition existe déjà pour cette vente.");
  if (sale.status === "CANCELLED") throw new DomainError("CANCELLED", "Cette vente a été annulée.");
  const item = await ownItem(customerId, input.itemId);
  if (item.quantityAvailable < 1) throw new DomainError("STOCK", `« ${item.name} » n'est plus disponible en stock.`);
  await db.marketplaceSale.update({ where: { id: sale.id }, data: { inventoryItemId: item.id, status: "MATCHED", notes: null } });
  if (sale.listingId) {
    await db.marketplaceListing.updateMany({ where: { id: sale.listingId, inventoryItemId: null }, data: { inventoryItemId: item.id } });
  }
  const created = await tryCreateSaleShipment(sale.id);
  if (!created) {
    const after = await db.marketplaceSale.findUniqueOrThrow({ where: { id: sale.id } });
    throw new DomainError("SHIPMENT", after.notes ?? "L'expédition n'a pas pu être créée.");
  }
  return db.marketplaceSale.findUniqueOrThrow({ where: { id: sale.id } });
}

export async function ignoreSale(actor: Actor, saleId: string) {
  const customerId = assertCustomer(actor);
  const sale = await db.marketplaceSale.findUnique({ where: { id: saleId } });
  if (!sale || sale.customerId !== customerId) throw new NotFoundError("Vente introuvable.");
  if (sale.shipmentId) throw new DomainError("ALREADY_SHIPPED", "Une expédition existe déjà : annulez-la depuis la page de l'expédition.");
  return db.marketplaceSale.update({ where: { id: sale.id }, data: { status: "IGNORED" } });
}

// -----------------------------------------------------------------------------
// Lectures
// -----------------------------------------------------------------------------

export async function listMarketplaceOverview(customerId: string) {
  const [accounts, tokens, sales, listings, stockItems] = await Promise.all([
    db.marketplaceAccount.findMany({ where: { customerId }, orderBy: { lastSyncAt: "desc" } }),
    db.extensionToken.findMany({
      where: { customerId },
      orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      select: { id: true, prefix: true, label: true, lastUsedAt: true, revokedAt: true, createdAt: true },
      take: 20,
    }),
    db.marketplaceSale.findMany({
      where: { customerId },
      orderBy: { soldAt: "desc" },
      take: 50,
      include: {
        inventoryItem: { select: { id: true, name: true, sku: true } },
        shipment: { select: { id: true, reference: true, status: true } },
        listing: { select: { url: true } },
        _count: { select: { files: { where: { purpose: "SHIPPING_LABEL", deletedAt: null } } } },
      },
    }),
    db.marketplaceListing.findMany({
      where: { customerId },
      orderBy: { lastSeenAt: "desc" },
      take: 200,
      include: { inventoryItem: { select: { id: true, name: true, sku: true } } },
    }),
    db.inventoryItem.findMany({
      where: { customerId, dropship: false, quantityAvailable: { gt: 0 } },
      orderBy: { receivedAt: "desc" },
      select: { id: true, name: true, sku: true, quantityAvailable: true },
      take: 300,
    }),
  ]);
  return { accounts, tokens, sales, listings, stockItems };
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

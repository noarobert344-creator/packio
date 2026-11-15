import type { InventoryItem } from "@/generated/prisma/client";
import type { InventoryMovementType, InventoryStatus } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/db";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { assertPreparer, can, type Actor } from "@/server/auth/actor";
import { reference } from "@/server/lib/ids";
import { audit } from "./audit";
import { withEffects, type Effects } from "./notifications";
import { initialStorageEnd } from "./storage";

/**
 * STOCK
 * Chaque variation de quantité produit un mouvement (inventory_movements, en
 * ajout seul). Les lignes d'articles sont verrouillées (FOR UPDATE) pendant
 * les opérations pour éviter toute survente lors de demandes concurrentes.
 */

export function deriveStatus(item: Pick<InventoryItem, "quantityAvailable" | "quantityReserved" | "quantityDamaged" | "status">): InventoryStatus {
  if (item.status === "ARCHIVED") return "ARCHIVED";
  if (item.quantityAvailable > 0) return "IN_STOCK";
  if (item.quantityReserved > 0) return "RESERVED";
  if (item.quantityDamaged > 0) return "DAMAGED";
  return "DEPLETED";
}

export async function lockItems(tx: Tx, ids: string[]) {
  if (!ids.length) return [];
  const sorted = [...new Set(ids)].sort();
  await tx.$queryRaw`SELECT "id" FROM "inventory_items" WHERE "id" = ANY(${sorted}::text[]) ORDER BY "id" FOR UPDATE`;
  return tx.inventoryItem.findMany({ where: { id: { in: sorted } } });
}

type Delta = Partial<Record<"quantityReceived" | "quantityAvailable" | "quantityReserved" | "quantityShipped" | "quantityDamaged" | "quantityMissing", number>>;

/** Applique une variation de quantités et inscrit le mouvement correspondant. */
export async function applyMovement(
  tx: Tx,
  item: InventoryItem,
  type: InventoryMovementType,
  delta: Delta,
  meta: { actorId?: string | null; reason?: string | null; shipmentId?: string | null; countId?: string | null },
) {
  const next = {
    quantityReceived: item.quantityReceived + (delta.quantityReceived ?? 0),
    quantityAvailable: item.quantityAvailable + (delta.quantityAvailable ?? 0),
    quantityReserved: item.quantityReserved + (delta.quantityReserved ?? 0),
    quantityShipped: item.quantityShipped + (delta.quantityShipped ?? 0),
    quantityDamaged: item.quantityDamaged + (delta.quantityDamaged ?? 0),
    quantityMissing: item.quantityMissing + (delta.quantityMissing ?? 0),
  };
  for (const [k, v] of Object.entries(next)) {
    if (v < 0) {
      throw new DomainError("NEGATIVE_STOCK", `Quantité insuffisante pour « ${item.name} » (${k.replace("quantity", "").toLowerCase()}).`);
    }
  }
  const status = deriveStatus({ ...next, status: item.status });
  const updated = await tx.inventoryItem.update({ where: { id: item.id }, data: { ...next, status } });
  await tx.inventoryMovement.create({
    data: {
      itemId: item.id,
      type,
      quantity: delta.quantityAvailable ?? 0,
      availableAfter: updated.quantityAvailable,
      reservedAfter: updated.quantityReserved,
      reason: meta.reason ?? null,
      actorId: meta.actorId ?? null,
      shipmentId: meta.shipmentId ?? null,
      countId: meta.countId ?? null,
    },
  });
  return updated;
}

async function uniqueSku(tx: Tx) {
  for (let i = 0; i < 5; i++) {
    const sku = reference("SKU", 7);
    if (!(await tx.inventoryItem.findUnique({ where: { sku }, select: { id: true } }))) return sku;
  }
  throw new Error("Impossible de générer un SKU unique");
}

/** Vérifie que le préparateur est actuellement attribué au client. */
export async function assertPreparerServesCustomer(tx: Tx | typeof db, preparerId: string, customerId: string) {
  const assignment = await tx.preparerAssignment.findFirst({ where: { preparerId, customerId, status: "ACTIVE" }, select: { id: true } });
  if (!assignment) throw new ForbiddenError("Ce client ne vous est pas attribué.");
}

/** Accès en lecture à un article (client propriétaire, préparateur détenteur, admin). */
export async function getItemForActor(actor: Actor, itemId: string, client: Tx | typeof db = db) {
  const item = await client.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw new NotFoundError("Article introuvable.");
  if (actor.role === "CUSTOMER" && item.customerId === actor.customerId) return item;
  if (actor.role === "PREPARER" && item.preparerId === actor.preparerId) return item;
  if (actor.role === "ADMIN" && can(actor, "operations.read")) return item;
  throw new ForbiddenError();
}

async function itemForPreparerWrite(tx: Tx, actor: Actor, itemId: string) {
  const preparerId = assertPreparer(actor);
  const [item] = await lockItems(tx, [itemId]);
  if (!item) throw new NotFoundError("Article introuvable.");
  if (item.preparerId !== preparerId) throw new ForbiddenError("Cet article n'est pas stocké chez vous.");
  return item;
}

export async function createStockItem(
  tx: Tx,
  fx: Effects,
  actor: Actor,
  input: {
    customerId: string;
    preparerId: string;
    name: string;
    description?: string | null;
    supplierName?: string | null;
    quantity: number;
    storageLocation?: string | null;
    supplierOrderId?: string | null;
    photoIds?: string[];
    /** Dropshipping : expédié dès réception, hors places et durée de stockage. */
    dropship?: boolean;
  },
) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new DomainError("INVALID_QUANTITY", "Quantité invalide.");
  const item = await tx.inventoryItem.create({
    data: {
      sku: await uniqueSku(tx),
      customerId: input.customerId,
      preparerId: input.preparerId,
      supplierOrderId: input.supplierOrderId ?? null,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      supplierName: input.supplierName?.trim() || null,
      storageLocation: input.storageLocation?.trim() || null,
      quantityReceived: 0,
      quantityAvailable: 0,
      dropship: !!input.dropship,
      storagePaidUntil: input.dropship ? null : await initialStorageEnd(tx),
    },
  });
  const updated = await applyMovement(
    tx,
    item,
    "RECEIPT",
    { quantityReceived: input.quantity, quantityAvailable: input.quantity },
    { actorId: actor.userId, reason: input.supplierOrderId ? "Mise en stock depuis une commande" : "Ajout manuel au stock" },
  );
  if (input.photoIds?.length) await linkPhotos(tx, actor, input.photoIds, { inventoryItemId: item.id, customerId: input.customerId });
  const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: input.customerId }, select: { userId: true } });
  if (!input.dropship) fx.notify(customer.userId, {
    type: "STOCK_UPDATED",
    title: "Nouvel article en stock",
    body: `${updated.name} (×${input.quantity}) a été ajouté à votre stock — SKU ${updated.sku}.`,
    link: `/client/stock/${updated.id}`,
  });
  return updated;
}

export async function linkPhotos(
  tx: Tx,
  actor: Actor,
  fileIds: string[],
  target: { inventoryItemId?: string; supplierOrderId?: string; inboundParcelId?: string; shipmentId?: string; incidentId?: string; customerId: string },
) {
  const ids = [...new Set(fileIds)].slice(0, 12);
  if (!ids.length) return;
  const res = await tx.file.updateMany({
    where: { id: { in: ids }, uploadedById: actor.userId, deletedAt: null },
    data: { ...target },
  });
  if (res.count !== ids.length) throw new DomainError("INVALID_FILE", "Une ou plusieurs photos sont invalides.");
}

/** Ajout manuel d'un article au stock par le préparateur. */
export async function addItemManually(
  actor: Actor,
  input: { customerId: string; name: string; description?: string; supplierName?: string; quantity: number; storageLocation?: string; photoIds?: string[] },
) {
  const preparerId = assertPreparer(actor);
  return withEffects(async (tx, fx) => {
    await assertPreparerServesCustomer(tx, preparerId, input.customerId);
    const item = await createStockItem(tx, fx, actor, { ...input, preparerId });
    await audit({ actor, action: "inventory.item_created", entityType: "inventory_item", entityId: item.id, summary: `${item.name} ×${input.quantity}` }, tx);
    return item;
  });
}

export async function adjustQuantity(actor: Actor, input: { itemId: string; delta: number; reason: string }) {
  if (!Number.isInteger(input.delta) || input.delta === 0) throw new DomainError("INVALID_QUANTITY", "Indiquez une variation non nulle.");
  if (input.reason.trim().length < 3) throw new DomainError("REASON_REQUIRED", "Indiquez le motif de l'ajustement.");
  return withEffects(async (tx, fx) => {
    const item = await itemForPreparerWrite(tx, actor, input.itemId);
    const updated = await applyMovement(
      tx,
      item,
      "ADJUSTMENT",
      input.delta > 0 ? { quantityAvailable: input.delta, quantityReceived: input.delta } : { quantityAvailable: input.delta },
      { actorId: actor.userId, reason: input.reason.trim() },
    );
    const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: item.customerId }, select: { userId: true } });
    fx.notify(customer.userId, {
      type: "STOCK_UPDATED",
      title: "Stock mis à jour",
      body: `Quantité de « ${item.name} » ajustée (${input.delta > 0 ? "+" : ""}${input.delta}) : ${input.reason.trim()}.`,
      link: `/client/stock/${item.id}`,
    });
    return updated;
  });
}

export async function declareDamaged(actor: Actor, input: { itemId: string; quantity: number; reason: string }) {
  return declareLoss(actor, { ...input, kind: "DAMAGE" });
}

export async function declareMissing(actor: Actor, input: { itemId: string; quantity: number; reason: string }) {
  return declareLoss(actor, { ...input, kind: "MISSING" });
}

async function declareLoss(actor: Actor, input: { itemId: string; quantity: number; reason: string; kind: "DAMAGE" | "MISSING" }) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new DomainError("INVALID_QUANTITY", "Quantité invalide.");
  if (input.reason.trim().length < 3) throw new DomainError("REASON_REQUIRED", "Décrivez le problème.");
  return withEffects(async (tx, fx) => {
    const item = await itemForPreparerWrite(tx, actor, input.itemId);
    const delta: Delta =
      input.kind === "DAMAGE"
        ? { quantityAvailable: -input.quantity, quantityDamaged: input.quantity }
        : { quantityAvailable: -input.quantity, quantityMissing: input.quantity };
    const updated = await applyMovement(tx, item, input.kind, delta, { actorId: actor.userId, reason: input.reason.trim() });
    const { createIncidentTx } = await import("./incidents");
    const incident = await createIncidentTx(tx, fx, actor, {
      type: input.kind === "DAMAGE" ? "INBOUND_DAMAGED" : "STOCK_DISCREPANCY",
      title: `${input.kind === "DAMAGE" ? "Article abîmé" : "Article manquant"} : ${item.name} (×${input.quantity})`,
      description: input.reason.trim(),
      customerId: item.customerId,
      preparerId: item.preparerId,
      inventoryItemId: item.id,
      priority: "HIGH",
    });
    return { item: updated, incidentId: incident.id };
  });
}

export async function markFound(actor: Actor, input: { itemId: string; quantity: number; reason?: string }) {
  return withEffects(async (tx, fx) => {
    const item = await itemForPreparerWrite(tx, actor, input.itemId);
    if (input.quantity > item.quantityMissing) throw new DomainError("INVALID_QUANTITY", "Quantité supérieure aux articles déclarés manquants.");
    const updated = await applyMovement(
      tx,
      item,
      "FOUND",
      { quantityAvailable: input.quantity, quantityMissing: -input.quantity },
      { actorId: actor.userId, reason: input.reason?.trim() || "Article retrouvé" },
    );
    const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: item.customerId }, select: { userId: true } });
    fx.notify(customer.userId, { type: "STOCK_UPDATED", title: "Article retrouvé", body: `${input.quantity} × « ${item.name} » de nouveau disponible(s).`, link: `/client/stock/${item.id}` });
    return updated;
  });
}

export async function updateItemDetails(actor: Actor, input: { itemId: string; name?: string; storageLocation?: string | null; notes?: string | null; photoIds?: string[] }) {
  return withEffects(async (tx, fx) => {
    const item = await itemForPreparerWrite(tx, actor, input.itemId);
    const photos = input.photoIds?.length ? [...new Set(input.photoIds)].length : 0;
    const updated = await tx.inventoryItem.update({
      where: { id: item.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() || item.name } : {}),
        ...(input.storageLocation !== undefined ? { storageLocation: input.storageLocation?.trim() || null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(photos ? { photosUpdatedAt: new Date() } : {}),
      },
    });
    if (photos) {
      await linkPhotos(tx, actor, input.photoIds!, { inventoryItemId: item.id, customerId: item.customerId });
      // Photos destinées aux annonces du client : il est prévenu pour les télécharger.
      const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: item.customerId }, select: { userId: true } });
      fx.notify(customer.userId, {
        type: "PRODUCT_PHOTOS",
        title: "Photos disponibles",
        body: `${photos} photo${photos > 1 ? "s" : ""} de « ${updated.name} » ${photos > 1 ? "sont prêtes" : "est prête"} : téléchargez-les pour créer votre annonce.`,
        link: `/client/stock/${item.id}`,
      });
    }
    return updated;
  });
}

/** Inventaire : comptage physique, les écarts génèrent des mouvements INVENTORY_COUNT. */
export async function performInventoryCount(
  actor: Actor,
  input: { customerId: string; counts: { itemId: string; counted: number }[]; notes?: string },
) {
  const preparerId = assertPreparer(actor);
  return withEffects(async (tx, fx) => {
    const items = await lockItems(tx, input.counts.map((c) => c.itemId));
    for (const item of items) {
      if (item.preparerId !== preparerId || item.customerId !== input.customerId) throw new ForbiddenError("Article hors de votre périmètre.");
    }
    const count = await tx.inventoryCount.create({
      data: { preparerId, customerId: input.customerId, performedById: actor.userId, notes: input.notes?.trim() || null },
    });
    let discrepancies = 0;
    for (const c of input.counts) {
      const item = items.find((i) => i.id === c.itemId);
      if (!item || !Number.isInteger(c.counted) || c.counted < 0) continue;
      const diff = c.counted - item.quantityAvailable;
      if (diff === 0) continue;
      discrepancies++;
      await applyMovement(
        tx,
        item,
        "INVENTORY_COUNT",
        diff < 0 ? { quantityAvailable: diff, quantityMissing: -diff } : { quantityAvailable: diff, quantityReceived: diff },
        { actorId: actor.userId, reason: `Inventaire : ${item.quantityAvailable} attendu(s), ${c.counted} compté(s)`, countId: count.id },
      );
    }
    await tx.inventoryCount.update({ where: { id: count.id }, data: { discrepancies } });
    await audit({ actor, action: "inventory.count", entityType: "customer", entityId: input.customerId, summary: `${discrepancies} écart(s)` }, tx);
    if (discrepancies > 0) {
      const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: input.customerId }, select: { userId: true } });
      fx.notify(customer.userId, {
        type: "STOCK_UPDATED",
        title: "Inventaire réalisé",
        body: `Votre préparateur a réalisé un inventaire : ${discrepancies} écart(s) corrigé(s). Le détail figure dans l'historique de vos articles.`,
        link: "/client/stock",
      });
    }
    return { countId: count.id, discrepancies };
  });
}

export { getStorageUsage } from "./storage";

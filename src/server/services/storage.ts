import { addDays, format } from "date-fns";
import { fr } from "date-fns/locale";
import { db, type Tx } from "@/server/db";
import { DomainError } from "@/server/errors";
import { assertCustomer, type Actor } from "@/server/auth/actor";
import { audit } from "./audit";
import { availableCredits, debitCredits } from "./credits";
import { getActiveSubscription } from "./customers";
import { withEffects, type Effects } from "./notifications";
import { getSetting, type Settings } from "./settings";

/**
 * STOCKAGE
 *  - Chaque offre inclut un nombre de places (articles en stock en même temps).
 *  - Des places supplémentaires s'achètent avec des crédits : 1 crédit = 5
 *    places pendant 30 jours (paramétrable).
 *  - Chaque article dispose de 2 semaines de stockage ; au-delà, chaque
 *    période de 2 semaines coûte 1 crédit par article (paramétrable), prélevé
 *    automatiquement. Faute de crédits, l'article passe « en dépassement » et
 *    la prolongation est prélevée dès que des crédits sont disponibles.
 *  - Les articles en dropshipping (expédiés dès réception) ne sont concernés
 *    ni par les places ni par la durée.
 */

export type StorageRules = Settings["storage"];

/** Places occupées : articles en stock (disponibles ou réservés), hors dropshipping. */
export async function getStorageUsage(customerId: string, client: Tx | typeof db = db) {
  const agg = await client.inventoryItem.aggregate({
    where: { customerId, dropship: false },
    _sum: { quantityAvailable: true, quantityReserved: true },
  });
  return (agg._sum.quantityAvailable ?? 0) + (agg._sum.quantityReserved ?? 0);
}

const dateFr = (d: Date) => format(d, "d MMMM", { locale: fr });

export function creditsForSlots(slots: number, rules: Pick<StorageRules, "slotsPerCredit">) {
  return slots <= 0 ? 0 : Math.ceil(slots / rules.slotsPerCredit);
}

/** Commandes en cours de livraison qui occuperont des places à leur arrivée. */
const INCOMING_STATUSES = ["REGISTERED", "SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER", "PICKED_UP", "RECEIVED", "QUALITY_CHECK"] as const;

export async function getStorageOverview(customerId: string, client: Tx | typeof db = db, now = new Date()) {
  const [rules, sub, used, incoming, purchases] = await Promise.all([
    getSetting("storage", client),
    getActiveSubscription(customerId, client),
    getStorageUsage(customerId, client),
    client.supplierOrder.aggregate({ where: { customerId, mode: "STOCK", status: { in: [...INCOMING_STATUSES] } }, _sum: { quantity: true } }),
    client.storagePurchase.findMany({ where: { customerId, startsAt: { lte: now }, expiresAt: { gt: now } }, orderBy: { expiresAt: "asc" } }),
  ]);
  const included = sub?.plan.storageLimit ?? null;
  const extra = purchases.reduce((s, p) => s + p.slots, 0);
  const capacity = included === null ? null : included + extra;
  const incomingQty = incoming._sum.quantity ?? 0;
  return {
    rules,
    included,
    extra,
    capacity,
    used,
    incoming: incomingQty,
    /** Places encore libres en tenant compte des commandes en cours (null = illimité). */
    free: capacity === null ? null : Math.max(0, capacity - used - incomingQty),
    purchases,
  };
}

/** Achat de places supplémentaires (débit des crédits, idempotent). */
export async function buyStorageSlotsTx(
  tx: Tx,
  input: { customerId: string; credits: number; rules: StorageRules; actorId: string | null; supplierOrderId?: string | null; idempotencyKey: string; now?: Date },
) {
  if (!Number.isInteger(input.credits) || input.credits <= 0) throw new DomainError("INVALID_AMOUNT", "Nombre de crédits invalide.");
  const now = input.now ?? new Date();
  const slots = input.credits * input.rules.slotsPerCredit;
  const expiresAt = addDays(now, input.rules.extraSlotsDays);
  const res = await debitCredits(tx, {
    customerId: input.customerId,
    amount: input.credits,
    type: "STORAGE_FEE",
    description: `${slots} places de stock supplémentaires jusqu'au ${dateFr(expiresAt)}`,
    actorId: input.actorId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!res.applied) return null;
  return tx.storagePurchase.create({
    data: { customerId: input.customerId, slots, credits: input.credits, startsAt: now, expiresAt, createdById: input.actorId, supplierOrderId: input.supplierOrderId ?? null },
  });
}

/** Achat de places par le client depuis son espace (« 1 crédit = 5 places »). */
export async function purchaseStorageSlots(actor: Actor, input: { credits: number; requestId: string }) {
  const customerId = assertCustomer(actor);
  if (!Number.isInteger(input.credits) || input.credits < 1 || input.credits > 50) {
    throw new DomainError("INVALID_AMOUNT", "Choisissez entre 1 et 50 crédits.", { fieldErrors: { credits: "Entre 1 et 50" } });
  }
  if (!(await getActiveSubscription(customerId))) throw new DomainError("NO_SUBSCRIPTION", "Un abonnement actif est nécessaire.");
  return withEffects(async (tx, fx) => {
    const rules = await getSetting("storage", tx);
    const available = await availableCredits(tx, customerId);
    if (available < input.credits) {
      throw new DomainError("INSUFFICIENT_CREDITS", `Solde insuffisant : ${available} crédit(s) disponible(s). Achetez des crédits pour ajouter des places.`);
    }
    const purchase = await buyStorageSlotsTx(tx, { customerId, credits: input.credits, rules, actorId: actor.userId, idempotencyKey: `slots:${customerId}:${input.requestId}` });
    if (purchase) {
      await audit({ actor, action: "storage.slots_purchased", entityType: "customer", entityId: customerId, summary: `${purchase.slots} places / ${purchase.credits} crédit(s)` }, tx);
      fx.notify(actor.userId, {
        type: "STORAGE_CHARGED",
        title: "Places de stock ajoutées",
        body: `${purchase.slots} places supplémentaires sont disponibles jusqu'au ${dateFr(purchase.expiresAt)} (${purchase.credits} crédit${purchase.credits > 1 ? "s" : ""}).`,
        link: "/client/stock",
      });
    }
    return purchase;
  });
}

/**
 * Contrôle des places lors d'une commande (hors dropshipping) : si la commande
 * dépasse la capacité, des places supplémentaires sont achetées avec les
 * crédits du client, à condition qu'il l'ait accepté.
 */
export async function ensureCapacityForOrder(
  tx: Tx,
  input: { customerId: string; quantity: number; acceptCharge: boolean; actorId: string; orderReference: string },
): Promise<{ credits: number; slots: number }> {
  const overview = await getStorageOverview(input.customerId, tx);
  if (overview.capacity === null) return { credits: 0, slots: 0 };
  const missing = overview.used + overview.incoming + input.quantity - overview.capacity;
  if (missing <= 0) return { credits: 0, slots: 0 };
  const credits = creditsForSlots(missing, overview.rules);
  const slots = credits * overview.rules.slotsPerCredit;
  const label = `${credits} crédit${credits > 1 ? "s" : ""} (${slots} places pendant ${overview.rules.extraSlotsDays} jours)`;
  if (!input.acceptCharge) {
    throw new DomainError(
      "STORAGE_CREDITS_REQUIRED",
      `Cette commande dépasse vos places de stock (${overview.capacity} places, ${overview.used} occupées, ${overview.incoming} en commande) : ${label} seront débités. Cochez la case pour accepter.`,
      { fieldErrors: { acceptStorageCharge: `${label} seront débités` } },
    );
  }
  const available = await availableCredits(tx, input.customerId);
  if (available < credits) {
    throw new DomainError(
      "INSUFFICIENT_CREDITS",
      `Cette commande nécessite ${label} pour dépasser vos places de stock, mais votre solde est de ${available} crédit(s). Achetez des crédits ou libérez des places.`,
    );
  }
  await buyStorageSlotsTx(tx, {
    customerId: input.customerId,
    credits,
    rules: overview.rules,
    actorId: input.actorId,
    idempotencyKey: `slots-order:${input.orderReference}`,
  });
  return { credits, slots };
}

// -----------------------------------------------------------------------------
// Durée de stockage (2 semaines, prolongations payantes)
// -----------------------------------------------------------------------------

/** Fin de la durée incluse pour un article mis en stock. */
export async function initialStorageEnd(client: Tx | typeof db, from = new Date()) {
  const rules = await getSetting("storage", client);
  return addDays(from, rules.includedDays);
}

type ChargeOutcome = "charged" | "overdue" | "skipped";

/**
 * Prolonge un article dont la durée payée est échue (une ou plusieurs périodes
 * en cas de rattrapage). Idempotent par période (clé d'opération).
 */
async function chargeItem(tx: Tx, fx: Effects, itemId: string, rules: StorageRules, now: Date, notifyAdmins: boolean): Promise<ChargeOutcome> {
  await tx.$queryRaw`SELECT "id" FROM "inventory_items" WHERE "id" = ${itemId} FOR UPDATE`;
  let item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId }, include: { customer: { select: { userId: true, referenceCode: true } } } });
  // Un article en dépassement est échu au moins depuis la date du dépassement.
  if (item.storageOverdueSince && item.storageOverdueSince > now) now = item.storageOverdueSince;
  if (item.dropship || item.quantityAvailable <= 0 || !item.storagePaidUntil || item.storagePaidUntil > now) return "skipped";

  let periods = 0;
  let credits = 0;
  while (item.storagePaidUntil && item.storagePaidUntil <= now) {
    const cost = rules.extensionCredits * item.quantityAvailable;
    const nextEnd = addDays(item.storagePaidUntil, rules.extensionDays);
    if (cost > 0) {
      if ((await availableCredits(tx, item.customerId)) < cost) {
        if (!item.storageOverdueSince) {
          await tx.inventoryItem.update({ where: { id: item.id }, data: { storageOverdueSince: now } });
          fx.notify(item.customer.userId, {
            type: "STORAGE_OVERDUE",
            title: "Stockage : crédits insuffisants",
            body: `« ${item.name} » a dépassé sa durée de stockage. La prolongation (${cost} crédit${cost > 1 ? "s" : ""} pour ${rules.extensionDays} jours) sera prélevée dès que vous aurez des crédits. Vous pouvez aussi l'expédier ou vous le faire renvoyer.`,
            link: `/client/stock/${item.id}`,
            forceEmail: true,
          });
          if (notifyAdmins) {
            fx.notifyAdmins(
              {
                type: "STORAGE_OVERDUE",
                title: "Stockage impayé",
                body: `${item.customer.referenceCode} : « ${item.name} » (${item.sku}) est en dépassement de stockage faute de crédits.`,
                link: `/admin/clients/${item.customerId}`,
              },
              "customers.manage",
            );
          }
        }
        return periods > 0 ? "charged" : "overdue";
      }
      await debitCredits(tx, {
        customerId: item.customerId,
        amount: cost,
        type: "STORAGE_FEE",
        description: `Prolongation de stockage « ${item.name} » (${item.quantityAvailable} article${item.quantityAvailable > 1 ? "s" : ""}) jusqu'au ${dateFr(nextEnd)}`,
        idempotencyKey: `storage:${item.id}:${item.storagePaidUntil.toISOString()}`,
      });
    }
    periods++;
    credits += cost;
    item = await tx.inventoryItem.update({
      where: { id: item.id },
      data: { storagePaidUntil: nextEnd, storageOverdueSince: null, storageReminderAt: null },
      include: { customer: { select: { userId: true, referenceCode: true } } },
    });
  }
  if (periods > 0 && credits > 0) {
    fx.notify(item.customer.userId, {
      type: "STORAGE_CHARGED",
      title: "Stockage prolongé",
      body: `« ${item.name} » reste stocké jusqu'au ${dateFr(item.storagePaidUntil!)} : ${credits} crédit${credits > 1 ? "s" : ""} prélevé${credits > 1 ? "s" : ""}.`,
      link: `/client/stock/${item.id}`,
    });
  }
  return "charged";
}

/**
 * Tâche planifiée : rappels avant échéance, puis prolongations échues.
 * Appelée par la tâche « credits » (toutes les heures).
 */
export async function runStorageBilling(now = new Date()) {
  const rules = await getSetting("storage");

  // 1. Rappels (une fois par période).
  const remindUntil = addDays(now, rules.reminderDaysBefore);
  const toRemind = await db.inventoryItem.findMany({
    where: { dropship: false, quantityAvailable: { gt: 0 }, storagePaidUntil: { gt: now, lte: remindUntil }, storageReminderAt: null },
    include: { customer: { select: { userId: true } } },
    take: 1000,
  });
  const byCustomer = new Map<string, typeof toRemind>();
  for (const item of toRemind) byCustomer.set(item.customer.userId, [...(byCustomer.get(item.customer.userId) ?? []), item]);
  for (const [userId, items] of byCustomer) {
    await withEffects(async (tx, fx) => {
      await tx.inventoryItem.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { storageReminderAt: now } });
      const first = items[0];
      const cost = rules.extensionCredits;
      fx.notify(userId, {
        type: "STORAGE_REMINDER",
        title: items.length > 1 ? `${items.length} articles arrivent au terme de leur stockage` : "Un article arrive au terme de son stockage",
        body:
          (items.length > 1
            ? `${items.map((i) => `« ${i.name} »`).slice(0, 5).join(", ")}${items.length > 5 ? "…" : ""} : durée de stockage terminée prochainement.`
            : `« ${first.name} » : durée de stockage terminée le ${dateFr(first.storagePaidUntil!)}.`) +
          (cost > 0 ? ` Sans expédition d'ici là, ${cost} crédit par article sera prélevé pour ${rules.extensionDays} jours de plus.` : ""),
        link: items.length > 1 ? "/client/stock" : `/client/stock/${first.id}`,
      });
    });
  }

  // 2. Prolongations échues.
  const due = await db.inventoryItem.findMany({
    where: { dropship: false, quantityAvailable: { gt: 0 }, storagePaidUntil: { lte: now } },
    select: { id: true },
    orderBy: { storagePaidUntil: "asc" },
    take: 1000,
  });
  const result = { reminded: toRemind.length, charged: 0, overdue: 0 };
  for (const { id } of due) {
    const outcome = await withEffects((tx, fx) => chargeItem(tx, fx, id, rules, now, true));
    if (outcome === "charged") result.charged++;
    else if (outcome === "overdue") result.overdue++;
  }
  return result;
}

/** Après l'ajout de crédits : prélève les prolongations en attente du client. */
export async function retryOverdueStorage(customerId: string, now = new Date()) {
  const rules = await getSetting("storage");
  const items = await db.inventoryItem.findMany({
    where: { customerId, dropship: false, quantityAvailable: { gt: 0 }, OR: [{ storagePaidUntil: { lte: now } }, { storageOverdueSince: { not: null } }] },
    select: { id: true },
    orderBy: { storagePaidUntil: "asc" },
  });
  let charged = 0;
  for (const { id } of items) {
    if ((await withEffects((tx, fx) => chargeItem(tx, fx, id, rules, now, false))) === "charged") charged++;
  }
  return { charged };
}

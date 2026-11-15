import type { SupplierOrder } from "@/generated/prisma/client";
import type { IncidentType, SupplierOrderStatus } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/db";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { assertCustomer, assertPreparer, can, type Actor } from "@/server/auth/actor";
import { reference } from "@/server/lib/ids";
import { checkCompatibility } from "@/lib/compatibility";
import { SUPPLIER_ORDER_STATUS } from "@/lib/labels";
import { withEffects, type Effects } from "./notifications";
import { assertCustomerOperational, getActiveSubscription } from "./customers";
import { createStockItem, getStorageUsage, linkPhotos } from "./inventory";
import { createIncidentTx } from "./incidents";

/**
 * COMMANDES FOURNISSEURS (saisie manuelle — V1)
 * Le client déclare ses achats livrés au point de réception validé de son
 * préparateur. Le préparateur fait avancer la commande jusqu'à la mise en stock.
 */

const CUSTOMER_TRANSITIONS: Partial<Record<SupplierOrderStatus, SupplierOrderStatus[]>> = {
  REGISTERED: ["SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER", "CANCELLED"],
  SUPPLIER_CONFIRMED: ["IN_TRANSIT", "AT_LOCKER", "CANCELLED"],
  IN_TRANSIT: ["AT_LOCKER"],
};

const PREPARER_TRANSITIONS: Partial<Record<SupplierOrderStatus, SupplierOrderStatus[]>> = {
  REGISTERED: ["PICKED_UP", "RECEIVED", "INCIDENT"],
  SUPPLIER_CONFIRMED: ["PICKED_UP", "RECEIVED", "INCIDENT"],
  IN_TRANSIT: ["AT_LOCKER", "PICKED_UP", "RECEIVED", "INCIDENT"],
  AT_LOCKER: ["PICKED_UP", "RECEIVED", "INCIDENT"],
  PICKED_UP: ["RECEIVED", "INCIDENT"],
  RECEIVED: ["QUALITY_CHECK", "IN_STOCK", "INCIDENT"],
  QUALITY_CHECK: ["IN_STOCK", "INCIDENT"],
  INCIDENT: ["QUALITY_CHECK", "IN_STOCK", "RETURNED_TO_SUPPLIER"],
};

export const ORDER_OPEN_STATUSES: SupplierOrderStatus[] = ["REGISTERED", "SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER", "PICKED_UP", "RECEIVED", "QUALITY_CHECK"];

async function lockOrder(tx: Tx, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "supplier_orders" WHERE "id" = ${orderId} FOR UPDATE`;
  const order = await tx.supplierOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new NotFoundError("Commande introuvable.");
  return order;
}

async function setStatus(tx: Tx, order: SupplierOrder, status: SupplierOrderStatus, actorId: string | null, note?: string | null) {
  if (order.status === status) return order;
  const updated = await tx.supplierOrder.update({ where: { id: order.id }, data: { status, statusChangedAt: new Date() } });
  await tx.supplierOrderEvent.create({ data: { supplierOrderId: order.id, status, actorId, note: note?.trim() || null } });
  return updated;
}

function assertTransition(map: typeof CUSTOMER_TRANSITIONS, from: SupplierOrderStatus, to: SupplierOrderStatus) {
  if (!map[from]?.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `Impossible de passer de « ${SUPPLIER_ORDER_STATUS[from].label} » à « ${SUPPLIER_ORDER_STATUS[to].label} ».`);
  }
}

async function preparerOrder(tx: Tx, actor: Actor, orderId: string) {
  const preparerId = assertPreparer(actor);
  const order = await lockOrder(tx, orderId);
  if (order.preparerId !== preparerId) throw new ForbiddenError("Cette commande ne vous est pas destinée.");
  return order;
}

async function customerUserId(tx: Tx, customerId: string) {
  return (await tx.customerProfile.findUniqueOrThrow({ where: { id: customerId }, select: { userId: true } })).userId;
}

async function preparerUserId(tx: Tx, preparerId: string) {
  return (await tx.preparerProfile.findUniqueOrThrow({ where: { id: preparerId }, select: { userId: true } })).userId;
}

/** Informations de réception affichées au client (lieux validés uniquement). */
export async function getReceptionInfo(customerId: string) {
  const customer = await db.customerProfile.findUnique({
    where: { id: customerId },
    include: {
      user: { select: { firstName: true, lastName: true } },
      currentPreparer: {
        include: {
          user: { select: { firstName: true, lastName: true, avatarFileId: true } },
          locations: { where: { isActive: true, validatedAt: { not: null } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        },
      },
    },
  });
  if (!customer) throw new NotFoundError();
  const suppliers = await db.supplier.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  const locations = customer.currentPreparer?.locations ?? [];
  return {
    customer,
    preparer: customer.currentPreparer,
    locations,
    suppliers: suppliers.map((s) => ({
      ...s,
      compatibility: Object.fromEntries(locations.map((l) => [l.id, checkCompatibility(s, l)])),
    })),
  };
}

export type CreateOrderInput = {
  supplierId: string;
  supplierLabel?: string | null;
  locationId: string;
  articleUrl?: string | null;
  supplierOrderNumber?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  description: string;
  quantity: number;
  expectedArrivalAt?: Date | null;
  instructions?: string | null;
  compatibilityConfirmed?: boolean;
  photoIds?: string[];
};

export async function createSupplierOrder(actor: Actor, input: CreateOrderInput) {
  const customerId = assertCustomer(actor);
  return withEffects(async (tx, fx) => {
    const customer = await assertCustomerOperational(tx, customerId);
    const preparerId = customer.currentPreparerId!;
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    const location = await tx.preparerLocation.findUnique({ where: { id: input.locationId } });
    if (!supplier || !supplier.isActive) throw new DomainError("SUPPLIER", "Fournisseur invalide.", { fieldErrors: { supplierId: "Fournisseur invalide" } });
    if (!location || location.preparerId !== preparerId || !location.isActive || !location.validatedAt) {
      throw new DomainError("LOCATION", "Ce point de réception n'est pas disponible.", { fieldErrors: { locationId: "Point de réception invalide" } });
    }
    const compat = checkCompatibility(supplier, location);
    if (!compat.ok) throw new DomainError("INCOMPATIBLE", compat.reason, { fieldErrors: { locationId: compat.reason } });
    if (supplier.code === "OTHER" && !input.compatibilityConfirmed) {
      throw new DomainError("CONFIRM_COMPAT", "Confirmez que ce fournisseur livre bien à ce point de réception.", {
        fieldErrors: { compatibilityConfirmed: "Confirmation requise" },
      });
    }
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 999) {
      throw new DomainError("QUANTITY", "Quantité invalide.", { fieldErrors: { quantity: "Entre 1 et 999" } });
    }

    const subscription = await getActiveSubscription(customerId, tx);
    const limit = subscription?.plan.storageLimit ?? null;
    if (limit !== null) {
      const used = await getStorageUsage(customerId, tx);
      const pending = await tx.supplierOrder.aggregate({
        where: { customerId, status: { in: ORDER_OPEN_STATUSES } },
        _sum: { quantity: true },
      });
      if (used + (pending._sum.quantity ?? 0) + input.quantity > limit) {
        throw new DomainError(
          "STORAGE_LIMIT",
          `Limite de stockage de votre offre atteinte (${limit} articles). Expédiez des articles ou passez à l'offre supérieure.`,
        );
      }
    }

    const order = await tx.supplierOrder.create({
      data: {
        reference: reference("CMD", 7),
        customerId,
        preparerId,
        supplierId: supplier.id,
        supplierLabel: supplier.code === "OTHER" ? input.supplierLabel?.trim() || "Autre fournisseur" : null,
        locationId: location.id,
        articleUrl: input.articleUrl?.trim() || null,
        supplierOrderNumber: input.supplierOrderNumber?.trim() || null,
        trackingNumber: input.trackingNumber?.trim() || null,
        carrier: input.carrier || null,
        description: input.description.trim(),
        quantity: input.quantity,
        expectedArrivalAt: input.expectedArrivalAt ?? null,
        instructions: input.instructions?.trim() || null,
        compatibilityConfirmed: !!input.compatibilityConfirmed,
        parcels: {
          create: {
            customerId,
            preparerId,
            trackingNumber: input.trackingNumber?.trim() || null,
            carrier: input.carrier || null,
          },
        },
        events: {
          create: input.trackingNumber?.trim()
            ? [
                { status: "REGISTERED", actorId: actor.userId },
                { status: "IN_TRANSIT", actorId: actor.userId, note: "Numéro de suivi fourni à l'enregistrement" },
              ]
            : [{ status: "REGISTERED", actorId: actor.userId }],
        },
        ...(input.trackingNumber?.trim() ? { status: "IN_TRANSIT" as const } : {}),
      },
    });
    if (input.photoIds?.length) await linkPhotos(tx, actor, input.photoIds, { supplierOrderId: order.id, customerId });
    fx.notify(await preparerUserId(tx, preparerId), {
      type: "ORDER_CREATED",
      title: "Nouvelle commande enregistrée",
      body: `${actor.firstName} ${actor.lastName} attend « ${order.description} » (${supplier.code === "OTHER" ? order.supplierLabel : supplier.name}) à ${location.label}.`,
      link: `/preparateur/receptions/${order.id}`,
    });
    return order;
  });
}

/** Mises à jour côté client : suivi, code de retrait, statut d'acheminement. */
export async function customerUpdateOrder(
  actor: Actor,
  input: {
    orderId: string;
    status?: SupplierOrderStatus;
    trackingNumber?: string | null;
    carrier?: string | null;
    pickupCode?: string | null;
    supplierOrderNumber?: string | null;
    expectedArrivalAt?: Date | null;
    note?: string | null;
  },
) {
  const customerId = assertCustomer(actor);
  return withEffects(async (tx, fx) => {
    let order = await lockOrder(tx, input.orderId);
    if (order.customerId !== customerId) throw new ForbiddenError();
    const data: Partial<SupplierOrder> = {};
    if (input.trackingNumber !== undefined) data.trackingNumber = input.trackingNumber?.trim() || null;
    if (input.carrier !== undefined) data.carrier = input.carrier || null;
    if (input.pickupCode !== undefined) data.pickupCode = input.pickupCode?.trim() || null;
    if (input.supplierOrderNumber !== undefined) data.supplierOrderNumber = input.supplierOrderNumber?.trim() || null;
    if (input.expectedArrivalAt !== undefined) data.expectedArrivalAt = input.expectedArrivalAt;
    if (Object.keys(data).length) {
      order = await tx.supplierOrder.update({ where: { id: order.id }, data });
      if (data.trackingNumber !== undefined || data.carrier !== undefined) {
        await tx.inboundParcel.updateMany({
          where: { supplierOrderId: order.id, status: "EXPECTED" },
          data: { trackingNumber: order.trackingNumber, carrier: order.carrier },
        });
      }
    }
    let nextStatus = input.status;
    if (!nextStatus && data.trackingNumber && (order.status === "REGISTERED" || order.status === "SUPPLIER_CONFIRMED")) nextStatus = "IN_TRANSIT";
    if (nextStatus && nextStatus !== order.status) {
      assertTransition(CUSTOMER_TRANSITIONS, order.status, nextStatus);
      order = await setStatus(tx, order, nextStatus, actor.userId, input.note);
      if (nextStatus === "AT_LOCKER") {
        await tx.inboundParcel.updateMany({ where: { supplierOrderId: order.id, status: "EXPECTED" }, data: { status: "AT_LOCKER" } });
      }
    }
    const preparerUser = await preparerUserId(tx, order.preparerId);
    if (nextStatus === "AT_LOCKER") {
      fx.notify(preparerUser, {
        type: "PARCEL_AT_LOCKER",
        title: "Colis disponible au locker",
        body: `« ${order.description} » (${order.reference}) est disponible${order.pickupCode ? " — code de retrait communiqué" : ""}.`,
        link: `/preparateur/receptions/${order.id}`,
      });
    } else if (Object.keys(data).length || nextStatus) {
      fx.notify(preparerUser, {
        type: "ORDER_UPDATED",
        title: "Commande mise à jour",
        body: `${order.reference} : ${SUPPLIER_ORDER_STATUS[order.status].label}${order.trackingNumber ? ` — suivi ${order.trackingNumber}` : ""}.`,
        link: `/preparateur/receptions/${order.id}`,
        dedupeKey: `order:${order.id}`,
      });
    }
    return order;
  });
}

/** Le préparateur déclare avoir récupéré le colis au locker / point relais. */
export async function markPickedUp(actor: Actor, input: { orderId: string; note?: string | null; photoIds?: string[] }) {
  return withEffects(async (tx, fx) => {
    let order = await preparerOrder(tx, actor, input.orderId);
    assertTransition(PREPARER_TRANSITIONS, order.status, "PICKED_UP");
    order = await setStatus(tx, order, "PICKED_UP", actor.userId, input.note);
    const now = new Date();
    await tx.inboundParcel.updateMany({
      where: { supplierOrderId: order.id, status: { in: ["EXPECTED", "AT_LOCKER"] } },
      data: { status: "PICKED_UP", pickedUpAt: now, pickedUpById: actor.userId },
    });
    if (input.photoIds?.length) await linkPhotos(tx, actor, input.photoIds, { supplierOrderId: order.id, customerId: order.customerId });
    fx.notify(await customerUserId(tx, order.customerId), {
      type: "PARCEL_PICKED_UP",
      title: "Colis récupéré",
      body: `Votre préparateur a récupéré « ${order.description} » (${order.reference}).`,
      link: `/client/commandes/${order.id}`,
    });
    return order;
  });
}

/** Réception et contrôle du contenu (quantité, état, photos). */
export async function receiveOrder(
  actor: Actor,
  input: { orderId: string; quantityReceived: number; conditionOk: boolean; conditionNotes?: string | null; photoIds?: string[]; qualityCheck?: boolean },
) {
  if (!Number.isInteger(input.quantityReceived) || input.quantityReceived < 0) throw new DomainError("QUANTITY", "Quantité reçue invalide.");
  return withEffects(async (tx, fx) => {
    let order = await preparerOrder(tx, actor, input.orderId);
    assertTransition(PREPARER_TRANSITIONS, order.status, "RECEIVED");
    const now = new Date();
    if (order.status !== "PICKED_UP") {
      await tx.inboundParcel.updateMany({
        where: { supplierOrderId: order.id, status: { in: ["EXPECTED", "AT_LOCKER"] } },
        data: { status: "PICKED_UP", pickedUpAt: now, pickedUpById: actor.userId },
      });
    }
    const parcel = await tx.inboundParcel.findFirst({ where: { supplierOrderId: order.id, status: { in: ["PICKED_UP", "EXPECTED", "AT_LOCKER"] } }, orderBy: { createdAt: "asc" } });
    if (parcel) {
      await tx.inboundParcel.update({
        where: { id: parcel.id },
        data: {
          status: "RECEIVED",
          receivedAt: now,
          receivedById: actor.userId,
          quantityReceived: input.quantityReceived,
          conditionOk: input.conditionOk,
          conditionNotes: input.conditionNotes?.trim() || null,
        },
      });
    }
    if (input.photoIds?.length) {
      await linkPhotos(tx, actor, input.photoIds, { supplierOrderId: order.id, inboundParcelId: parcel?.id, customerId: order.customerId });
    }
    const note = [
      `Quantité reçue : ${input.quantityReceived}/${order.quantity}`,
      input.conditionOk ? "État conforme" : "Défaut constaté",
      input.conditionNotes?.trim(),
    ]
      .filter(Boolean)
      .join(" — ");
    order = await setStatus(tx, order, "RECEIVED", actor.userId, note);
    if (input.qualityCheck || !input.conditionOk || input.quantityReceived !== order.quantity) {
      order = await setStatus(tx, order, "QUALITY_CHECK", actor.userId, "Contrôle qualité en cours");
    }
    fx.notify(await customerUserId(tx, order.customerId), {
      type: "PARCEL_RECEIVED",
      title: "Colis réceptionné",
      body: `« ${order.description} » a été réceptionné par votre préparateur. ${note}.`,
      link: `/client/commandes/${order.id}`,
    });
    return order;
  });
}

/** Mise en stock : création des articles du client à partir de la commande. */
export async function stockOrder(
  actor: Actor,
  input: { orderId: string; items: { name: string; quantity: number; storageLocation?: string | null; description?: string | null; photoIds?: string[] }[] },
) {
  if (!input.items.length) throw new DomainError("EMPTY", "Ajoutez au moins un article.");
  return withEffects(async (tx, fx) => {
    let order = await preparerOrder(tx, actor, input.orderId);
    assertTransition(PREPARER_TRANSITIONS, order.status, "IN_STOCK");
    const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: order.supplierId } });
    const created = [];
    for (const item of input.items) {
      created.push(
        await createStockItem(tx, fx, actor, {
          customerId: order.customerId,
          preparerId: order.preparerId,
          name: item.name,
          description: item.description,
          quantity: item.quantity,
          storageLocation: item.storageLocation,
          supplierName: supplier.code === "OTHER" ? order.supplierLabel : supplier.name,
          supplierOrderId: order.id,
          photoIds: item.photoIds,
        }),
      );
    }
    order = await setStatus(tx, order, "IN_STOCK", actor.userId, `${created.reduce((s, i) => s + i.quantityAvailable, 0)} article(s) mis en stock`);
    await tx.preparerProfile.update({ where: { id: order.preparerId }, data: { parcelsProcessed: { increment: 1 } } });
    return { order, items: created };
  });
}

/** Signalement d'un défaut / problème sur une commande entrante. */
export async function reportOrderProblem(
  actor: Actor,
  input: { orderId: string; type: IncidentType; description: string; photoIds?: string[] },
) {
  return withEffects(async (tx, fx: Effects) => {
    let order = await lockOrder(tx, input.orderId);
    const isOwner =
      (actor.role === "CUSTOMER" && order.customerId === actor.customerId) ||
      (actor.role === "PREPARER" && order.preparerId === actor.preparerId) ||
      (actor.role === "ADMIN" && can(actor, "operations.manage"));
    if (!isOwner) throw new ForbiddenError();
    const incident = await createIncidentTx(tx, fx, actor, {
      type: input.type,
      title: `${order.reference} — ${order.description}`.slice(0, 200),
      description: input.description,
      customerId: order.customerId,
      preparerId: order.preparerId,
      supplierOrderId: order.id,
      priority: "HIGH",
    });
    if (input.photoIds?.length) await linkPhotos(tx, actor, input.photoIds, { incidentId: incident.id, supplierOrderId: order.id, customerId: order.customerId });
    if (actor.role === "PREPARER" && order.status !== "INCIDENT" && PREPARER_TRANSITIONS[order.status]?.includes("INCIDENT")) {
      order = await setStatus(tx, order, "INCIDENT", actor.userId, input.description);
      await tx.inboundParcel.updateMany({ where: { supplierOrderId: order.id, status: { not: "RECEIVED" } }, data: { status: "ISSUE" } });
    }
    return { order, incident };
  });
}

export async function preparerSetOrderStatus(actor: Actor, input: { orderId: string; status: "QUALITY_CHECK" | "RETURNED_TO_SUPPLIER" | "AT_LOCKER"; note?: string | null }) {
  return withEffects(async (tx, fx) => {
    let order = await preparerOrder(tx, actor, input.orderId);
    assertTransition(PREPARER_TRANSITIONS, order.status, input.status);
    order = await setStatus(tx, order, input.status, actor.userId, input.note);
    fx.notify(await customerUserId(tx, order.customerId), {
      type: "ORDER_UPDATED",
      title: `Commande ${order.reference}`,
      body: `Statut : ${SUPPLIER_ORDER_STATUS[input.status].label}${input.note ? ` — ${input.note}` : ""}.`,
      link: `/client/commandes/${order.id}`,
    });
    return order;
  });
}

export async function getOrderForActor(actor: Actor, orderId: string) {
  const order = await db.supplierOrder.findUnique({
    where: { id: orderId },
    include: {
      supplier: true,
      location: true,
      parcels: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { firstName: true, lastName: true, role: true } } } },
      inventoryItems: { select: { id: true, sku: true, name: true, quantityReceived: true, quantityAvailable: true } },
      files: { where: { deletedAt: null }, select: { id: true, filename: true, mimeType: true, purpose: true, createdAt: true } },
      incidents: { select: { id: true, reference: true, status: true, title: true } },
      customer: { include: { user: { select: { firstName: true, lastName: true } } } },
      preparer: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!order) throw new NotFoundError("Commande introuvable.");
  const allowed =
    (actor.role === "CUSTOMER" && order.customerId === actor.customerId) ||
    (actor.role === "PREPARER" && order.preparerId === actor.preparerId) ||
    (actor.role === "ADMIN" && can(actor, "operations.read"));
  if (!allowed) throw new ForbiddenError();
  return order;
}

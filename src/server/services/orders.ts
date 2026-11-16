import type { SupplierOrder } from "@/generated/prisma/client";
import type { IncidentType, MarketplacePlatform, OrderMode, SupplierOrderStatus } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/db";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { assertCustomer, assertPreparer, can, type Actor } from "@/server/auth/actor";
import { reference } from "@/server/lib/ids";
import { ARRIVAL_OTHER, checkCompatibility } from "@/lib/compatibility";
import { SUPPLIER_ORDER_STATUS } from "@/lib/labels";
import { withEffects, type Effects } from "./notifications";
import { assertCustomerOperational } from "./customers";
import { createStockItem, linkPhotos } from "./inventory";
import { createIncidentTx } from "./incidents";
import { ensureCapacityForOrder } from "./storage";
import { createShipmentTx } from "./shipments";

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
          user: { select: { firstName: true, lastName: true, avatarFileId: true, phone: true } },
          locations: { where: { isActive: true, validatedAt: { not: null } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        },
      },
    },
  });
  if (!customer) throw new NotFoundError();
  const suppliers = await db.supplier.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  // Téléphone à indiquer sur les commandes : celui du lieu, sinon celui du préparateur.
  const locations = (customer.currentPreparer?.locations ?? []).map((l) => ({ ...l, recipientPhone: l.recipientPhone ?? customer.currentPreparer?.user.phone ?? null }));
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
  /** Accepte le débit de crédits pour des places de stock supplémentaires. */
  acceptStorageCharge?: boolean;
  /** Dropshipping : article déjà vendu, expédié à l'acheteur dès réception. */
  mode?: OrderMode;
  salePlatform?: MarketplacePlatform | null;
  saleReference?: string | null;
  buyerName?: string | null;
  buyerPhone?: string | null;
  buyerAddressLine1?: string | null;
  buyerAddressLine2?: string | null;
  buyerPostalCode?: string | null;
  buyerCity?: string | null;
  buyerCountry?: string | null;
  /** Bordereau d'expédition de la vente (ex. bordereau Vinted). */
  labelFileId?: string | null;
  /**
   * Vente d'un compte lié (Packio Connect) déclarée « Vendu en dropshipping » :
   * plateforme et référence reprises, bordereau joint automatiquement (déjà
   * reçu ou à venir).
   */
  marketplaceSaleId?: string | null;
  /**
   * Lieu d'arrivée indiqué par le client : précision libre (casier, point
   * relais choisi à l'achat…). Avec `locationId` = ARRIVAL_OTHER, le colis
   * arrive à un autre point que ceux du préparateur : la précision est alors
   * obligatoire.
   */
  arrivalNote?: string | null;
};


function validateDropship(input: CreateOrderInput) {
  if (input.mode !== "DROPSHIP") return;
  if (input.marketplaceSaleId) return; // Bordereau transmis par Packio Connect.
  const hasAddress = !!(input.buyerName?.trim() && input.buyerAddressLine1?.trim() && input.buyerPostalCode?.trim() && input.buyerCity?.trim());
  if (!input.labelFileId && !hasAddress) {
    throw new DomainError("DROPSHIP_RECIPIENT", "Ajoutez le bordereau de la vente, ou l'adresse complète de l'acheteur.", {
      fieldErrors: { labelFileId: "Bordereau ou adresse de l'acheteur requis", buyerAddressLine1: "Adresse requise sans bordereau" },
    });
  }
}

export async function createSupplierOrder(actor: Actor, input: CreateOrderInput) {
  const customerId = assertCustomer(actor);
  validateDropship(input);
  const dropship = input.mode === "DROPSHIP";
  return withEffects(async (tx, fx) => {
    const customer = await assertCustomerOperational(tx, customerId);
    const preparerId = customer.currentPreparerId!;
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    // « Autre point » : rattaché au point principal du préparateur, précision obligatoire.
    const arrivalOther = input.locationId === ARRIVAL_OTHER;
    const arrivalNote = input.arrivalNote?.trim() || null;
    if (arrivalOther && (!arrivalNote || arrivalNote.length < 5)) {
      throw new DomainError("ARRIVAL", "Indiquez où arrivera le colis (nom et adresse du point relais ou du locker).", { fieldErrors: { arrivalNote: "Précisez le point d'arrivée" } });
    }
    const location = arrivalOther
      ? await tx.preparerLocation.findFirst({ where: { preparerId, isActive: true, validatedAt: { not: null } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] })
      : await tx.preparerLocation.findUnique({ where: { id: input.locationId } });
    if (!supplier || !supplier.isActive) throw new DomainError("SUPPLIER", "Fournisseur invalide.", { fieldErrors: { supplierId: "Fournisseur invalide" } });
    if (!supplier.orderModes.includes(dropship ? "DROPSHIP" : "STOCK")) {
      throw new DomainError("SUPPLIER_MODE", dropship ? `${supplier.name} n'est pas proposé pour le dropshipping.` : `${supplier.name} n'est pas proposé pour les commandes vers le stock.`, {
        fieldErrors: { supplierId: "Fournisseur non proposé pour ce type de commande" },
      });
    }
    if (!location || location.preparerId !== preparerId || !location.isActive || !location.validatedAt) {
      throw new DomainError("LOCATION", "Ce point de réception n'est pas disponible.", { fieldErrors: { locationId: "Point de réception invalide" } });
    }
    const compat = arrivalOther ? { ok: true as const, reason: "" } : checkCompatibility(supplier, location);
    if (!compat.ok) throw new DomainError("INCOMPATIBLE", compat.reason, { fieldErrors: { locationId: compat.reason } });
    if (supplier.code === "OTHER" && !input.compatibilityConfirmed) {
      throw new DomainError("CONFIRM_COMPAT", "Confirmez que ce fournisseur livre bien à ce point de réception.", {
        fieldErrors: { compatibilityConfirmed: "Confirmation requise" },
      });
    }
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 999) {
      throw new DomainError("QUANTITY", "Quantité invalide.", { fieldErrors: { quantity: "Entre 1 et 999" } });
    }

    if (input.labelFileId) {
      const file = await tx.file.findUnique({ where: { id: input.labelFileId } });
      if (!file || file.uploadedById !== actor.userId || file.shipmentId || file.supplierOrderId || file.deletedAt) throw new DomainError("LABEL", "Bordereau invalide.");
    }

    // Vente d'un compte lié : une seule commande par vente, encore à traiter.
    let sale: { id: string; platform: MarketplacePlatform; externalOrderId: string; buyerName: string | null } | null = null;
    let saleLabelId: string | null = null;
    if (input.marketplaceSaleId) {
      if (!dropship) throw new DomainError("SALE_MODE", "Une vente ne peut être liée qu'à une commande en dropshipping.");
      await tx.$queryRaw`SELECT "id" FROM "marketplace_sales" WHERE "id" = ${input.marketplaceSaleId} FOR UPDATE`;
      const row = await tx.marketplaceSale.findUnique({ where: { id: input.marketplaceSaleId } });
      if (!row || row.customerId !== customerId) throw new NotFoundError("Vente introuvable.");
      if (row.shipmentId || row.dropshipOrderId || !["NEW", "MATCHED"].includes(row.status)) {
        throw new DomainError("SALE_HANDLED", "Cette vente est déjà traitée (expédition ou commande existante, ou vente supprimée).");
      }
      sale = row;
      if (!input.labelFileId) {
        const label = await tx.file.findFirst({
          where: { marketplaceSaleId: row.id, purpose: "SHIPPING_LABEL", deletedAt: null, shipmentId: null, supplierOrderId: null },
          orderBy: { createdAt: "desc" },
        });
        saleLabelId = label?.id ?? null;
      }
    }

    // Places de stock : au-delà de la capacité, des places sont achetées avec
    // des crédits (accord explicite du client). Le dropshipping n'en occupe pas.
    const ref = reference("CMD", 7);
    const storage = dropship
      ? { credits: 0, slots: 0 }
      : await ensureCapacityForOrder(tx, { customerId, quantity: input.quantity, acceptCharge: !!input.acceptStorageCharge, actorId: actor.userId, orderReference: ref });

    const order = await tx.supplierOrder.create({
      data: {
        reference: ref,
        mode: dropship ? "DROPSHIP" : "STOCK",
        storageCreditsCharged: storage.credits,
        ...(dropship
          ? {
              salePlatform: sale?.platform ?? input.salePlatform ?? null,
              saleReference: sale?.externalOrderId ?? (input.saleReference?.trim() || null),
              buyerName: input.buyerName?.trim() || sale?.buyerName || null,
              buyerPhone: input.buyerPhone?.trim() || null,
              buyerAddressLine1: input.buyerAddressLine1?.trim() || null,
              buyerAddressLine2: input.buyerAddressLine2?.trim() || null,
              buyerPostalCode: input.buyerPostalCode?.trim() || null,
              buyerCity: input.buyerCity?.trim() || null,
              buyerCountry: input.buyerCountry?.trim().toUpperCase() || "FR",
            }
          : {}),
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
        arrivalOther,
        arrivalNote: arrivalNote?.slice(0, 500) ?? null,
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
    if (input.labelFileId) {
      await tx.file.update({ where: { id: input.labelFileId }, data: { supplierOrderId: order.id, customerId, purpose: "SHIPPING_LABEL" } });
    }
    if (sale) {
      if (saleLabelId) await tx.file.update({ where: { id: saleLabelId }, data: { supplierOrderId: order.id, preparerId } });
      await tx.marketplaceSale.update({ where: { id: sale.id }, data: { status: "DROPSHIP", dropshipOrderId: order.id, notes: null } });
    }
    fx.notify(await preparerUserId(tx, preparerId), {
      type: "ORDER_CREATED",
      title: dropship ? "Commande en dropshipping (expédition express)" : "Nouvelle commande enregistrée",
      body: dropship
        ? `${actor.firstName} ${actor.lastName} a vendu « ${order.description} » : à réceptionner ${arrivalOther ? `à un autre point (${arrivalNote})` : `à ${location.label}`}, puis à expédier à l'acheteur sous 48 h.`
        : `${actor.firstName} ${actor.lastName} attend « ${order.description} » (${supplier.code === "OTHER" ? order.supplierLabel : supplier.name}) ${arrivalOther ? `à un autre point : ${arrivalNote}` : `à ${location.label}${arrivalNote ? ` (${arrivalNote})` : ""}`}.`,
      link: `/preparateur/receptions/${order.id}`,
    });
    if (storage.credits > 0) {
      fx.notify(actor.userId, {
        type: "STORAGE_CHARGED",
        title: "Places de stock ajoutées",
        body: `Votre commande ${order.reference} dépassait vos places de stock : ${storage.slots} places ajoutées pour ${storage.credits} crédit${storage.credits > 1 ? "s" : ""}.`,
        link: "/client/stock",
      });
    }
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
    const dropship = order.mode === "DROPSHIP";
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
          dropship,
        }),
      );
    }
    const total = created.reduce((s, i) => s + i.quantityAvailable, 0);
    order = await setStatus(tx, order, "IN_STOCK", actor.userId, dropship ? `${total} article(s) reçu(s) : expédition express créée` : `${total} article(s) mis en stock`);
    await tx.preparerProfile.update({ where: { id: order.preparerId }, data: { parcelsProcessed: { increment: 1 } } });

    let shipment = null;
    if (dropship) {
      // Dropshipping : expédition à l'acheteur créée immédiatement (délai 48 h).
      const label = await tx.file.findFirst({ where: { supplierOrderId: order.id, purpose: "SHIPPING_LABEL", shipmentId: null, deletedAt: null }, orderBy: { createdAt: "desc" } });
      const platform = order.salePlatform === "VINTED" ? "Vinted" : order.salePlatform === "VESTIAIRE" ? "Vestiaire Collective" : null;
      shipment = await createShipmentTx(tx, fx, {
        customerId: order.customerId,
        actorUserId: actor.userId,
        system: true,
        kind: "DROPSHIP",
        items: created.map((i) => ({ itemId: i.id, quantity: i.quantityAvailable })),
        recipientName: order.buyerName ?? (platform ? `Acheteur ${platform}` : "Acheteur"),
        recipientPhone: order.buyerPhone,
        addressLine1: order.buyerAddressLine1 ?? "Adresse indiquée sur le bordereau",
        addressLine2: order.buyerAddressLine2,
        postalCode: order.buyerPostalCode ?? "",
        city: order.buyerCity ?? "Voir bordereau",
        country: order.buyerCountry ?? "FR",
        labelMode: label ? "CUSTOMER_PROVIDED" : "PREPARER_PROVIDED",
        labelFileId: label?.id ?? null,
        instructions: [order.saleReference ? `Vente ${platform ?? ""} ${order.saleReference}`.replace("  ", " ") : null, order.instructions].filter(Boolean).join(" — ") || null,
      });
      order = await tx.supplierOrder.update({ where: { id: order.id }, data: { dropshipShipmentId: shipment.id } });
    }
    return { order, items: created, shipment };
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

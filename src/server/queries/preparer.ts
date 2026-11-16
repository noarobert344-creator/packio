import "server-only";
import type { InventoryStatus, OrderMode, ShipmentStatus, SupplierOrderStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { SHIPMENT_ACTIVE_STATUSES } from "@/lib/labels";

/**
 * Requêtes de lecture de l'espace préparateur. Toutes sont filtrées par
 * l'identifiant du préparateur connecté : un préparateur ne voit que ses
 * clients attribués et les opérations qui lui sont confiées.
 */

export const PAGE_SIZE = 20;

export const ORDER_GROUPS = {
  recuperer: { label: "À récupérer", statuses: ["REGISTERED", "SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER"] },
  receptionner: { label: "À réceptionner", statuses: ["PICKED_UP"] },
  controle: { label: "Contrôle & mise en stock", statuses: ["RECEIVED", "QUALITY_CHECK", "INCIDENT"] },
  terminees: { label: "Terminées", statuses: ["IN_STOCK", "RETURNED_TO_SUPPLIER", "CANCELLED"] },
} satisfies Record<string, { label: string; statuses: SupplierOrderStatus[] }>;
export type OrderGroup = keyof typeof ORDER_GROUPS;

export const SHIPMENT_GROUPS = {
  classifier: { label: "À classifier", statuses: ["REQUESTED", "AWAITING_CLASSIFICATION"] },
  credits: { label: "En attente de crédits", statuses: ["AWAITING_CREDITS"] },
  preparer: { label: "À préparer", statuses: ["CLASSIFIED", "PREPARING", "READY", "LABEL_READY"] },
  expediees: { label: "Expédiées", statuses: ["DROPPED_OFF", "IN_TRANSIT"] },
  terminees: { label: "Terminées", statuses: ["DELIVERED", "CANCELLED", "INCIDENT"] },
} satisfies Record<string, { label: string; statuses: ShipmentStatus[] }>;
export type ShipmentGroup = keyof typeof SHIPMENT_GROUPS;

const customerSelect = {
  select: { id: true, referenceCode: true, user: { select: { firstName: true, lastName: true } } },
} as const;

export async function getTodayLists(preparerId: string) {
  const now = new Date();
  const [atLocker, toClassify, toPrepare, absences] = await Promise.all([
    db.supplierOrder.findMany({
      where: { preparerId, status: { in: ["AT_LOCKER", "IN_TRANSIT"] } },
      orderBy: [{ status: "asc" }, { statusChangedAt: "asc" }],
      take: 12,
      include: { customer: customerSelect, location: { select: { label: true, relayName: true, city: true, type: true } }, supplier: { select: { name: true, code: true } } },
    }),
    db.outboundShipment.findMany({
      where: { preparerId, status: { in: ["REQUESTED", "AWAITING_CLASSIFICATION"] } },
      orderBy: { createdAt: "asc" },
      take: 10,
      include: { customer: customerSelect, _count: { select: { items: true } } },
    }),
    db.outboundShipment.findMany({
      where: { preparerId, status: { in: ["CLASSIFIED", "PREPARING", "READY", "LABEL_READY"] } },
      orderBy: { createdAt: "asc" },
      take: 10,
      include: { customer: customerSelect, _count: { select: { items: true } } },
    }),
    db.preparerAbsence.findMany({
      where: { preparerId, cancelledAt: null, endsAt: { gte: now } },
      orderBy: { startsAt: "asc" },
      take: 3,
    }),
  ]);
  return { atLocker, toClassify, toPrepare, absences };
}

export async function listMyClients(preparerId: string) {
  const assignments = await db.preparerAssignment.findMany({
    where: { preparerId, status: "ACTIVE" },
    orderBy: { assignedAt: "desc" },
    include: {
      customer: {
        include: {
          user: { select: { firstName: true, lastName: true } },
          subscriptions: { where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, include: { plan: { select: { name: true } } }, take: 1, orderBy: { createdAt: "desc" } },
        },
      },
    },
  });
  const customerIds = assignments.map((a) => a.customerId);
  const [stock, openOrders, activeShipments, conversations] = await Promise.all([
    db.inventoryItem.groupBy({ by: ["customerId"], where: { preparerId, customerId: { in: customerIds } }, _sum: { quantityAvailable: true, quantityReserved: true } }),
    db.supplierOrder.groupBy({
      by: ["customerId"],
      where: { preparerId, customerId: { in: customerIds }, status: { in: ["REGISTERED", "SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER", "PICKED_UP", "RECEIVED", "QUALITY_CHECK", "INCIDENT"] } },
      _count: true,
    }),
    db.outboundShipment.groupBy({ by: ["customerId"], where: { preparerId, customerId: { in: customerIds }, status: { in: SHIPMENT_ACTIVE_STATUSES } }, _count: true }),
    db.conversation.findMany({ where: { type: "CUSTOMER_PREPARER", preparerId, customerId: { in: customerIds } }, select: { id: true, customerId: true } }),
  ]);
  return assignments.map((a) => {
    const s = stock.find((x) => x.customerId === a.customerId);
    return {
      assignmentId: a.id,
      assignedAt: a.assignedAt,
      customer: a.customer,
      plan: a.customer.subscriptions[0]?.plan.name ?? null,
      stockUnits: (s?._sum.quantityAvailable ?? 0) + (s?._sum.quantityReserved ?? 0),
      openOrders: openOrders.find((x) => x.customerId === a.customerId)?._count ?? 0,
      activeShipments: activeShipments.find((x) => x.customerId === a.customerId)?._count ?? 0,
      conversationId: conversations.find((c) => c.customerId === a.customerId)?.id ?? null,
    };
  });
}

/** Vue opérationnelle d'un client, uniquement s'il est activement attribué au préparateur. */
export async function getMyClient(preparerId: string, customerId: string) {
  const assignment = await db.preparerAssignment.findFirst({ where: { preparerId, customerId, status: "ACTIVE" } });
  if (!assignment) return null;
  const [customer, orders, items, shipments, conversation] = await Promise.all([
    db.customerProfile.findUnique({
      where: { id: customerId },
      include: {
        user: { select: { firstName: true, lastName: true } },
        subscriptions: { where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, include: { plan: { select: { name: true, storageLimit: true } } }, take: 1, orderBy: { createdAt: "desc" } },
      },
    }),
    db.supplierOrder.findMany({ where: { preparerId, customerId }, orderBy: { createdAt: "desc" }, take: 25, include: { supplier: { select: { name: true, code: true } } } }),
    db.inventoryItem.findMany({
      where: { preparerId, customerId, status: { not: "ARCHIVED" } },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: { files: { where: { purpose: "PRODUCT_PHOTO", deletedAt: null }, select: { id: true }, take: 1 } },
    }),
    db.outboundShipment.findMany({ where: { preparerId, customerId }, orderBy: { createdAt: "desc" }, take: 25, include: { _count: { select: { items: true } } } }),
    db.conversation.findFirst({ where: { type: "CUSTOMER_PREPARER", preparerId, customerId }, select: { id: true } }),
  ]);
  if (!customer) return null;
  return { assignment, customer, orders, items, shipments, conversationId: conversation?.id ?? null };
}

export async function listMyOrders(preparerId: string, opts: { group: OrderGroup; q?: string; page: number; mode?: OrderMode }) {
  const q = opts.q?.trim();
  const search = q
    ? {
        OR: [
          { reference: { contains: q, mode: "insensitive" as const } },
          { description: { contains: q, mode: "insensitive" as const } },
          { trackingNumber: { contains: q, mode: "insensitive" as const } },
          { customer: { referenceCode: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : {};
  const scope = { preparerId, ...(opts.mode ? { mode: opts.mode } : {}) };
  const where = { ...scope, status: { in: ORDER_GROUPS[opts.group].statuses }, ...search };
  const [items, total, counts] = await Promise.all([
    db.supplierOrder.findMany({
      where,
      // « À récupérer » : les colis arrivés (code de retrait transmis) d'abord.
      orderBy:
        opts.group === "terminees"
          ? [{ statusChangedAt: "desc" as const }]
          : opts.group === "recuperer"
            ? [{ status: "desc" as const }, { statusChangedAt: "asc" as const }]
            : [{ createdAt: "asc" as const }],
      skip: (opts.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        customer: customerSelect,
        supplier: { select: { name: true, code: true } },
        location: { select: { label: true, relayName: true, type: true, city: true } },
      },
    }),
    db.supplierOrder.count({ where }),
    db.supplierOrder.groupBy({ by: ["status"], where: scope, _count: true }),
  ]);
  const groupCounts = Object.fromEntries(
    (Object.keys(ORDER_GROUPS) as OrderGroup[]).map((g) => [
      g,
      counts.filter((c) => (ORDER_GROUPS[g].statuses as SupplierOrderStatus[]).includes(c.status)).reduce((s, c) => s + c._count, 0),
    ]),
  ) as Record<OrderGroup, number>;
  return { items, total, groupCounts };
}

export async function listMyItems(preparerId: string, opts: { customerId?: string; status?: InventoryStatus; q?: string; page: number }) {
  const q = opts.q?.trim();
  const where = {
    preparerId,
    ...(opts.customerId ? { customerId: opts.customerId } : {}),
    ...(opts.status ? { status: opts.status } : { status: { not: "ARCHIVED" as const } }),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { sku: { contains: q, mode: "insensitive" as const } },
            { storageLocation: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [items, total, totals, clients] = await Promise.all([
    db.inventoryItem.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (opts.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        customer: customerSelect,
        files: { where: { purpose: "PRODUCT_PHOTO", deletedAt: null }, select: { id: true }, take: 1 },
      },
    }),
    db.inventoryItem.count({ where }),
    db.inventoryItem.aggregate({ where: { preparerId }, _sum: { quantityAvailable: true, quantityReserved: true }, _count: true }),
    db.customerProfile.findMany({
      where: { inventoryItems: { some: { preparerId } } },
      select: { id: true, referenceCode: true, user: { select: { firstName: true, lastName: true } } },
      orderBy: { referenceCode: "asc" },
    }),
  ]);
  return { items, total, totals, clients };
}

export async function getItemMovements(itemId: string) {
  return db.inventoryMovement.findMany({
    where: { itemId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: { select: { firstName: true, lastName: true, role: true } } },
  });
}

export async function getItemExtras(itemId: string) {
  return db.inventoryItem.findUnique({
    where: { id: itemId },
    select: {
      customer: customerSelect,
      supplierOrder: { select: { id: true, reference: true } },
      files: { where: { deletedAt: null, purpose: { in: ["PRODUCT_PHOTO", "RECEPTION_PHOTO"] } }, select: { id: true, filename: true, mimeType: true }, orderBy: { createdAt: "asc" } },
      shipmentItems: {
        select: { quantity: true, shipment: { select: { id: true, reference: true, status: true, createdAt: true } } },
        orderBy: { shipment: { createdAt: "desc" } },
        take: 10,
      },
    },
  });
}

/**
 * Colis à envoyer : envois depuis le stock (ventes et retours) ou dropshipping,
 * toujours présentés séparément.
 */
export async function listMyShipments(preparerId: string, opts: { group: ShipmentGroup; q?: string; page: number; dropship?: boolean }) {
  const q = opts.q?.trim();
  const scope = { preparerId, kind: opts.dropship ? ("DROPSHIP" as const) : { not: "DROPSHIP" as const } };
  const where = {
    ...scope,
    status: { in: SHIPMENT_GROUPS[opts.group].statuses },
    ...(q
      ? {
          OR: [
            { reference: { contains: q, mode: "insensitive" as const } },
            { recipientName: { contains: q, mode: "insensitive" as const } },
            { trackingNumber: { contains: q, mode: "insensitive" as const } },
            { customer: { referenceCode: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
  const [items, total, counts] = await Promise.all([
    db.outboundShipment.findMany({
      where,
      orderBy: ["expediees", "terminees"].includes(opts.group) ? { updatedAt: "desc" } : { createdAt: "asc" },
      skip: (opts.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { customer: customerSelect, items: { select: { quantity: true } } },
    }),
    db.outboundShipment.count({ where }),
    db.outboundShipment.groupBy({ by: ["status"], where: scope, _count: true }),
  ]);
  const groupCounts = Object.fromEntries(
    (Object.keys(SHIPMENT_GROUPS) as ShipmentGroup[]).map((g) => [
      g,
      counts.filter((c) => (SHIPMENT_GROUPS[g].statuses as ShipmentStatus[]).includes(c.status)).reduce((s, c) => s + c._count, 0),
    ]),
  ) as Record<ShipmentGroup, number>;
  return { items, total, groupCounts };
}

export async function getShipmentConversationId(preparerId: string, customerId: string) {
  const c = await db.conversation.findFirst({ where: { type: "CUSTOMER_PREPARER", preparerId, customerId, status: "OPEN" }, select: { id: true } });
  return c?.id ?? null;
}

export async function listMyIncidents(preparerId: string, opts: { status?: string; page: number }) {
  const statuses = opts.status === "fermes" ? (["RESOLVED", "CLOSED"] as const) : (["OPEN", "IN_PROGRESS"] as const);
  const where = { preparerId, status: { in: [...statuses] } };
  const [items, total, open, closed] = await Promise.all([
    db.incident.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { customer: customerSelect, supplierOrder: { select: { reference: true } }, shipment: { select: { reference: true } } },
    }),
    db.incident.count({ where }),
    db.incident.count({ where: { preparerId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.incident.count({ where: { preparerId, status: { in: ["RESOLVED", "CLOSED"] } } }),
  ]);
  return { items, total, open, closed };
}

export async function getAvailabilityData(preparerId: string) {
  const [profile, absences, locations] = await Promise.all([
    db.preparerProfile.findUniqueOrThrow({ where: { id: preparerId }, select: { availability: true, availabilityNote: true, status: true, city: true } }),
    db.preparerAbsence.findMany({ where: { preparerId }, orderBy: { startsAt: "desc" }, take: 20 }),
    db.preparerLocation.findMany({ where: { preparerId }, orderBy: [{ isActive: "desc" }, { isPrimary: "desc" }, { createdAt: "asc" }] }),
  ]);
  return { profile, absences, locations };
}

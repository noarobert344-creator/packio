import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type {
  CreditTransactionType,
  InventoryStatus,
  PaymentKind,
  PaymentStatus,
  ShipmentStatus,
  SubscriptionStatus,
  SupplierOrderStatus,
  WebhookEventStatus,
} from "@/generated/prisma/enums";
import { db } from "@/server/db";

/**
 * Requêtes de lecture du back-office (opérations, revenus, configuration).
 * Les pages appelantes vérifient les permissions avec requireAdmin().
 */

export const PAGE_SIZE = 20;

const ci = (q: string) => ({ contains: q, mode: "insensitive" as const });

function customerSearch(q: string): Prisma.CustomerProfileWhereInput {
  return { OR: [{ referenceCode: ci(q) }, { companyName: ci(q) }, { user: { OR: [{ email: ci(q) }, { firstName: ci(q) }, { lastName: ci(q) }] } }] };
}

// ----------------------------------------------------------------------------- Commandes

export const ORDER_GROUPS: Record<string, { label: string; statuses: SupplierOrderStatus[] }> = {
  acheminement: { label: "En acheminement", statuses: ["REGISTERED", "SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER"] },
  reception: { label: "En réception", statuses: ["PICKED_UP", "RECEIVED", "QUALITY_CHECK"] },
  stock: { label: "En stock", statuses: ["IN_STOCK"] },
  incident: { label: "Incidents", statuses: ["INCIDENT", "RETURNED_TO_SUPPLIER"] },
  annulee: { label: "Annulées", statuses: ["CANCELLED"] },
};

export async function listOrders(f: { q?: string; group?: string; supplierId?: string; preparerId?: string; page: number; take?: number }) {
  const where: Prisma.SupplierOrderWhereInput = {
    ...(f.group && ORDER_GROUPS[f.group] ? { status: { in: ORDER_GROUPS[f.group].statuses } } : {}),
    ...(f.supplierId ? { supplierId: f.supplierId } : {}),
    ...(f.preparerId ? { preparerId: f.preparerId } : {}),
    ...(f.q
      ? { OR: [{ reference: ci(f.q) }, { trackingNumber: ci(f.q) }, { description: ci(f.q) }, { supplierOrderNumber: ci(f.q) }, { customer: customerSearch(f.q) }] }
      : {}),
  };
  const take = f.take ?? PAGE_SIZE;
  const [items, total, counts] = await Promise.all([
    db.supplierOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * take,
      take,
      include: {
        supplier: { select: { name: true, code: true } },
        customer: { select: { id: true, referenceCode: true, user: { select: { firstName: true, lastName: true } } } },
        preparer: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    db.supplierOrder.count({ where }),
    db.supplierOrder.groupBy({ by: ["status"], _count: true }),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number>;
  const groupCounts = Object.fromEntries(
    Object.entries(ORDER_GROUPS).map(([k, g]) => [k, g.statuses.reduce((s, st) => s + (byStatus[st] ?? 0), 0)]),
  ) as Record<string, number>;
  return { items, total, groupCounts, all: counts.reduce((s, c) => s + c._count, 0) };
}

export async function filterOptions() {
  const [suppliers, preparers] = await Promise.all([
    db.supplier.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.preparerProfile.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, user: { select: { firstName: true, lastName: true } } } }),
  ]);
  return {
    suppliers: suppliers.map((s) => ({ value: s.id, label: s.name })),
    preparers: preparers.map((p) => ({ value: p.id, label: `${p.user.firstName} ${p.user.lastName}` })),
  };
}

// ----------------------------------------------------------------------------- Stocks

export async function listInventory(f: { q?: string; status?: InventoryStatus; preparerId?: string; customer?: string; page: number; take?: number }) {
  const where: Prisma.InventoryItemWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.preparerId ? { preparerId: f.preparerId } : {}),
    ...(f.customer ? { customer: customerSearch(f.customer) } : {}),
    ...(f.q ? { OR: [{ name: ci(f.q) }, { sku: ci(f.q) }, { storageLocation: ci(f.q) }] } : {}),
  };
  const take = f.take ?? PAGE_SIZE;
  const [items, total, totals] = await Promise.all([
    db.inventoryItem.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (f.page - 1) * take,
      take,
      include: {
        customer: { select: { id: true, referenceCode: true, user: { select: { firstName: true, lastName: true } } } },
        preparer: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
        files: { where: { purpose: "PRODUCT_PHOTO", deletedAt: null }, select: { id: true }, take: 1 },
      },
    }),
    db.inventoryItem.count({ where }),
    db.inventoryItem.aggregate({
      _sum: { quantityAvailable: true, quantityReserved: true, quantityDamaged: true, quantityMissing: true, quantityShipped: true },
      _count: true,
    }),
  ]);
  return { items, total, totals };
}

export async function preparerStorageUsage() {
  const [preparers, stock] = await Promise.all([
    db.preparerProfile.findMany({ select: { id: true, storageCapacity: true, status: true, city: true, user: { select: { firstName: true, lastName: true } } } }),
    db.inventoryItem.groupBy({ by: ["preparerId"], _sum: { quantityAvailable: true, quantityReserved: true }, _count: true }),
  ]);
  return preparers
    .map((p) => {
      const s = stock.find((x) => x.preparerId === p.id);
      const units = (s?._sum.quantityAvailable ?? 0) + (s?._sum.quantityReserved ?? 0);
      return { id: p.id, name: `${p.user.firstName} ${p.user.lastName}`, city: p.city, status: p.status, capacity: p.storageCapacity, units, items: s?._count ?? 0 };
    })
    .sort((a, b) => b.units / Math.max(1, b.capacity) - a.units / Math.max(1, a.capacity));
}

export async function getInventoryItemDetail(id: string) {
  return db.inventoryItem.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, referenceCode: true, user: { select: { firstName: true, lastName: true } } } },
      preparer: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
      supplierOrder: { select: { id: true, reference: true, description: true } },
      files: { where: { deletedAt: null }, select: { id: true, filename: true, mimeType: true } },
      movements: { orderBy: { createdAt: "desc" }, include: { actor: { select: { firstName: true, lastName: true, role: true } } } },
      shipmentItems: { include: { shipment: { select: { id: true, reference: true, status: true } } } },
      incidents: { select: { id: true, reference: true, status: true, title: true } },
    },
  });
}

// ----------------------------------------------------------------------------- Expéditions

export const SHIPMENT_GROUPS: Record<string, { label: string; statuses: ShipmentStatus[] }> = {
  classification: { label: "À classifier", statuses: ["REQUESTED", "AWAITING_CLASSIFICATION"] },
  credits: { label: "En attente de crédits", statuses: ["AWAITING_CREDITS"] },
  preparation: { label: "En préparation", statuses: ["CLASSIFIED", "PREPARING", "READY", "LABEL_READY"] },
  expediees: { label: "Expédiées", statuses: ["DROPPED_OFF", "IN_TRANSIT"] },
  livrees: { label: "Livrées", statuses: ["DELIVERED"] },
  incidents: { label: "Incidents", statuses: ["INCIDENT"] },
  annulees: { label: "Annulées", statuses: ["CANCELLED"] },
};

export async function listShipments(f: { q?: string; group?: string; preparerId?: string; page: number; take?: number }) {
  const where: Prisma.OutboundShipmentWhereInput = {
    ...(f.group && SHIPMENT_GROUPS[f.group] ? { status: { in: SHIPMENT_GROUPS[f.group].statuses } } : {}),
    ...(f.preparerId ? { preparerId: f.preparerId } : {}),
    ...(f.q ? { OR: [{ reference: ci(f.q) }, { trackingNumber: ci(f.q) }, { recipientName: ci(f.q) }, { city: ci(f.q) }, { customer: customerSearch(f.q) }] } : {}),
  };
  const take = f.take ?? PAGE_SIZE;
  const [items, total, counts] = await Promise.all([
    db.outboundShipment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * take,
      take,
      include: {
        customer: { select: { id: true, referenceCode: true, user: { select: { firstName: true, lastName: true } } } },
        preparer: { select: { id: true, user: { select: { firstName: true, lastName: true } } } },
        _count: { select: { items: true } },
      },
    }),
    db.outboundShipment.count({ where }),
    db.outboundShipment.groupBy({ by: ["status"], _count: true }),
  ]);
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number>;
  const groupCounts = Object.fromEntries(
    Object.entries(SHIPMENT_GROUPS).map(([k, g]) => [k, g.statuses.reduce((s, st) => s + (byStatus[st] ?? 0), 0)]),
  ) as Record<string, number>;
  return { items, total, groupCounts, all: counts.reduce((s, c) => s + c._count, 0) };
}

// ----------------------------------------------------------------------------- Abonnements

export async function listSubscriptions(f: { status?: SubscriptionStatus; page: number; take?: number }) {
  const where: Prisma.SubscriptionWhereInput = f.status ? { status: f.status } : {};
  const take = f.take ?? PAGE_SIZE;
  const [items, total, active] = await Promise.all([
    db.subscription.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * take,
      take,
      include: { plan: { select: { name: true, priceCents: true, currency: true } }, customer: { select: { id: true, referenceCode: true, user: { select: { firstName: true, lastName: true } } } } },
    }),
    db.subscription.count({ where }),
    db.subscription.findMany({ where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, select: { status: true, cancelAtPeriodEnd: true, plan: { select: { priceCents: true } } } }),
  ]);
  return {
    items,
    total,
    kpis: {
      mrrCents: active.filter((s) => s.status !== "PAST_DUE").reduce((sum, s) => sum + s.plan.priceCents, 0),
      active: active.filter((s) => s.status !== "PAST_DUE").length,
      pastDue: active.filter((s) => s.status === "PAST_DUE").length,
      cancelScheduled: active.filter((s) => s.cancelAtPeriodEnd).length,
    },
  };
}

// ----------------------------------------------------------------------------- Crédits

export async function creditTotals() {
  const agg = await db.creditWallet.aggregate({ _sum: { monthlyBalance: true, purchasedBalance: true, reservedBalance: true, consumedTotal: true }, _count: true });
  return {
    monthly: agg._sum.monthlyBalance ?? 0,
    purchased: agg._sum.purchasedBalance ?? 0,
    reserved: agg._sum.reservedBalance ?? 0,
    consumed: agg._sum.consumedTotal ?? 0,
    wallets: agg._count,
  };
}

export async function listCreditTransactions(f: { type?: CreditTransactionType; customer?: string; page: number; take?: number }) {
  const where: Prisma.CreditTransactionWhereInput = {
    ...(f.type ? { type: f.type } : {}),
    ...(f.customer ? { wallet: { customer: customerSearch(f.customer) } } : {}),
  };
  const take = f.take ?? PAGE_SIZE;
  const [items, total] = await Promise.all([
    db.creditTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * take,
      take,
      include: {
        wallet: { select: { customer: { select: { id: true, referenceCode: true, user: { select: { firstName: true, lastName: true } } } } } },
        actor: { select: { firstName: true, lastName: true, role: true } },
        shipment: { select: { id: true, reference: true } },
      },
    }),
    db.creditTransaction.count({ where }),
  ]);
  return { items, total };
}

export async function searchCustomersForAdjust(q: string) {
  if (q.trim().length < 2) return [];
  return db.customerProfile.findMany({
    where: customerSearch(q.trim()),
    take: 10,
    include: { user: { select: { firstName: true, lastName: true, email: true } }, wallet: true },
  });
}

// ----------------------------------------------------------------------------- Paiements

export async function listPayments(f: { status?: PaymentStatus; kind?: PaymentKind; q?: string; page: number; take?: number }) {
  const where: Prisma.PaymentWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(f.q ? { OR: [{ externalId: ci(f.q) }, { description: ci(f.q) }, { customer: customerSearch(f.q) }] } : {}),
  };
  const take = f.take ?? PAGE_SIZE;
  const [items, total] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * take,
      take,
      include: { customer: { select: { id: true, referenceCode: true, user: { select: { firstName: true, lastName: true } } } }, invoice: { select: { number: true, hostedUrl: true } } },
    }),
    db.payment.count({ where }),
  ]);
  return { items, total };
}

export async function listInvoices(f: { q?: string; page: number; take?: number }) {
  const where: Prisma.InvoiceWhereInput = f.q ? { OR: [{ number: ci(f.q) }, { externalId: ci(f.q) }, { customer: customerSearch(f.q) }] } : {};
  const take = f.take ?? PAGE_SIZE;
  const [items, total] = await Promise.all([
    db.invoice.findMany({
      where,
      orderBy: { issuedAt: "desc" },
      skip: (f.page - 1) * take,
      take,
      include: { customer: { select: { id: true, referenceCode: true, user: { select: { firstName: true, lastName: true } } } } },
    }),
    db.invoice.count({ where }),
  ]);
  return { items, total };
}

export async function listStripeEvents(f: { status?: WebhookEventStatus; page: number; take?: number }) {
  const where: Prisma.StripeEventWhereInput = f.status ? { status: f.status } : {};
  const take = f.take ?? PAGE_SIZE;
  const [items, total, counts] = await Promise.all([
    db.stripeEvent.findMany({ where, orderBy: { receivedAt: "desc" }, skip: (f.page - 1) * take, take }),
    db.stripeEvent.count({ where }),
    db.stripeEvent.groupBy({ by: ["status"], _count: true }),
  ]);
  return { items, total, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number> };
}

export async function paymentKpis(since: Date) {
  const [succeeded, failed, refunded] = await Promise.all([
    db.payment.aggregate({ where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] }, createdAt: { gte: since } }, _sum: { amountCents: true }, _count: true }),
    db.payment.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
    db.payment.aggregate({ where: { createdAt: { gte: since } }, _sum: { refundedCents: true } }),
  ]);
  return { grossCents: succeeded._sum.amountCents ?? 0, count: succeeded._count, failed, refundedCents: refunded._sum.refundedCents ?? 0 };
}

// ----------------------------------------------------------------------------- Statistiques

export async function assignmentSlaStats(days = 90) {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await db.preparerAssignment.findMany({ where: { assignedAt: { gte: since }, waitMinutes: { not: null } }, select: { waitMinutes: true } });
  const waits = rows.map((r) => r.waitMinutes!);
  const avg = waits.length ? waits.reduce((s, w) => s + w, 0) / waits.length : null;
  const within = waits.filter((w) => w <= 24 * 60).length;
  const sorted = [...waits].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  return { count: waits.length, avgMinutes: avg, medianMinutes: median, withinRate: waits.length ? within / waits.length : null, days };
}

export async function shipmentsBySize() {
  const rows = await db.outboundShipment.groupBy({
    by: ["sizeCategory"],
    where: { sizeCategory: { not: null }, status: { not: "CANCELLED" } },
    _count: true,
    _sum: { creditCost: true },
  });
  return rows.map((r) => ({ size: r.sizeCategory!, count: r._count, credits: r._sum.creditCost ?? 0 }));
}

export async function creditsConsumedTotal() {
  const agg = await db.creditTransaction.aggregate({ where: { type: "CAPTURE" }, _sum: { reservedDelta: true } });
  return -(agg._sum.reservedDelta ?? 0);
}

export async function topPreparers(take = 5) {
  return db.preparerProfile.findMany({
    orderBy: { parcelsProcessed: "desc" },
    take,
    select: { id: true, parcelsProcessed: true, city: true, user: { select: { firstName: true, lastName: true } }, _count: { select: { assignments: { where: { status: "ACTIVE" } } } } },
  });
}

// ----------------------------------------------------------------------------- Notifications / e-mails / audit

export async function listMyNotifications(userId: string, page: number, take = PAGE_SIZE) {
  const [items, total, unread] = await Promise.all([
    db.notification.findMany({ where: { userId }, orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }], skip: (page - 1) * take, take }),
    db.notification.count({ where: { userId } }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, total, unread };
}

export async function latestEmailLogs(take = 100) {
  return db.emailLog.findMany({ orderBy: { createdAt: "desc" }, take });
}

export async function listAuditLogs(f: { action?: string; entityType?: string; actor?: string; page: number; take?: number }) {
  const where: Prisma.AuditLogWhereInput = {
    ...(f.action ? { action: ci(f.action) } : {}),
    ...(f.entityType ? { entityType: f.entityType } : {}),
    ...(f.actor ? { actor: { OR: [{ email: ci(f.actor) }, { firstName: ci(f.actor) }, { lastName: ci(f.actor) }] } } : {}),
  };
  const take = f.take ?? 50;
  const [items, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * take, take, include: { actor: { select: { firstName: true, lastName: true, email: true } } } }),
    db.auditLog.count({ where }),
  ]);
  return { items, total };
}

export async function auditEntityTypes() {
  const rows = await db.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } });
  return rows.map((r) => r.entityType);
}

export async function listAdmins() {
  const rows = await db.user.findMany({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, firstName: true, lastName: true, status: true, lastLoginAt: true, passwordHash: true, staffRole: { select: { id: true, key: true, name: true } }, isDemo: true },
  });
  // Le hachage du mot de passe ne quitte jamais cette fonction.
  return rows.map(({ passwordHash, ...u }) => ({ ...u, invitationPending: !passwordHash }));
}

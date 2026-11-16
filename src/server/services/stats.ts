import { monthlyEquivalentCents } from "@/lib/billing-intervals";
import { startOfMonth, subMonths } from "date-fns";
import { db } from "@/server/db";
import { SHIPMENT_ACTIVE_STATUSES } from "@/lib/labels";
import { computeSla, WAITING_STATES, listPreparerCapacities } from "./assignments";
import { getActiveSubscription } from "./customers";
import { getWalletOverview } from "./credits";

export async function getCustomerDashboard(customerId: string) {
  const [inbound, received, stock, activeShipments, shipped, wallet, subscription, customer] = await Promise.all([
    db.supplierOrder.count({ where: { customerId, status: { in: ["REGISTERED", "SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER"] } } }),
    db.supplierOrder.count({ where: { customerId, status: { in: ["PICKED_UP", "RECEIVED", "QUALITY_CHECK", "IN_STOCK"] } } }),
    db.inventoryItem.aggregate({ where: { customerId }, _sum: { quantityAvailable: true, quantityReserved: true } }),
    db.outboundShipment.count({ where: { customerId, status: { in: SHIPMENT_ACTIVE_STATUSES } } }),
    db.outboundShipment.count({ where: { customerId, status: { in: ["DROPPED_OFF", "IN_TRANSIT", "DELIVERED"] } } }),
    getWalletOverview(customerId),
    getActiveSubscription(customerId),
    db.customerProfile.findUniqueOrThrow({ where: { id: customerId } }),
  ]);
  return {
    inbound,
    received,
    stockUnits: (stock._sum.quantityAvailable ?? 0) + (stock._sum.quantityReserved ?? 0),
    activeShipments,
    shipped,
    wallet,
    subscription,
    customer,
    sla: computeSla(customer),
  };
}

export async function getPreparerDashboard(preparerId: string) {
  const since = new Date(Date.now() - 30 * 86400000);
  const [clients, toPickUp, toReceive, stock, awaiting, toPrepare, done, incidents] = await Promise.all([
    db.preparerAssignment.count({ where: { preparerId, status: "ACTIVE" } }),
    db.supplierOrder.count({ where: { preparerId, status: { in: ["IN_TRANSIT", "AT_LOCKER"] } } }),
    db.supplierOrder.count({ where: { preparerId, status: { in: ["PICKED_UP", "RECEIVED", "QUALITY_CHECK"] } } }),
    db.inventoryItem.aggregate({ where: { preparerId }, _sum: { quantityAvailable: true, quantityReserved: true } }),
    db.outboundShipment.count({ where: { preparerId, status: { in: ["REQUESTED", "AWAITING_CLASSIFICATION", "AWAITING_CREDITS"] } } }),
    db.outboundShipment.count({ where: { preparerId, status: { in: ["CLASSIFIED", "PREPARING", "READY", "LABEL_READY"] } } }),
    db.outboundShipment.count({ where: { preparerId, droppedOffAt: { gte: since } } }),
    db.incident.count({ where: { preparerId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
  ]);
  return { clients, toPickUp, toReceive, storedUnits: (stock._sum.quantityAvailable ?? 0) + (stock._sum.quantityReserved ?? 0), awaiting, toPrepare, done, incidents };
}

export async function getAdminOverview(now = new Date()) {
  const monthStart = startOfMonth(now);
  const [customersByStatus, waiting, activeSubs, revenueMonth, refundsMonth, shipmentsByStatus, ordersInTransit, openIncidents, consumedMonth, preparers, newCustomers] =
    await Promise.all([
      db.customerProfile.groupBy({ by: ["status"], _count: true }),
      db.customerProfile.findMany({
        where: { assignmentState: { in: WAITING_STATES } },
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { assignmentDueAt: "asc" },
        take: 20,
      }),
      db.subscription.findMany({ where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, include: { plan: true } }),
      db.payment.aggregate({ where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] }, createdAt: { gte: monthStart } }, _sum: { amountCents: true } }),
      db.payment.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { refundedCents: true } }),
      db.outboundShipment.groupBy({ by: ["status"], _count: true }),
      db.supplierOrder.count({ where: { status: { in: ["REGISTERED", "SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER"] } } }),
      db.incident.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      db.creditTransaction.aggregate({ where: { type: "CAPTURE", createdAt: { gte: monthStart } }, _sum: { reservedDelta: true } }),
      listPreparerCapacities(),
      // Nouveaux clients = premier paiement d'abonnement ce mois-ci (les inscrits sans paiement ne comptent pas).
      db.payment.groupBy({
        by: ["customerId"],
        where: { kind: "SUBSCRIPTION", status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] } },
        _min: { createdAt: true },
        having: { createdAt: { _min: { gte: monthStart } } },
      }),
    ]);
  // Revenu récurrent mensuel : formule annuelle ramenée au mois, offres remplacées exclues.
  const mrrCents = activeSubs
    .filter((s) => s.status !== "PAST_DUE" && !s.supersededAt)
    .reduce((sum, s) => sum + monthlyEquivalentCents(s.plan, s.billingInterval), 0);
  const planMix = Object.values(
    activeSubs.filter((s) => !s.supersededAt).reduce<Record<string, { name: string; count: number }>>((acc, s) => {
      acc[s.planId] ??= { name: s.plan.name, count: 0 };
      acc[s.planId].count++;
      return acc;
    }, {}),
  );
  return {
    customersByStatus: Object.fromEntries(customersByStatus.map((c) => [c.status, c._count])),
    waiting: waiting.map((c) => ({ ...c, sla: computeSla(c, now) })),
    mrrCents,
    activeSubscriptions: activeSubs.length,
    pastDue: activeSubs.filter((s) => s.status === "PAST_DUE").length,
    planMix,
    revenueMonthCents: (revenueMonth._sum.amountCents ?? 0) - (refundsMonth._sum.refundedCents ?? 0),
    shipmentsByStatus: Object.fromEntries(shipmentsByStatus.map((s) => [s.status, s._count])),
    ordersInTransit,
    openIncidents,
    creditsConsumedMonth: -(consumedMonth._sum.reservedDelta ?? 0),
    preparers,
    newCustomers: newCustomers.length,
  };
}

export async function getRevenueSeries(months = 6, now = new Date()) {
  const start = startOfMonth(subMonths(now, months - 1));
  const payments = await db.payment.findMany({
    where: { createdAt: { gte: start }, status: { in: ["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"] } },
    select: { createdAt: true, amountCents: true, refundedCents: true, kind: true },
  });
  const series: { month: string; subscriptions: number; credits: number }[] = [];
  for (let i = 0; i < months; i++) {
    const m = startOfMonth(subMonths(now, months - 1 - i));
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
    series.push({ month: key, subscriptions: 0, credits: 0 });
  }
  for (const p of payments) {
    const key = `${p.createdAt.getFullYear()}-${String(p.createdAt.getMonth() + 1).padStart(2, "0")}`;
    const row = series.find((s) => s.month === key);
    if (!row) continue;
    const net = p.amountCents - p.refundedCents;
    if (p.kind === "CREDIT_PACK") row.credits += net;
    else row.subscriptions += net;
  }
  return series;
}

export async function getOperationsSeries(days = 30, now = new Date()) {
  const start = new Date(now.getTime() - (days - 1) * 86400000);
  start.setHours(0, 0, 0, 0);
  const [orders, shipments] = await Promise.all([
    db.supplierOrderEvent.findMany({ where: { status: "IN_STOCK", createdAt: { gte: start } }, select: { createdAt: true } }),
    db.outboundShipment.findMany({ where: { droppedOffAt: { gte: start } }, select: { droppedOffAt: true } }),
  ]);
  const series: { day: string; received: number; shipped: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    series.push({ day: d.toISOString().slice(0, 10), received: 0, shipped: 0 });
  }
  for (const o of orders) {
    const row = series.find((s) => s.day === o.createdAt.toISOString().slice(0, 10));
    if (row) row.received++;
  }
  for (const s of shipments) {
    const row = series.find((x) => x.day === s.droppedOffAt!.toISOString().slice(0, 10));
    if (row) row.shipped++;
  }
  return series;
}

/** Recherche globale du back-office. */
export async function adminGlobalSearch(query: string) {
  const q = query.trim();
  if (q.length < 2) return { customers: [], preparers: [], orders: [], shipments: [], incidents: [] };
  const contains = { contains: q, mode: "insensitive" as const };
  const [customers, preparers, orders, shipments, incidents] = await Promise.all([
    db.customerProfile.findMany({
      where: { OR: [{ referenceCode: contains }, { companyName: contains }, { user: { OR: [{ email: contains }, { firstName: contains }, { lastName: contains }] } }] },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      take: 8,
    }),
    db.preparerProfile.findMany({
      where: { OR: [{ city: contains }, { user: { OR: [{ email: contains }, { firstName: contains }, { lastName: contains }] } }] },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      take: 8,
    }),
    db.supplierOrder.findMany({
      where: { OR: [{ reference: contains }, { trackingNumber: contains }, { supplierOrderNumber: contains }, { description: contains }] },
      select: { id: true, reference: true, description: true, status: true },
      take: 8,
    }),
    db.outboundShipment.findMany({
      where: { OR: [{ reference: contains }, { trackingNumber: contains }, { recipientName: contains }] },
      select: { id: true, reference: true, recipientName: true, status: true },
      take: 8,
    }),
    db.incident.findMany({ where: { OR: [{ reference: contains }, { title: contains }] }, select: { id: true, reference: true, title: true, status: true }, take: 8 }),
  ]);
  return { customers, preparers, orders, shipments, incidents };
}

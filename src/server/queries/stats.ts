import "server-only";
import { startOfMonth, subMonths } from "date-fns";
import { db } from "@/server/db";

/**
 * Statistiques et comptabilité mensuelles des espaces client, préparateur et
 * administration (6 derniers mois par défaut), calculées sur les données
 * réelles : ventes, expéditions, crédits, paiements.
 */

export function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthKeys(n: number, now: Date) {
  return Array.from({ length: n }, (_, i) => monthKey(startOfMonth(subMonths(now, n - 1 - i))));
}

/** Crédits consommés par une écriture : capture d'une réservation ou débit direct. */
function consumed(t: { type: string; amount: number; reservedDelta: number }) {
  return t.type === "CAPTURE" ? -t.reservedDelta : Math.max(0, -t.amount);
}

const PAID = ["SUCCEEDED", "REFUNDED", "PARTIALLY_REFUNDED"] as const;
const CONSUMING = ["CAPTURE", "STORAGE_FEE", "PREPARER_DEBIT", "ADMIN_DEBIT", "DELIVERY_FEE"] as const;

export async function getCustomerStats(customerId: string, months = 6, now = new Date()) {
  const start = startOfMonth(subMonths(now, months - 1));
  const [sales, shipments, transactions, payments] = await Promise.all([
    db.marketplaceSale.findMany({ where: { customerId, status: { not: "IGNORED" }, soldAt: { gte: start } }, select: { soldAt: true, priceCents: true, status: true, shipmentId: true } }),
    db.outboundShipment.findMany({ where: { customerId, droppedOffAt: { gte: start } }, select: { droppedOffAt: true, kind: true } }),
    db.creditTransaction.findMany({
      where: { wallet: { customerId }, createdAt: { gte: start }, type: { in: [...CONSUMING] } },
      select: { createdAt: true, type: true, amount: true, reservedDelta: true },
    }),
    db.payment.findMany({ where: { customerId, createdAt: { gte: start }, status: { in: [...PAID] } }, select: { createdAt: true, amountCents: true, refundedCents: true, kind: true } }),
  ]);
  const rows = monthKeys(months, now).map((month) => ({
    month,
    salesPackio: 0,
    salesDropship: 0,
    salesOther: 0,
    salesCents: 0,
    shippedStock: 0,
    shippedDropship: 0,
    returns: 0,
    creditsUsed: 0,
    subscriptionCents: 0,
    creditPackCents: 0,
  }));
  const row = (d: Date) => rows.find((r) => r.month === monthKey(d));
  for (const s of sales) {
    const r = row(s.soldAt);
    if (!r) continue;
    if (s.status === "DROPSHIP") r.salesDropship++;
    else if (s.shipmentId) r.salesPackio++;
    else r.salesOther++;
    r.salesCents += s.priceCents ?? 0;
  }
  for (const s of shipments) {
    const r = row(s.droppedOffAt!);
    if (!r) continue;
    if (s.kind === "DROPSHIP") r.shippedDropship++;
    else if (s.kind === "RETURN_TO_CUSTOMER") r.returns++;
    else r.shippedStock++;
  }
  for (const t of transactions) {
    const r = row(t.createdAt);
    if (r) r.creditsUsed += consumed(t);
  }
  for (const p of payments) {
    const r = row(p.createdAt);
    if (!r) continue;
    const net = p.amountCents - p.refundedCents;
    if (p.kind === "CREDIT_PACK") r.creditPackCents += net;
    else r.subscriptionCents += net;
  }
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + (r[k] as number), 0);
  return {
    rows,
    totals: {
      sales: sum("salesPackio") + sum("salesDropship") + sum("salesOther"),
      salesCents: sum("salesCents"),
      shipped: sum("shippedStock") + sum("shippedDropship"),
      creditsUsed: sum("creditsUsed"),
      spentCents: sum("subscriptionCents") + sum("creditPackCents"),
    },
  };
}

export async function getPreparerActivity(preparerId: string, months = 6, now = new Date()) {
  const start = startOfMonth(subMonths(now, months - 1));
  const [stocked, shipments, activeClients] = await Promise.all([
    db.supplierOrderEvent.findMany({
      where: { status: "IN_STOCK", createdAt: { gte: start }, supplierOrder: { preparerId } },
      select: { createdAt: true, supplierOrder: { select: { mode: true } } },
    }),
    db.outboundShipment.findMany({ where: { preparerId, droppedOffAt: { gte: start } }, select: { droppedOffAt: true, kind: true, creditCost: true, creditState: true } }),
    db.preparerAssignment.count({ where: { preparerId, status: "ACTIVE" } }),
  ]);
  const rows = monthKeys(months, now).map((month) => ({ month, receivedStock: 0, receivedDropship: 0, shippedStock: 0, shippedDropship: 0, returns: 0, credits: 0 }));
  const row = (d: Date) => rows.find((r) => r.month === monthKey(d));
  for (const e of stocked) {
    const r = row(e.createdAt);
    if (!r) continue;
    if (e.supplierOrder.mode === "DROPSHIP") r.receivedDropship++;
    else r.receivedStock++;
  }
  for (const s of shipments) {
    const r = row(s.droppedOffAt!);
    if (!r) continue;
    if (s.kind === "DROPSHIP") r.shippedDropship++;
    else if (s.kind === "RETURN_TO_CUSTOMER") r.returns++;
    else r.shippedStock++;
    if (s.creditState === "CAPTURED") r.credits += s.creditCost ?? 0;
  }
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + (r[k] as number), 0);
  return {
    rows,
    activeClients,
    totals: {
      received: sum("receivedStock") + sum("receivedDropship"),
      shipped: sum("shippedStock") + sum("shippedDropship") + sum("returns"),
      dropship: sum("shippedDropship"),
      credits: sum("credits"),
    },
  };
}

/** Comptabilité de la plateforme : encaissements, remboursements et crédits consommés par mois. */
export async function getAccountingSeries(months = 6, now = new Date()) {
  const start = startOfMonth(subMonths(now, months - 1));
  const [payments, transactions] = await Promise.all([
    db.payment.findMany({ where: { createdAt: { gte: start }, status: { in: [...PAID] } }, select: { createdAt: true, amountCents: true, refundedCents: true, kind: true } }),
    db.creditTransaction.findMany({ where: { createdAt: { gte: start }, type: { in: [...CONSUMING] } }, select: { createdAt: true, type: true, amount: true, reservedDelta: true } }),
  ]);
  const rows = monthKeys(months, now).map((month) => ({ month, payments: 0, subscriptionCents: 0, creditPackCents: 0, refundedCents: 0, netCents: 0, creditsConsumed: 0 }));
  const row = (d: Date) => rows.find((r) => r.month === monthKey(d));
  for (const p of payments) {
    const r = row(p.createdAt);
    if (!r) continue;
    r.payments++;
    if (p.kind === "CREDIT_PACK") r.creditPackCents += p.amountCents;
    else r.subscriptionCents += p.amountCents;
    r.refundedCents += p.refundedCents;
    r.netCents += p.amountCents - p.refundedCents;
  }
  for (const t of transactions) {
    const r = row(t.createdAt);
    if (r) r.creditsConsumed += consumed(t);
  }
  return rows;
}

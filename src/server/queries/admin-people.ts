import "server-only";
import type { AssignmentState, CustomerStatus, IncidentPriority, IncidentStatus, IncidentType, Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { WAITING_STATES } from "@/server/services/assignments";

export const PAGE_SIZE = 20;

/** Liste des clients pour le back-office (recherche, filtres, pagination). */
/**
 * Vues de la liste des clients. Par défaut, seuls les vrais clients actifs
 * (abonnement payé) sont affichés ; les inscrits sans paiement ont leur onglet.
 */
export const CUSTOMER_VIEWS = {
  actifs: { label: "Clients actifs", statuses: ["ACTIVE"] },
  retard: { label: "Paiement en retard", statuses: ["PAST_DUE"] },
  "sans-paiement": { label: "Inscrits sans paiement", statuses: ["PENDING_PAYMENT"] },
  anciens: { label: "Résiliés ou suspendus", statuses: ["CANCELED", "SUSPENDED"] },
  tous: { label: "Tous", statuses: null },
} as const satisfies Record<string, { label: string; statuses: readonly CustomerStatus[] | null }>;
export type CustomerView = keyof typeof CUSTOMER_VIEWS;

/** Nombre de clients par vue (onglets de la liste). */
export async function countCustomersByView(): Promise<Record<CustomerView, number>> {
  const groups = await db.customerProfile.groupBy({ by: ["status"], _count: true });
  const by = Object.fromEntries(groups.map((g) => [g.status, g._count])) as Partial<Record<CustomerStatus, number>>;
  return Object.fromEntries(
    Object.entries(CUSTOMER_VIEWS).map(([key, v]) => [
      key,
      v.statuses ? v.statuses.reduce((sum, st) => sum + (by[st] ?? 0), 0) : Object.values(by).reduce((a, b) => a + (b ?? 0), 0),
    ]),
  ) as Record<CustomerView, number>;
}

export async function listCustomersForAdmin(opts: { q?: string; view: CustomerView; assignment?: AssignmentState; page: number }) {
  const q = opts.q?.trim();
  const contains = q ? { contains: q, mode: "insensitive" as const } : undefined;
  const statuses = CUSTOMER_VIEWS[opts.view].statuses;
  const where: Prisma.CustomerProfileWhereInput = {
    ...(statuses ? { status: { in: [...statuses] } } : {}),
    ...(opts.assignment ? { assignmentState: opts.assignment } : {}),
    ...(contains
      ? {
          OR: [
            { referenceCode: contains },
            { companyName: contains },
            { user: { OR: [{ email: contains }, { firstName: contains }, { lastName: contains }] } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.customerProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      skip: (opts.page - 1) * PAGE_SIZE,
      include: {
        user: { select: { firstName: true, lastName: true, email: true, isDemo: true, status: true } },
        currentPreparer: { include: { user: { select: { firstName: true, lastName: true } } } },
        wallet: { select: { monthlyBalance: true, purchasedBalance: true, reservedBalance: true } },
        subscriptions: { where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, include: { plan: { select: { name: true } } }, take: 1, orderBy: { createdAt: "desc" } },
      },
    }),
    db.customerProfile.count({ where }),
  ]);
  return { rows, total };
}

export async function getCustomerDetail(customerId: string) {
  return db.customerProfile.findUnique({
    where: { id: customerId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, isDemo: true, status: true, createdAt: true, lastLoginAt: true, emailVerifiedAt: true } },
      currentPreparer: { include: { user: { select: { firstName: true, lastName: true, email: true, phone: true } } } },
      subscriptions: { orderBy: { createdAt: "desc" }, include: { plan: true }, take: 5 },
    },
  });
}

export async function getCustomerActivity(customerId: string) {
  const [orders, items, shipments, incidents, stock] = await Promise.all([
    db.supplierOrder.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { supplier: { select: { name: true, code: true } } },
    }),
    db.inventoryItem.findMany({ where: { customerId }, orderBy: { receivedAt: "desc" }, take: 10 }),
    db.outboundShipment.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.incident.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.inventoryItem.aggregate({ where: { customerId }, _sum: { quantityAvailable: true, quantityReserved: true }, _count: true }),
  ]);
  return {
    orders,
    items,
    shipments,
    incidents,
    stockUnits: (stock._sum.quantityAvailable ?? 0) + (stock._sum.quantityReserved ?? 0),
    stockItems: stock._count,
  };
}

/** Clients en attente d'attribution, triés par échéance. */
export async function listWaitingCustomers() {
  return db.customerProfile.findMany({
    where: { assignmentState: { in: WAITING_STATES } },
    orderBy: [{ assignmentDueAt: "asc" }],
    include: {
      user: { select: { firstName: true, lastName: true, email: true, isDemo: true } },
      currentPreparer: { include: { user: { select: { firstName: true, lastName: true } } } },
      subscriptions: { where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, include: { plan: { select: { name: true } } }, take: 1, orderBy: { createdAt: "desc" } },
    },
  });
}

export async function getAssignmentStats(days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const recent = await db.preparerAssignment.findMany({
    where: { assignedAt: { gte: since }, waitMinutes: { not: null } },
    select: { waitMinutes: true },
  });
  const waits = recent.map((r) => r.waitMinutes!).filter((w) => w >= 0);
  const avg = waits.length ? Math.round(waits.reduce((s, w) => s + w, 0) / waits.length) : null;
  const within = waits.length ? Math.round((waits.filter((w) => w <= 24 * 60).length / waits.length) * 100) : null;
  return { count: waits.length, avgWaitMinutes: avg, withinSlaPercent: within };
}

export async function listRecentAssignments(take = 15) {
  return db.preparerAssignment.findMany({
    orderBy: { assignedAt: "desc" },
    take,
    include: {
      customer: { include: { user: { select: { firstName: true, lastName: true } } } },
      preparer: { include: { user: { select: { firstName: true, lastName: true } } } },
      assignedBy: { select: { firstName: true, lastName: true } },
    },
  });
}

export async function listPreparersForAdmin(opts: { q?: string; status?: "ACTIVE" | "UNAVAILABLE" | "SUSPENDED" }) {
  const q = opts.q?.trim();
  const contains = q ? { contains: q, mode: "insensitive" as const } : undefined;
  return db.preparerProfile.findMany({
    where: {
      ...(opts.status ? { status: opts.status } : {}),
      ...(contains ? { OR: [{ city: contains }, { user: { OR: [{ email: contains }, { firstName: contains }, { lastName: contains }] } }] } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { firstName: true, lastName: true, email: true, isDemo: true, status: true, avatarFileId: true, passwordHash: true } },
      _count: { select: { assignments: { where: { status: "ACTIVE" } }, locations: { where: { isActive: true, validatedAt: { not: null } } } } },
    },
  });
}

export async function getPreparerDetail(preparerId: string) {
  return db.preparerProfile.findUnique({
    where: { id: preparerId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, isDemo: true, status: true, avatarFileId: true, passwordHash: true, createdAt: true, lastLoginAt: true } },
      locations: { orderBy: [{ isActive: "desc" }, { isPrimary: "desc" }, { createdAt: "asc" }], include: { validatedBy: { select: { firstName: true, lastName: true } } } },
      absences: { where: { cancelledAt: null, endsAt: { gte: new Date(Date.now() - 30 * 86400000) } }, orderBy: { startsAt: "asc" } },
      currentCustomers: {
        include: {
          user: { select: { firstName: true, lastName: true, email: true } },
          subscriptions: { where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, include: { plan: { select: { name: true } } }, take: 1 },
        },
      },
    },
  });
}

export async function getPreparerOperations(preparerId: string) {
  const [stock, shipments, orders] = await Promise.all([
    db.inventoryItem.aggregate({ where: { preparerId }, _sum: { quantityAvailable: true, quantityReserved: true }, _count: true }),
    db.outboundShipment.findMany({ where: { preparerId }, orderBy: { createdAt: "desc" }, take: 8, include: { customer: { select: { referenceCode: true } } } }),
    db.supplierOrder.findMany({ where: { preparerId }, orderBy: { createdAt: "desc" }, take: 8, include: { customer: { select: { referenceCode: true } } } }),
  ]);
  return {
    stockUnits: (stock._sum.quantityAvailable ?? 0) + (stock._sum.quantityReserved ?? 0),
    stockItems: stock._count,
    shipments,
    orders,
  };
}

export async function listIncidentsForAdmin(opts: { q?: string; status?: IncidentStatus; type?: IncidentType; priority?: IncidentPriority; page: number }) {
  const q = opts.q?.trim();
  const contains = q ? { contains: q, mode: "insensitive" as const } : undefined;
  const where: Prisma.IncidentWhereInput = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(opts.type ? { type: opts.type } : {}),
    ...(opts.priority ? { priority: opts.priority } : {}),
    ...(contains ? { OR: [{ reference: contains }, { title: contains }] } : {}),
  };
  const [rows, total, counts] = await Promise.all([
    db.incident.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: PAGE_SIZE,
      skip: (opts.page - 1) * PAGE_SIZE,
      include: {
        customer: { select: { referenceCode: true, user: { select: { firstName: true, lastName: true } } } },
        preparer: { select: { user: { select: { firstName: true, lastName: true } } } },
        assignedTo: { select: { firstName: true, lastName: true } },
      },
    }),
    db.incident.count({ where }),
    db.incident.groupBy({ by: ["status"], _count: true }),
  ]);
  return { rows, total, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Partial<Record<IncidentStatus, number>> };
}

export async function listAdminUsers() {
  return db.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    orderBy: { firstName: "asc" },
    select: { id: true, firstName: true, lastName: true, staffRole: { select: { name: true } } },
  });
}

export async function listContactRequests() {
  return db.contactRequest.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    include: { handledBy: { select: { firstName: true, lastName: true } } },
  });
}

export async function listRecentAudit(take = 10) {
  return db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: { actor: { select: { firstName: true, lastName: true } } },
  });
}

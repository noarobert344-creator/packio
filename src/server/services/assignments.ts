import { addHours, differenceInMinutes } from "date-fns";
import type { AssignmentState } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";
import { assertAdmin, type Actor } from "@/server/auth/actor";
import { audit } from "./audit";
import { getSetting } from "./settings";
import { withEffects, type Effects } from "./notifications";
import { ensurePairConversation, archivePairConversation } from "./messaging";

/**
 * ATTRIBUTION DES PRÉPARATEURS — EXCLUSIVEMENT MANUELLE
 * ------------------------------------------------------
 * Aucune fonction de ce module ne choisit un préparateur : toutes les
 * affectations exigent un administrateur (permission assignments.manage) qui
 * désigne explicitement le préparateur. Le système se limite à suivre le
 * délai (24 h par défaut), alerter et informer.
 */

export const WAITING_STATES: AssignmentState[] = ["PENDING", "LATE", "REASSIGNING"];

export type SlaInfo = {
  state: AssignmentState;
  requestedAt: Date | null;
  dueAt: Date | null;
  elapsedMinutes: number;
  remainingMinutes: number;
  isLate: boolean;
};

export function computeSla(
  customer: { assignmentState: AssignmentState; assignmentRequestedAt: Date | null; assignmentDueAt: Date | null },
  now = new Date(),
): SlaInfo {
  const { assignmentState: state, assignmentRequestedAt: requestedAt, assignmentDueAt: dueAt } = customer;
  const waiting = WAITING_STATES.includes(state);
  const elapsedMinutes = requestedAt ? Math.max(0, differenceInMinutes(now, requestedAt)) : 0;
  const remainingMinutes = dueAt ? differenceInMinutes(dueAt, now) : 0;
  const isLate = waiting && !!dueAt && dueAt.getTime() <= now.getTime();
  return { state: waiting && isLate && state === "PENDING" ? "LATE" : state, requestedAt, dueAt, elapsedMinutes, remainingMinutes, isLate };
}

type PreparerCapacity = {
  id: string;
  userId: string;
  name: string;
  email: string;
  city: string;
  country: string;
  status: string;
  maxClients: number;
  activeClients: number;
  storageCapacity: number;
  storedUnits: number;
  parcelsProcessed: number;
  validatedLocations: number;
  absentNow: boolean;
  available: boolean;
  unavailableReason: string | null;
};

/** Liste des préparateurs avec leur capacité (aide à la décision de l'admin). */
export async function listPreparerCapacities(client: Tx | typeof db = db, now = new Date()): Promise<PreparerCapacity[]> {
  const preparers = await client.preparerProfile.findMany({
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, status: true } },
      _count: { select: { assignments: { where: { status: "ACTIVE" } } } },
      locations: { where: { isActive: true, validatedAt: { not: null } }, select: { id: true } },
      absences: { where: { cancelledAt: null, startsAt: { lte: now }, endsAt: { gte: now } }, select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const stock = await client.inventoryItem.groupBy({
    by: ["preparerId"],
    _sum: { quantityAvailable: true, quantityReserved: true },
  });
  return preparers.map((p) => {
    const activeClients = p._count.assignments;
    const s = stock.find((x) => x.preparerId === p.id);
    const storedUnits = (s?._sum.quantityAvailable ?? 0) + (s?._sum.quantityReserved ?? 0);
    const absentNow = p.absences.length > 0;
    let unavailableReason: string | null = null;
    if (p.user.status !== "ACTIVE") unavailableReason = "Compte désactivé";
    else if (p.status === "SUSPENDED") unavailableReason = "Préparateur suspendu";
    else if (p.status === "UNAVAILABLE") unavailableReason = "Préparateur indisponible";
    else if (absentNow) unavailableReason = "Absence en cours";
    else if (activeClients >= p.maxClients) unavailableReason = "Capacité clients atteinte";
    else if (p.locations.length === 0) unavailableReason = "Aucun point de réception validé";
    return {
      id: p.id,
      userId: p.user.id,
      name: `${p.user.firstName} ${p.user.lastName}`,
      email: p.user.email,
      city: p.city,
      country: p.country,
      status: p.status,
      maxClients: p.maxClients,
      activeClients,
      storageCapacity: p.storageCapacity,
      storedUnits,
      parcelsProcessed: p.parcelsProcessed,
      validatedLocations: p.locations.length,
      absentNow,
      available: unavailableReason === null,
      unavailableReason,
    };
  });
}

/**
 * Ouvre la demande d'attribution après activation de l'abonnement :
 * état « En attente », échéance SLA, alerte administrateur.
 */
export async function openAssignmentRequest(tx: Tx, fx: Effects, customerId: string, now = new Date()) {
  const customer = await tx.customerProfile.findUnique({ where: { id: customerId }, include: { user: true } });
  if (!customer) throw new NotFoundError("Client introuvable.");
  if (customer.assignmentState !== "NOT_REQUESTED") return { opened: false };
  const { slaHours } = await getSetting("assignment", tx);
  const dueAt = addHours(now, slaHours);
  await tx.customerProfile.update({
    where: { id: customerId },
    data: { assignmentState: "PENDING", assignmentRequestedAt: now, assignmentDueAt: dueAt, assignmentAdminAlertedAt: null, assignmentDelayNotifiedAt: null },
  });
  await audit({ actor: null, action: "assignment.requested", entityType: "customer", entityId: customerId, summary: `Échéance ${dueAt.toISOString()}` }, tx);

  fx.notify(customer.userId, {
    type: "ASSIGNMENT_PENDING",
    title: "Attribution de votre préparateur en cours",
    body: `Un préparateur de commandes personnel vous sera attribué sous ${slaHours} heures. Vous serez notifié dès qu'il sera disponible.`,
    link: "/client",
  });
  fx.notifyAdmins(
    {
      type: "ADMIN_ASSIGNMENT_REQUEST",
      title: "Nouvelle demande d'attribution",
      body: `${customer.user.firstName} ${customer.user.lastName} (${customer.referenceCode}) attend un préparateur. Échéance : ${slaHours} h.`,
      link: `/admin/clients/${customerId}`,
    },
    "assignments.manage",
  );
  const capacities = await listPreparerCapacities(tx, now);
  if (!capacities.some((p) => p.available)) {
    fx.notifyAdmins(
      {
        type: "ADMIN_NO_PREPARER",
        title: "Aucun préparateur disponible",
        body: `Aucun préparateur n'a de capacité disponible pour ${customer.referenceCode}. Ajoutez un préparateur ou augmentez une capacité avant l'échéance.`,
        link: "/admin/preparateurs",
      },
      "assignments.manage",
    );
  }
  return { opened: true, dueAt };
}

async function lockCustomer(tx: Tx, customerId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "customer_profiles" WHERE "id" = ${customerId} FOR UPDATE`;
  if (!rows[0]) throw new NotFoundError("Client introuvable.");
}

async function lockPreparer(tx: Tx, preparerId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "preparer_profiles" WHERE "id" = ${preparerId} FOR UPDATE`;
  if (!rows[0]) throw new NotFoundError("Préparateur introuvable.");
}

async function assertPreparerCanTakeClient(tx: Tx, preparerId: string) {
  await lockPreparer(tx, preparerId);
  const capacity = (await listPreparerCapacities(tx)).find((p) => p.id === preparerId);
  if (!capacity) throw new NotFoundError("Préparateur introuvable.");
  if (!capacity.available) {
    throw new DomainError("PREPARER_UNAVAILABLE", `Ce préparateur ne peut pas recevoir de nouveau client : ${capacity.unavailableReason}.`);
  }
  return capacity;
}

/** Attribution manuelle initiale, confirmée par un administrateur. */
export async function assignPreparer(actor: Actor, input: { customerId: string; preparerId: string; note?: string }) {
  assertAdmin(actor, "assignments.manage");
  return withEffects(async (tx, fx) => {
    await lockCustomer(tx, input.customerId);
    const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: input.customerId }, include: { user: true } });
    if (customer.status !== "ACTIVE" && customer.status !== "PAST_DUE") {
      throw new DomainError("CUSTOMER_INACTIVE", "Le client doit disposer d'un abonnement actif pour recevoir un préparateur.");
    }
    const active = await tx.preparerAssignment.findFirst({ where: { customerId: input.customerId, status: "ACTIVE" } });
    if (active) {
      throw new DomainError("ALREADY_ASSIGNED", "Ce client a déjà un préparateur. Utilisez la réattribution.");
    }
    const capacity = await assertPreparerCanTakeClient(tx, input.preparerId);
    const now = new Date();
    const assignment = await tx.preparerAssignment.create({
      data: {
        customerId: input.customerId,
        preparerId: input.preparerId,
        assignedById: actor.userId,
        note: input.note?.trim() || null,
        waitMinutes: customer.assignmentRequestedAt ? differenceInMinutes(now, customer.assignmentRequestedAt) : null,
      },
    });
    await tx.customerProfile.update({
      where: { id: input.customerId },
      data: { currentPreparerId: input.preparerId, assignmentState: "ASSIGNED" },
    });
    const conversation = await ensurePairConversation(tx, input.customerId, input.preparerId);
    await audit(
      {
        actor,
        action: "assignment.created",
        entityType: "customer",
        entityId: input.customerId,
        summary: `Préparateur attribué : ${capacity.name}`,
        metadata: { assignmentId: assignment.id, preparerId: input.preparerId },
      },
      tx,
    );
    fx.notify(customer.userId, {
      type: "PREPARER_ASSIGNED",
      title: "Votre préparateur est disponible",
      body: `${capacity.name} est désormais votre préparateur attitré. Vous pouvez consulter son point de réception et commencer à lui envoyer vos commandes.`,
      link: "/client/preparateur",
    });
    fx.notify(capacity.userId, {
      type: "CLIENT_ASSIGNED",
      title: "Nouveau client attribué",
      body: `${customer.user.firstName} ${customer.user.lastName} (${customer.referenceCode}) vous a été attribué.`,
      link: "/preparateur/clients",
    });
    return { assignmentId: assignment.id, conversationId: conversation.id };
  });
}

/** Passe le client en état « Réattribution » (ex. : préparateur suspendu). */
export async function startReassignment(actor: Actor, input: { customerId: string; reason: string }) {
  assertAdmin(actor, "assignments.manage");
  return withEffects(async (tx) => {
    await lockCustomer(tx, input.customerId);
    const { slaHours } = await getSetting("assignment", tx);
    const now = new Date();
    await tx.customerProfile.update({
      where: { id: input.customerId },
      data: { assignmentState: "REASSIGNING", assignmentRequestedAt: now, assignmentDueAt: addHours(now, slaHours), assignmentAdminAlertedAt: null },
    });
    await audit({ actor, action: "assignment.reassignment_started", entityType: "customer", entityId: input.customerId, summary: input.reason }, tx);
  });
}

/**
 * Réattribution : clôture de l'affectation active (historique conservé) et
 * création d'une nouvelle. Le transfert de stock est optionnel et contrôlé :
 * il est refusé si des expéditions sont en cours de préparation.
 */
export async function reassignCustomer(
  actor: Actor,
  input: { customerId: string; preparerId: string; reason: string; transferStock: boolean },
) {
  assertAdmin(actor, "assignments.manage");
  if (input.reason.trim().length < 3) throw new DomainError("REASON_REQUIRED", "Indiquez le motif de la réattribution.");
  return withEffects(async (tx, fx) => {
    await lockCustomer(tx, input.customerId);
    const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: input.customerId }, include: { user: true } });
    const current = await tx.preparerAssignment.findFirst({
      where: { customerId: input.customerId, status: "ACTIVE" },
      include: { preparer: { include: { user: true } } },
    });
    if (!current) throw new DomainError("NOT_ASSIGNED", "Ce client n'a pas de préparateur actif : utilisez l'attribution.");
    if (current.preparerId === input.preparerId) throw new DomainError("SAME_PREPARER", "Le client est déjà attribué à ce préparateur.");
    const capacity = await assertPreparerCanTakeClient(tx, input.preparerId);
    const now = new Date();

    let transferred = 0;
    if (input.transferStock) {
      const inPreparation = await tx.outboundShipment.count({
        where: { customerId: input.customerId, preparerId: current.preparerId, status: { in: ["PREPARING", "READY", "LABEL_READY"] } },
      });
      if (inPreparation > 0) {
        throw new DomainError(
          "SHIPMENTS_IN_PROGRESS",
          `${inPreparation} expédition(s) sont en cours de préparation chez le préparateur actuel. Attendez leur dépôt avant de transférer le stock.`,
        );
      }
      const items = await tx.inventoryItem.findMany({
        where: { customerId: input.customerId, preparerId: current.preparerId, OR: [{ quantityAvailable: { gt: 0 } }, { quantityReserved: { gt: 0 } }] },
      });
      for (const item of items) {
        await tx.inventoryMovement.create({
          data: {
            itemId: item.id,
            type: "TRANSFER_OUT",
            quantity: 0,
            availableAfter: item.quantityAvailable,
            reservedAfter: item.quantityReserved,
            reason: `Transfert vers ${capacity.name} — ${input.reason.trim()}`,
            actorId: actor.userId,
          },
        });
        await tx.inventoryItem.update({ where: { id: item.id }, data: { preparerId: input.preparerId, storageLocation: null } });
        await tx.inventoryMovement.create({
          data: {
            itemId: item.id,
            type: "TRANSFER_IN",
            quantity: 0,
            availableAfter: item.quantityAvailable,
            reservedAfter: item.quantityReserved,
            reason: `Réception depuis ${current.preparer.user.firstName} ${current.preparer.user.lastName}`,
            actorId: actor.userId,
          },
        });
        transferred++;
      }
      // Les expéditions non commencées suivent le stock.
      await tx.outboundShipment.updateMany({
        where: {
          customerId: input.customerId,
          preparerId: current.preparerId,
          status: { in: ["REQUESTED", "AWAITING_CLASSIFICATION", "CLASSIFIED", "AWAITING_CREDITS"] },
        },
        data: { preparerId: input.preparerId },
      });
    }

    await tx.preparerAssignment.update({
      where: { id: current.id },
      data: { status: "ENDED", endedAt: now, endedById: actor.userId, endReason: input.reason.trim() },
    });
    const assignment = await tx.preparerAssignment.create({
      data: {
        customerId: input.customerId,
        preparerId: input.preparerId,
        assignedById: actor.userId,
        note: `Réattribution : ${input.reason.trim()}`,
        waitMinutes: customer.assignmentState === "REASSIGNING" && customer.assignmentRequestedAt ? differenceInMinutes(now, customer.assignmentRequestedAt) : null,
      },
    });
    await tx.customerProfile.update({
      where: { id: input.customerId },
      data: { currentPreparerId: input.preparerId, assignmentState: "ASSIGNED" },
    });
    await archivePairConversation(tx, input.customerId, current.preparerId);
    await ensurePairConversation(tx, input.customerId, input.preparerId);
    await audit(
      {
        actor,
        action: "assignment.reassigned",
        entityType: "customer",
        entityId: input.customerId,
        summary: `${current.preparer.user.firstName} ${current.preparer.user.lastName} → ${capacity.name} (${input.reason.trim()})`,
        metadata: { from: current.preparerId, to: input.preparerId, transferStock: input.transferStock, transferredItems: transferred },
      },
      tx,
    );
    fx.notify(customer.userId, {
      type: "PREPARER_ASSIGNED",
      title: "Nouveau préparateur attribué",
      body: `${capacity.name} devient votre préparateur attitré. Utilisez désormais sa nouvelle adresse de réception pour vos prochaines commandes.`,
      link: "/client/preparateur",
    });
    fx.notify(capacity.userId, {
      type: "CLIENT_ASSIGNED",
      title: "Nouveau client attribué",
      body: `${customer.user.firstName} ${customer.user.lastName} (${customer.referenceCode}) vous a été attribué${input.transferStock ? " avec transfert de son stock" : ""}.`,
      link: "/preparateur/clients",
    });
    fx.notify(current.preparer.userId, {
      type: "CLIENT_UNASSIGNED",
      title: "Client réattribué",
      body: `Le client ${customer.referenceCode} a été confié à un autre préparateur. Les commandes déjà en route vers vous restent à traiter.`,
      link: "/preparateur/clients",
    });
    return { assignmentId: assignment.id, transferredItems: transferred };
  });
}

/** Procédure d'information du client en cas de retard d'attribution. */
export async function notifyCustomerOfDelay(actor: Actor, input: { customerId: string; message?: string }) {
  assertAdmin(actor, "assignments.manage");
  const customer = await db.customerProfile.findUnique({ where: { id: input.customerId } });
  if (!customer) throw new NotFoundError("Client introuvable.");
  return withEffects(async (tx, fx) => {
    await tx.customerProfile.update({ where: { id: customer.id }, data: { assignmentDelayNotifiedAt: new Date() } });
    await audit({ actor, action: "assignment.delay_notified", entityType: "customer", entityId: customer.id, summary: input.message }, tx);
    fx.notify(customer.userId, {
      type: "ASSIGNMENT_DELAYED",
      title: "L'attribution de votre préparateur prend un peu plus de temps",
      body:
        input.message?.trim() ||
        "Nous finalisons l'attribution de votre préparateur personnel. Ce délai supplémentaire n'entraîne aucune perte de crédits. Nous vous notifierons dès que votre préparateur sera disponible.",
      link: "/client",
      forceEmail: true,
    });
  });
}

/** Contrôle périodique du délai d'attribution (tâche cron). */
export async function runAssignmentSlaCheck(now = new Date()) {
  const overdue = await db.customerProfile.findMany({
    where: { assignmentState: { in: ["PENDING", "LATE", "REASSIGNING"] }, assignmentDueAt: { lte: now } },
    include: { user: true },
  });
  let alerted = 0;
  for (const customer of overdue) {
    await withEffects(async (tx, fx) => {
      const fresh = await tx.customerProfile.findUniqueOrThrow({ where: { id: customer.id } });
      if (!WAITING_STATES.includes(fresh.assignmentState)) return;
      const data: { assignmentState?: AssignmentState; assignmentAdminAlertedAt?: Date; assignmentDelayNotifiedAt?: Date } = {};
      if (fresh.assignmentState === "PENDING") data.assignmentState = "LATE";
      if (!fresh.assignmentAdminAlertedAt) {
        data.assignmentAdminAlertedAt = now;
        alerted++;
        fx.notifyAdmins(
          {
            type: "ADMIN_ASSIGNMENT_LATE",
            title: "Délai d'attribution dépassé",
            body: `Le client ${customer.referenceCode} (${customer.user.firstName} ${customer.user.lastName}) attend un préparateur depuis plus de 24 h.`,
            link: `/admin/clients/${customer.id}`,
          },
          "assignments.manage",
        );
      }
      if (!fresh.assignmentDelayNotifiedAt) {
        data.assignmentDelayNotifiedAt = now;
        fx.notify(customer.userId, {
          type: "ASSIGNMENT_DELAYED",
          title: "Votre préparateur arrive bientôt",
          body: "L'attribution de votre préparateur prend plus de temps que prévu. Notre équipe s'en occupe en priorité et vous serez notifié dès qu'il sera disponible.",
          link: "/client",
        });
      }
      if (Object.keys(data).length) await tx.customerProfile.update({ where: { id: customer.id }, data });
    });
  }
  return { overdue: overdue.length, alerted };
}

export async function getAssignmentHistory(customerId: string) {
  return db.preparerAssignment.findMany({
    where: { customerId },
    orderBy: { assignedAt: "desc" },
    include: {
      preparer: { include: { user: { select: { firstName: true, lastName: true } } } },
      assignedBy: { select: { firstName: true, lastName: true } },
      endedBy: { select: { firstName: true, lastName: true } },
    },
  });
}

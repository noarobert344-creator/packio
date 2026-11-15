import type { IncidentPriority, IncidentStatus, IncidentType } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/db";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { assertAdmin, can, type Actor } from "@/server/auth/actor";
import { reference } from "@/server/lib/ids";
import { INCIDENT_TYPE } from "@/lib/labels";
import { audit } from "./audit";
import { withEffects, type Effects } from "./notifications";

export type IncidentInput = {
  type: IncidentType;
  title: string;
  description: string;
  priority?: IncidentPriority;
  customerId?: string | null;
  preparerId?: string | null;
  supplierOrderId?: string | null;
  shipmentId?: string | null;
  inventoryItemId?: string | null;
};

export async function createIncidentTx(tx: Tx, fx: Effects, actor: Actor, input: IncidentInput) {
  const incident = await tx.incident.create({
    data: {
      reference: reference("INC", 7),
      type: input.type,
      title: input.title.trim().slice(0, 200),
      description: input.description.trim().slice(0, 5000),
      priority: input.priority ?? "NORMAL",
      customerId: input.customerId ?? null,
      preparerId: input.preparerId ?? null,
      supplierOrderId: input.supplierOrderId ?? null,
      shipmentId: input.shipmentId ?? null,
      inventoryItemId: input.inventoryItemId ?? null,
      reportedById: actor.userId,
    },
  });
  await audit({ actor, action: "incident.created", entityType: "incident", entityId: incident.id, summary: `${INCIDENT_TYPE[input.type]} — ${incident.title}` }, tx);

  // Requêtes séquentielles : une transaction n'utilise qu'une connexion.
  const customer = input.customerId ? await tx.customerProfile.findUnique({ where: { id: input.customerId }, select: { userId: true } }) : null;
  const preparer = input.preparerId ? await tx.preparerProfile.findUnique({ where: { id: input.preparerId }, select: { userId: true } }) : null;
  const payload = {
    type: "INCIDENT" as const,
    title: `Incident ${incident.reference}`,
    body: `${INCIDENT_TYPE[input.type]} : ${incident.title}`,
  };
  if (customer && customer.userId !== actor.userId) fx.notify(customer.userId, { ...payload, link: `/client/incidents/${incident.id}` });
  if (preparer && preparer.userId !== actor.userId) fx.notify(preparer.userId, { ...payload, link: `/preparateur/incidents/${incident.id}` });
  fx.notifyAdmins({ ...payload, link: `/admin/incidents/${incident.id}` }, "incidents.manage");
  return incident;
}

/** Signalement d'un incident par un client ou un préparateur, sur son propre périmètre. */
export async function reportIncident(actor: Actor, input: IncidentInput & { photoIds?: string[] }) {
  return withEffects(async (tx, fx) => {
    const scoped = { ...input };
    if (actor.role === "CUSTOMER") {
      scoped.customerId = actor.customerId;
      const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: actor.customerId! } });
      scoped.preparerId = customer.currentPreparerId;
    } else if (actor.role === "PREPARER") {
      scoped.preparerId = actor.preparerId;
    }
    if (scoped.supplierOrderId) {
      const order = await tx.supplierOrder.findUnique({ where: { id: scoped.supplierOrderId } });
      if (!order || !ownsEntity(actor, order)) throw new ForbiddenError();
      scoped.customerId = order.customerId;
      scoped.preparerId = order.preparerId;
    }
    if (scoped.shipmentId) {
      const shipment = await tx.outboundShipment.findUnique({ where: { id: scoped.shipmentId } });
      if (!shipment || !ownsEntity(actor, shipment)) throw new ForbiddenError();
      scoped.customerId = shipment.customerId;
      scoped.preparerId = shipment.preparerId;
    }
    if (scoped.inventoryItemId) {
      const item = await tx.inventoryItem.findUnique({ where: { id: scoped.inventoryItemId } });
      if (!item || !ownsEntity(actor, item)) throw new ForbiddenError();
      scoped.customerId = item.customerId;
      scoped.preparerId = item.preparerId;
    }
    if (actor.role === "PREPARER" && !scoped.customerId && !scoped.supplierOrderId && !scoped.shipmentId) {
      scoped.customerId = null;
    }
    if (input.title.trim().length < 3 || input.description.trim().length < 5) {
      throw new DomainError("INVALID", "Décrivez précisément le problème.");
    }
    const incident = await createIncidentTx(tx, fx, actor, scoped);
    if (input.photoIds?.length) {
      await tx.file.updateMany({
        where: { id: { in: input.photoIds }, uploadedById: actor.userId, deletedAt: null },
        data: { incidentId: incident.id, customerId: scoped.customerId ?? undefined },
      });
    }
    return incident;
  });
}

function ownsEntity(actor: Actor, entity: { customerId: string; preparerId: string }) {
  if (actor.role === "ADMIN") return true;
  if (actor.role === "CUSTOMER") return entity.customerId === actor.customerId;
  return entity.preparerId === actor.preparerId;
}

export async function getIncidentForActor(actor: Actor, id: string) {
  const incident = await db.incident.findUnique({
    where: { id },
    include: {
      customer: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
      preparer: { include: { user: { select: { firstName: true, lastName: true } } } },
      supplierOrder: { select: { id: true, reference: true, description: true } },
      shipment: { select: { id: true, reference: true, status: true } },
      inventoryItem: { select: { id: true, sku: true, name: true } },
      reportedBy: { select: { firstName: true, lastName: true, role: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      updates: { orderBy: { createdAt: "asc" }, include: { author: { select: { firstName: true, lastName: true, role: true } } } },
      files: { where: { deletedAt: null }, select: { id: true, filename: true, mimeType: true } },
    },
  });
  if (!incident) throw new NotFoundError("Incident introuvable.");
  const allowed =
    (actor.role === "ADMIN" && (can(actor, "incidents.manage") || can(actor, "operations.read"))) ||
    (actor.role === "CUSTOMER" && incident.customerId === actor.customerId) ||
    (actor.role === "PREPARER" && incident.preparerId === actor.preparerId);
  if (!allowed) throw new ForbiddenError();
  if (actor.role !== "ADMIN") incident.updates = incident.updates.filter((u) => !u.internal);
  return incident;
}

export async function addIncidentUpdate(
  actor: Actor,
  input: { incidentId: string; body: string; status?: IncidentStatus; internal?: boolean; resolution?: string },
) {
  const incident = await getIncidentForActor(actor, input.incidentId);
  const isAdmin = actor.role === "ADMIN";
  if (!isAdmin && (input.status || input.internal)) throw new ForbiddenError("Seule l'administration modifie le statut d'un incident.");
  if (input.body.trim().length < 2) throw new DomainError("EMPTY", "Le message est vide.");
  return withEffects(async (tx, fx) => {
    await tx.incidentUpdate.create({
      data: {
        incidentId: incident.id,
        authorId: actor.userId,
        body: input.body.trim(),
        statusFrom: input.status ? incident.status : null,
        statusTo: input.status ?? null,
        internal: isAdmin ? !!input.internal : false,
      },
    });
    if (input.status && isAdmin) {
      assertAdmin(actor, "incidents.manage");
      await tx.incident.update({
        where: { id: incident.id },
        data: {
          status: input.status,
          resolution: input.resolution?.trim() || (input.status === "RESOLVED" ? input.body.trim() : undefined),
          resolvedAt: input.status === "RESOLVED" || input.status === "CLOSED" ? new Date() : null,
          assignedToId: incident.assignedTo?.id ?? actor.userId,
        },
      });
      await audit({ actor, action: "incident.status", entityType: "incident", entityId: incident.id, summary: `${incident.status} → ${input.status}` }, tx);
    }
    if (!input.internal) {
      const targets = [
        incident.customerId ? (await tx.customerProfile.findUnique({ where: { id: incident.customerId }, select: { userId: true } }))?.userId : null,
        incident.preparerId ? (await tx.preparerProfile.findUnique({ where: { id: incident.preparerId }, select: { userId: true } }))?.userId : null,
      ];
      for (const userId of targets) {
        if (!userId || userId === actor.userId) continue;
        const base = userId === targets[0] ? "/client/incidents/" : "/preparateur/incidents/";
        fx.notify(userId, { type: "INCIDENT", title: `Incident ${incident.reference} mis à jour`, body: input.body.trim().slice(0, 160), link: `${base}${incident.id}` });
      }
      if (!isAdmin) {
        fx.notifyAdmins({ type: "INCIDENT", title: `Incident ${incident.reference} : nouvelle réponse`, body: input.body.trim().slice(0, 160), link: `/admin/incidents/${incident.id}` }, "incidents.manage");
      }
    }
  });
}

export async function assignIncident(actor: Actor, input: { incidentId: string; adminId: string | null; priority?: IncidentPriority }) {
  assertAdmin(actor, "incidents.manage");
  await db.incident.update({
    where: { id: input.incidentId },
    data: { assignedToId: input.adminId, ...(input.priority ? { priority: input.priority } : {}) },
  });
  await audit({ actor, action: "incident.assign", entityType: "incident", entityId: input.incidentId, metadata: { adminId: input.adminId, priority: input.priority ?? null } });
}

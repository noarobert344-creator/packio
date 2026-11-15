"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-types";
import { checkbox, emailField, intField, optionalText, phoneField, requiredText, stringArray } from "@/lib/forms";
import { formToObject, runAction } from "@/server/action";
import { assertAdmin } from "@/server/auth/actor";
import { db } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";
import { assignPreparer, notifyCustomerOfDelay, reassignCustomer, startReassignment } from "@/server/services/assignments";
import { adminAdjustCredits } from "@/server/services/credits";
import { anonymizeCustomer, setCustomerStatus, updateCustomerNotes } from "@/server/services/catalog";
import { cancelAbsence, createPreparer, deactivateLocation, declareAbsence, saveLocation, setLocationValidation, setPreparerStatus, updatePreparer } from "@/server/services/preparers";
import { sendInvitation } from "@/server/services/auth";
import { sendMessage } from "@/server/services/messaging";
import { assignIncident } from "@/server/services/incidents";
import { adminReclassify } from "@/server/services/shipments";
import { audit } from "@/server/services/audit";

function revalidateCustomer(customerId: string) {
  revalidatePath(`/admin/clients/${customerId}`);
  revalidatePath("/admin/clients");
  revalidatePath("/admin/attributions");
  revalidatePath("/admin");
}

// ----------------------------------------------------------------------------- Attribution

const assignSchema = z.object({ customerId: z.string().min(1), preparerId: z.string().min(1, { error: "Choisissez un préparateur" }), note: optionalText(500) });

export async function assignPreparerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(assignSchema, formToObject(formData), async (actor, data) => {
    await assignPreparer(actor, data);
    revalidateCustomer(data.customerId);
    revalidatePath(`/admin/preparateurs/${data.preparerId}`);
    // Redirection serveur : la ligne de la file d'attente disparaît après l'attribution.
    redirect(`/admin/clients/${data.customerId}?attribue=1`);
  });
}

const reassignSchema = z.object({
  customerId: z.string().min(1),
  preparerId: z.string().min(1, { error: "Choisissez un préparateur" }),
  reason: requiredText("Motif", 3, 500),
  transferStock: checkbox(),
});

export async function reassignCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(reassignSchema, formToObject(formData), async (actor, data) => {
    const res = await reassignCustomer(actor, data);
    revalidateCustomer(data.customerId);
    return {
      ok: true,
      message: data.transferStock ? `Client réattribué — ${res.transferredItems} article(s) transféré(s).` : "Client réattribué.",
    };
  });
}

export async function startReassignmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ customerId: z.string().min(1), reason: requiredText("Motif", 3, 500) }), formToObject(formData), async (actor, data) => {
    await startReassignment(actor, data);
    revalidateCustomer(data.customerId);
    return { ok: true, message: "Réattribution lancée : le délai de 24 h est relancé." };
  });
}

export async function notifyDelayAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ customerId: z.string().min(1), message: optionalText(1000) }), formToObject(formData), async (actor, data) => {
    await notifyCustomerOfDelay(actor, data);
    revalidateCustomer(data.customerId);
    return { ok: true, message: "Le client a été informé du retard (notification et e-mail)." };
  });
}

// ----------------------------------------------------------------------------- Clients

const creditSchema = z.object({
  customerId: z.string().min(1),
  direction: z.enum(["CREDIT", "DEBIT"]),
  amount: intField("Montant", { min: 1, max: 10000 }),
  bucket: z.enum(["MONTHLY", "PURCHASED"]),
  reason: requiredText("Justification", 5, 500),
  requestId: z.string().min(8),
});

export async function adjustCreditsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(creditSchema, formToObject(formData), async (actor, data) => {
    const { applied } = await adminAdjustCredits(actor, data);
    revalidateCustomer(data.customerId);
    if (!applied) return { ok: true, message: "Opération déjà enregistrée." };
    return { ok: true, message: data.direction === "CREDIT" ? `${data.amount} crédit(s) ajouté(s).` : `${data.amount} crédit(s) débité(s).` };
  });
}

export async function updateCustomerNotesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ customerId: z.string().min(1), notes: z.string().max(5000) }), formToObject(formData), async (actor, data) => {
    await updateCustomerNotes(actor, data);
    revalidatePath(`/admin/clients/${data.customerId}`);
    return { ok: true, message: "Notes internes enregistrées." };
  });
}

export async function setCustomerStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(
    z.object({ customerId: z.string().min(1), status: z.enum(["SUSPENDED", "ACTIVE"]), reason: requiredText("Motif", 3, 500) }),
    formToObject(formData),
    async (actor, data) => {
      await setCustomerStatus(actor, data);
      revalidateCustomer(data.customerId);
      return { ok: true, message: data.status === "SUSPENDED" ? "Compte client suspendu." : "Compte client réactivé." };
    },
  );
}

export async function anonymizeCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(
    z.object({ customerId: z.string().min(1), confirmation: z.literal("ANONYMISER", { error: "Saisissez ANONYMISER pour confirmer" }) }),
    formToObject(formData),
    async (actor, data) => {
      await anonymizeCustomer(actor, data.customerId);
      revalidateCustomer(data.customerId);
      return { ok: true, message: "Données personnelles anonymisées." };
    },
  );
}

// ----------------------------------------------------------------------------- Préparateurs

const preparerSchema = z.object({
  firstName: requiredText("Prénom", 1, 60),
  lastName: requiredText("Nom", 1, 60),
  email: emailField(),
  phone: phoneField(),
  city: requiredText("Ville", 1, 80),
  country: requiredText("Pays", 2, 2),
  businessAddressLine1: optionalText(160),
  businessAddressLine2: optionalText(160),
  businessPostalCode: optionalText(20),
  businessCity: optionalText(80),
  businessCountry: optionalText(2),
  compatibleCarriers: stringArray(),
  storageCapacity: intField("Capacité de stockage", { min: 0, max: 100000 }),
  maxClients: intField("Nombre maximal de clients", { min: 0, max: 1000 }),
  availabilityNote: optionalText(300),
  adminNotes: optionalText(5000),
});

export async function createPreparerAction(_prev: ActionState<{ invitationUrl: string; preparerId: string }>, formData: FormData): Promise<ActionState<{ invitationUrl: string; preparerId: string }>> {
  return runAction<typeof preparerSchema, { invitationUrl: string; preparerId: string }>(preparerSchema, formToObject(formData), async (actor, data) => {
    const { preparer, invitationUrl } = await createPreparer(actor, data);
    revalidatePath("/admin/preparateurs");
    return { ok: true, message: "Préparateur créé. Une invitation lui a été envoyée.", data: { invitationUrl, preparerId: preparer.id } };
  });
}

export async function updatePreparerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = preparerSchema.extend({ preparerId: z.string().min(1) });
  return runAction(schema, formToObject(formData), async (actor, data) => {
    const { preparerId, ...input } = data;
    await updatePreparer(actor, preparerId, input);
    revalidatePath(`/admin/preparateurs/${preparerId}`);
    revalidatePath("/admin/preparateurs");
    return { ok: true, message: "Fiche préparateur mise à jour." };
  });
}

export async function setPreparerStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({
    preparerId: z.string().min(1),
    status: z.enum(["ACTIVE", "UNAVAILABLE", "SUSPENDED"]),
    reason: requiredText("Motif", 3, 500),
    startReassignment: checkbox(),
    deactivateAccount: checkbox(),
  });
  return runAction(schema, formToObject(formData), async (actor, data) => {
    const { reassigning } = await setPreparerStatus(actor, {
      ...data,
      deactivateAccount: data.status === "ACTIVE" ? false : data.deactivateAccount,
    });
    revalidatePath(`/admin/preparateurs/${data.preparerId}`);
    revalidatePath("/admin/preparateurs");
    revalidatePath("/admin/attributions");
    return { ok: true, message: reassigning ? `Statut modifié — ${reassigning} client(s) à réattribuer.` : "Statut du préparateur modifié." };
  });
}

export async function resendInvitationAction(_prev: ActionState<{ invitationUrl: string }>, formData: FormData): Promise<ActionState<{ invitationUrl: string }>> {
  return runAction<z.ZodObject<{ preparerId: z.ZodString }>, { invitationUrl: string }>(z.object({ preparerId: z.string().min(1) }), formToObject(formData), async (actor, data) => {
    assertAdmin(actor, "preparers.manage");
    const preparer = await db.preparerProfile.findUnique({ where: { id: data.preparerId }, select: { userId: true } });
    if (!preparer) throw new NotFoundError("Préparateur introuvable.");
    const { url } = await sendInvitation(preparer.userId);
    await audit({ actor, action: "preparer.invitation_resent", entityType: "preparer", entityId: data.preparerId });
    return { ok: true, message: "Invitation renvoyée.", data: { invitationUrl: url } };
  });
}

const locationSchema = z.object({
  preparerId: z.string().min(1),
  locationId: optionalText(40),
  type: z.enum(["BUSINESS_ADDRESS", "LOCKER", "RELAY_POINT"]),
  label: requiredText("Libellé", 2, 80),
  network: optionalText(40),
  relayName: optionalText(160),
  addressLine1: requiredText("Adresse", 3, 160),
  addressLine2: optionalText(160),
  postalCode: requiredText("Code postal", 2, 20),
  city: requiredText("Ville", 1, 80),
  country: requiredText("Pays", 2, 2),
  externalId: optionalText(80),
  recipientName: requiredText("Nom du destinataire", 2, 120),
  openingHours: optionalText(200),
  instructions: optionalText(1000),
  isPrimary: checkbox(),
  validate: checkbox(),
});

export async function saveLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(locationSchema, formToObject(formData), async (actor, data) => {
    await saveLocation(actor, data);
    revalidatePath(`/admin/preparateurs/${data.preparerId}`);
    return { ok: true, message: data.validate ? "Lieu enregistré et validé." : "Lieu enregistré (à valider avant d'être communiqué aux clients)." };
  });
}

export async function setLocationValidationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ locationId: z.string().min(1), validated: z.enum(["1", "0"]), preparerId: z.string().min(1) }), formToObject(formData), async (actor, data) => {
    await setLocationValidation(actor, { locationId: data.locationId, validated: data.validated === "1" });
    revalidatePath(`/admin/preparateurs/${data.preparerId}`);
    return { ok: true, message: data.validated === "1" ? "Lieu validé : il est désormais visible par les clients." : "Validation retirée : le lieu n'est plus communiqué aux clients." };
  });
}

export async function deactivateLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ locationId: z.string().min(1), preparerId: z.string().min(1) }), formToObject(formData), async (actor, data) => {
    const { pendingOrders } = await deactivateLocation(actor, data.locationId);
    revalidatePath(`/admin/preparateurs/${data.preparerId}`);
    return { ok: true, message: pendingOrders ? `Lieu désactivé — ${pendingOrders} commande(s) encore en route vers ce lieu.` : "Lieu désactivé." };
  });
}

function dayBoundary(v: unknown, end: boolean) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  return new Date(`${v}T${end ? "23:59:59" : "00:00:00"}`);
}

export async function declareAbsenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({
    preparerId: z.string().min(1),
    startsAt: z.preprocess((v) => dayBoundary(v, false), z.date({ error: "Date de début invalide" })),
    endsAt: z.preprocess((v) => dayBoundary(v, true), z.date({ error: "Date de fin invalide" })),
    reason: optionalText(300),
  });
  return runAction(schema, formToObject(formData), async (actor, data) => {
    await declareAbsence(actor, data);
    revalidatePath(`/admin/preparateurs/${data.preparerId}`);
    return { ok: true, message: "Absence enregistrée. Les clients attribués ont été prévenus." };
  });
}

export async function cancelAbsenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ absenceId: z.string().min(1), preparerId: z.string().min(1) }), formToObject(formData), async (actor, data) => {
    await cancelAbsence(actor, data.absenceId);
    revalidatePath(`/admin/preparateurs/${data.preparerId}`);
    return { ok: true, message: "Absence annulée." };
  });
}

/** Conversation directe administration ↔ préparateur (conversation de support). */
export async function messagePreparerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({ preparerId: z.string().min(1), subject: requiredText("Objet", 3, 140), body: requiredText("Message", 2, 5000) });
  return runAction(schema, formToObject(formData), async (actor, data) => {
    assertAdmin(actor, "support.manage");
    const preparer = await db.preparerProfile.findUnique({ where: { id: data.preparerId }, select: { id: true, userId: true } });
    if (!preparer) throw new NotFoundError("Préparateur introuvable.");
    let conversation = await db.conversation.findFirst({
      where: {
        type: "SUPPORT",
        status: "OPEN",
        preparerId: preparer.id,
        customerId: null,
        participants: { some: { userId: actor.userId } },
        AND: [{ participants: { some: { userId: preparer.userId } } }],
      },
      orderBy: { lastMessageAt: "desc" },
    });
    if (!conversation) {
      conversation = await db.conversation.create({
        data: {
          type: "SUPPORT",
          subject: data.subject,
          preparerId: preparer.id,
          participants: { create: [{ userId: preparer.userId }, { userId: actor.userId, lastReadAt: new Date() }] },
        },
      });
    }
    await sendMessage(actor, { conversationId: conversation.id, body: data.body });
    await audit({ actor, action: "preparer.message", entityType: "preparer", entityId: preparer.id, summary: data.subject });
    return { ok: true, message: "Message envoyé au préparateur.", redirectTo: `/admin/support?c=${conversation.id}` };
  });
}

// ----------------------------------------------------------------------------- Support / contact

export async function markContactHandledAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ id: z.string().min(1) }), formToObject(formData), async (actor, data) => {
    assertAdmin(actor, "support.manage");
    const res = await db.contactRequest.updateMany({
      where: { id: data.id, status: "NEW" },
      data: { status: "HANDLED", handledById: actor.userId, handledAt: new Date() },
    });
    if (res.count === 0) throw new DomainError("ALREADY", "Cette demande est déjà traitée.");
    await audit({ actor, action: "contact.handled", entityType: "contact_request", entityId: data.id });
    revalidatePath("/admin/support");
    return { ok: true, message: "Demande marquée comme traitée." };
  });
}

// ----------------------------------------------------------------------------- Incidents

export async function assignIncidentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({
    incidentId: z.string().min(1),
    adminId: optionalText(40),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  });
  return runAction(schema, formToObject(formData), async (actor, data) => {
    await assignIncident(actor, { incidentId: data.incidentId, adminId: data.adminId ?? null, priority: data.priority });
    revalidatePath(`/admin/incidents/${data.incidentId}`);
    revalidatePath("/admin/incidents");
    return { ok: true, message: "Prise en charge mise à jour." };
  });
}

export async function reclassifyShipmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({
    incidentId: z.string().min(1),
    shipmentId: z.string().min(1),
    size: z.enum(["SMALL", "MEDIUM", "LARGE"]),
    reason: requiredText("Justification", 5, 500),
  });
  return runAction(schema, formToObject(formData), async (actor, data) => {
    await adminReclassify(actor, { shipmentId: data.shipmentId, size: data.size, reason: data.reason });
    revalidatePath(`/admin/incidents/${data.incidentId}`);
    return { ok: true, message: "Classification corrigée. Le client a été notifié." };
  });
}

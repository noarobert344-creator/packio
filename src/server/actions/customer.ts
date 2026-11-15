"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-types";
import { checkbox, intField, optionalDate, optionalText, phoneField, requiredText, stringArray } from "@/lib/forms";
import { formToObject, runAction } from "@/server/action";
import { requireCustomer } from "@/server/auth/current";
import {
  changePlan,
  devCompleteCreditPack,
  devCompleteSubscription,
  devRecoverPayment,
  devSimulatePaymentFailure,
  devSimulateRenewal,
  openBillingPortal,
  setCancelAtPeriodEnd,
  startCreditPackCheckout,
  startSubscriptionCheckout,
} from "@/server/billing";
import { createSupplierOrder, customerUpdateOrder, reportOrderProblem } from "@/server/services/orders";
import { cancelShipment, disputeClassification, requestShipment } from "@/server/services/shipments";
import { createSupportConversation } from "@/server/services/messaging";

const SUPPLIER_STATUS_BY_CUSTOMER = ["SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER", "CANCELLED"] as const;

// ----------------------------------------------------------------------------- Abonnement

export async function startSubscriptionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ planId: z.string().min(1) }), formToObject(formData), async (actor, data) => {
    const { url } = await startSubscriptionCheckout(actor, data.planId);
    return { ok: true, message: "Redirection vers le paiement sécurisé…", redirectTo: url };
  });
}

export async function changePlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ planId: z.string().min(1) }), formToObject(formData), async (actor, data) => {
    const { scheduled } = await changePlan(actor, data.planId);
    revalidatePath("/client", "layout");
    return {
      ok: true,
      message: scheduled ? "Changement d'offre programmé : il prendra effet au prochain renouvellement." : "Changement d'offre annulé : vous conservez votre offre actuelle.",
      redirectTo: "/client/facturation",
    };
  });
}

export async function cancelSubscriptionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ cancel: z.enum(["1", "0"]) }), formToObject(formData), async (actor, data) => {
    await setCancelAtPeriodEnd(actor, data.cancel === "1");
    revalidatePath("/client", "layout");
    return { ok: true, message: data.cancel === "1" ? "Résiliation programmée à la fin de la période en cours." : "Votre abonnement continuera d'être renouvelé." };
  });
}

export async function openPortalAction(): Promise<void> {
  const actor = await requireCustomer();
  const { url } = await openBillingPortal(actor);
  redirect(url);
}

export async function buyCreditsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ packId: z.string().min(1) }), formToObject(formData), async (actor, data) => {
    const { url } = await startCreditPackCheckout(actor, data.packId);
    return { ok: true, message: "Redirection vers le paiement sécurisé…", redirectTo: url };
  });
}

/** Paiement de démonstration (BILLING_MODE=dev uniquement, vérifié côté serveur). */
export async function devCheckoutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ type: z.enum(["abonnement", "credits"]), id: z.string().min(1) }), formToObject(formData), async (actor, data) => {
    if (data.type === "abonnement") {
      await devCompleteSubscription(actor, data.id);
      revalidatePath("/client", "layout");
      return { ok: true, message: "Paiement simulé : abonnement activé.", redirectTo: "/client?abonnement=confirme" };
    }
    await devCompleteCreditPack(actor, data.id);
    revalidatePath("/client", "layout");
    return { ok: true, message: "Paiement simulé : crédits ajoutés.", redirectTo: "/client/credits?recharge=confirmee" };
  });
}

export async function devBillingToolAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ tool: z.enum(["renewal", "failure", "recover"]) }), formToObject(formData), async (actor, data) => {
    const customerId = actor.customerId!;
    if (data.tool === "renewal") await devSimulateRenewal(customerId);
    else if (data.tool === "failure") await devSimulatePaymentFailure(customerId);
    else await devRecoverPayment(customerId);
    revalidatePath("/client", "layout");
    return { ok: true, message: "Simulation effectuée." };
  });
}

// ----------------------------------------------------------------------------- Commandes fournisseurs

const orderSchema = z.object({
  supplierId: requiredText("Fournisseur", 1, 40),
  supplierLabel: optionalText(120),
  locationId: requiredText("Point de réception", 1, 40),
  articleUrl: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.url({ error: "Lien invalide" }).max(2000).optional()),
  supplierOrderNumber: optionalText(120),
  trackingNumber: optionalText(120),
  carrier: optionalText(40),
  description: requiredText("Description", 3, 500),
  quantity: intField("Quantité", { min: 1, max: 999 }),
  expectedArrivalAt: optionalDate(),
  instructions: optionalText(1000),
  compatibilityConfirmed: checkbox(),
  photoIds: stringArray(),
});

export async function createOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(orderSchema, formToObject(formData), async (actor, data) => {
    const order = await createSupplierOrder(actor, data);
    revalidatePath("/client", "layout");
    return { ok: true, message: `Commande ${order.reference} enregistrée. Votre préparateur est prévenu.`, redirectTo: `/client/commandes/${order.id}` };
  });
}

const updateOrderSchema = z.object({
  orderId: z.string().min(1),
  status: z.enum(SUPPLIER_STATUS_BY_CUSTOMER).optional().or(z.literal("").transform(() => undefined)),
  trackingNumber: optionalText(120),
  carrier: optionalText(40),
  pickupCode: optionalText(40),
  supplierOrderNumber: optionalText(120),
  note: optionalText(500),
});

export async function updateOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(updateOrderSchema, formToObject(formData), async (actor, data) => {
    const fields: Parameters<typeof customerUpdateOrder>[1] = { orderId: data.orderId, status: data.status, note: data.note ?? null };
    if (formData.has("trackingNumber")) fields.trackingNumber = data.trackingNumber ?? null;
    if (formData.has("carrier")) fields.carrier = data.carrier ?? null;
    if (formData.has("pickupCode")) fields.pickupCode = data.pickupCode ?? null;
    if (formData.has("supplierOrderNumber")) fields.supplierOrderNumber = data.supplierOrderNumber ?? null;
    await customerUpdateOrder(actor, fields);
    revalidatePath(`/client/commandes/${data.orderId}`);
    revalidatePath("/client/commandes");
    return { ok: true, message: "Commande mise à jour." };
  });
}

const problemSchema = z.object({
  orderId: z.string().min(1),
  type: z.enum(["INBOUND_DAMAGED", "INBOUND_MISSING", "WRONG_ITEM", "LOCKER_ISSUE", "OTHER"]),
  description: requiredText("Description", 10, 3000),
  photoIds: stringArray(),
});

export async function reportOrderProblemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(problemSchema, formToObject(formData), async (actor, data) => {
    const { incident } = await reportOrderProblem(actor, data);
    revalidatePath(`/client/commandes/${data.orderId}`);
    return { ok: true, message: `Problème signalé (${incident.reference}).`, redirectTo: `/client/incidents/${incident.id}` };
  });
}

// ----------------------------------------------------------------------------- Expéditions

const shipmentSchema = z.object({
  itemIds: stringArray(),
  recipientName: requiredText("Destinataire", 2, 120),
  recipientCompany: optionalText(120),
  recipientPhone: phoneField(),
  recipientEmail: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.email({ error: "E-mail invalide" }).optional()),
  addressLine1: requiredText("Adresse", 3, 200),
  addressLine2: optionalText(200),
  postalCode: requiredText("Code postal", 2, 20),
  city: requiredText("Ville", 1, 100),
  country: requiredText("Pays", 2, 2),
  requestedCarrier: optionalText(40),
  labelMode: z.enum(["CUSTOMER_PROVIDED", "PREPARER_PROVIDED"]),
  labelFileIds: stringArray(),
  instructions: optionalText(1000),
  options: stringArray(),
});

export async function requestShipmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(shipmentSchema, formToObject(formData), async (actor, data) => {
    const items = data.itemIds
      .map((itemId) => ({ itemId, quantity: Number(formData.get(`qty:${itemId}`) ?? 0) }))
      .filter((l) => Number.isInteger(l.quantity) && l.quantity > 0);
    const shipment = await requestShipment(actor, {
      ...data,
      items,
      recipientPhone: data.recipientPhone ?? null,
      recipientEmail: data.recipientEmail ?? null,
      labelFileId: data.labelMode === "CUSTOMER_PROVIDED" ? (data.labelFileIds[0] ?? null) : null,
    });
    revalidatePath("/client", "layout");
    return { ok: true, message: `Expédition ${shipment.reference} demandée.`, redirectTo: `/client/expeditions/${shipment.id}` };
  });
}

export async function cancelShipmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ shipmentId: z.string().min(1), reason: optionalText(500) }), formToObject(formData), async (actor, data) => {
    const { releasedCredits } = await cancelShipment(actor, { shipmentId: data.shipmentId, reason: data.reason ?? "Annulée par le client" });
    revalidatePath("/client", "layout");
    return { ok: true, message: releasedCredits ? `Expédition annulée : ${releasedCredits} crédit(s) libéré(s).` : "Expédition annulée." };
  });
}

export async function disputeClassificationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ shipmentId: z.string().min(1), reason: requiredText("Motif", 10, 2000) }), formToObject(formData), async (actor, data) => {
    const incident = await disputeClassification(actor, data);
    return { ok: true, message: `Contestation enregistrée (${incident.reference}).`, redirectTo: `/client/incidents/${incident.id}` };
  });
}

// ----------------------------------------------------------------------------- RGPD

export async function requestAccountDeletionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ details: optionalText(2000) }), formToObject(formData), async (actor, data) => {
    const conversation = await createSupportConversation(actor, {
      subject: "Demande de suppression de compte (RGPD)",
      body: `Je demande la suppression de mon compte et de mes données personnelles.${data.details ? `\n\nPrécisions : ${data.details}` : ""}`,
    });
    return { ok: true, message: "Demande transmise. L'équipe Packio vous répond dans la messagerie.", redirectTo: `/client/messages?c=${conversation.id}` };
  });
}

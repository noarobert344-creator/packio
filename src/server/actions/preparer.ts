"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-types";
import { checkbox, dateField, intField, optionalInt, optionalText, requiredText, stringArray } from "@/lib/forms";
import { CARRIERS } from "@/lib/labels";
import { formToObject, runAction } from "@/server/action";
import { DomainError } from "@/server/errors";
import { markPickedUp, preparerSetOrderStatus, receiveOrder, reportOrderProblem, stockOrder } from "@/server/services/orders";
import {
  addItemManually,
  adjustQuantity,
  declareDamaged,
  declareMissing,
  markFound,
  performInventoryCount,
  updateItemDetails,
} from "@/server/services/inventory";
import {
  classifyShipment,
  confirmDropOff,
  confirmLabel,
  markReady,
  reportShipmentIncident,
  startPreparation,
  updateTransit,
} from "@/server/services/shipments";
import { preparerDebitCredits, PREPARER_DEBIT_MAX } from "@/server/services/preparer-credits";
import {
  cancelAbsence,
  completeOnboarding,
  deactivateLocation,
  declareAbsence,
  ONBOARDING_LOCKER_NETWORKS,
  saveLocation,
  setPrimaryLocation,
  updateAvailability,
  type OnboardingInput,
  type WeeklyAvailability,
} from "@/server/services/preparers";
import { assertPreparer } from "@/server/auth/actor";

function refresh(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/preparateur", "layout");
}

const id = z.string().min(1).max(64);
const optionalEuros = () =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Math.round(Number(v.replace(",", ".").replace(/\s/g, "")) * 100) : undefined),
    z.number({ error: "Montant invalide" }).int().min(0, { error: "Montant invalide" }).max(100000, { error: "Montant trop élevé" }).optional(),
  );

// -----------------------------------------------------------------------------
// Réceptions (commandes fournisseurs)
// -----------------------------------------------------------------------------

export async function markPickedUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ orderId: id, note: optionalText(1000), photoIds: stringArray() }), formToObject(formData), async (actor, data) => {
    await markPickedUp(actor, data);
    refresh(`/preparateur/receptions/${data.orderId}`, "/preparateur/receptions");
    return { ok: true, message: "Récupération confirmée. Le client est notifié." };
  });
}

const receiveSchema = z.object({
  orderId: id,
  quantityReceived: intField("Quantité reçue", { min: 0, max: 999 }),
  condition: z.enum(["ok", "defaut"], { error: "Indiquez l'état du colis" }),
  conditionNotes: optionalText(2000),
  photoIds: stringArray(),
  qualityCheck: checkbox(),
});

export async function receiveOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(receiveSchema, formToObject(formData), async (actor, data) => {
    if (data.condition === "defaut" && !data.conditionNotes) {
      return { ok: false, error: "Décrivez le défaut constaté.", fieldErrors: { conditionNotes: "Description requise" } };
    }
    await receiveOrder(actor, {
      orderId: data.orderId,
      quantityReceived: data.quantityReceived,
      conditionOk: data.condition === "ok",
      conditionNotes: data.conditionNotes,
      photoIds: data.photoIds,
      qualityCheck: data.qualityCheck,
    });
    refresh(`/preparateur/receptions/${data.orderId}`, "/preparateur/receptions");
    return { ok: true, message: "Colis réceptionné. Le client est notifié." };
  });
}

/** Mise en stock : lignes dynamiques name[] / quantity[] / location[] + photos par ligne (photosN[]). */
export async function stockOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = String(formData.get("orderId") ?? "");
  const names = formData.getAll("name[]").map(String);
  const quantities = formData.getAll("quantity[]").map(String);
  const locations = formData.getAll("location[]").map(String);
  const rowKeys = formData.getAll("row[]").map(String);
  const rows = names.map((name, i) => ({
    name: name.trim(),
    quantity: Number(quantities[i]),
    storageLocation: locations[i]?.trim() || null,
    photoIds: formData.getAll(`photos${rowKeys[i] ?? i}[]`).map(String),
  }));
  return runAction(z.object({ orderId: id }), { orderId }, async (actor) => {
    const fieldErrors: Record<string, string> = {};
    if (!rows.length) return { ok: false, error: "Ajoutez au moins un article." };
    rows.forEach((r, i) => {
      if (r.name.length < 2) fieldErrors[`name.${i}`] = "Nom requis";
      if (!Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > 999) fieldErrors[`quantity.${i}`] = "Entre 1 et 999";
    });
    if (Object.keys(fieldErrors).length) return { ok: false, error: "Vérifiez les articles à mettre en stock.", fieldErrors };
    const { items } = await stockOrder(actor, { orderId, items: rows });
    refresh(`/preparateur/receptions/${orderId}`, "/preparateur/receptions", "/preparateur/stock");
    return { ok: true, message: `${items.length} article(s) mis en stock. Le client est notifié.` };
  });
}

const ORDER_PROBLEM_TYPES = ["INBOUND_DAMAGED", "WRONG_ITEM", "INBOUND_MISSING", "LOCKER_ISSUE"] as const;

export async function reportOrderProblemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(
    z.object({ orderId: id, type: z.enum(ORDER_PROBLEM_TYPES, { error: "Choisissez un type" }), description: requiredText("Description", 5, 4000), photoIds: stringArray() }),
    formToObject(formData),
    async (actor, data) => {
      const { incident } = await reportOrderProblem(actor, data);
      refresh(`/preparateur/receptions/${data.orderId}`, "/preparateur/receptions", "/preparateur/incidents");
      return { ok: true, message: `Incident ${incident.reference} signalé au client et à l'équipe Packio.` };
    },
  );
}

export async function setOrderStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(
    z.object({ orderId: id, status: z.enum(["QUALITY_CHECK", "RETURNED_TO_SUPPLIER", "AT_LOCKER"]), note: optionalText(1000) }),
    formToObject(formData),
    async (actor, data) => {
      await preparerSetOrderStatus(actor, data);
      refresh(`/preparateur/receptions/${data.orderId}`, "/preparateur/receptions");
      return { ok: true, message: "Statut mis à jour." };
    },
  );
}

// -----------------------------------------------------------------------------
// Stock
// -----------------------------------------------------------------------------

export async function addItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(
    z.object({
      customerId: id,
      name: requiredText("Nom de l'article", 2, 200),
      description: optionalText(1000),
      supplierName: optionalText(120),
      quantity: intField("Quantité", { min: 1, max: 999 }),
      storageLocation: optionalText(60),
      photoIds: stringArray(),
    }),
    formToObject(formData),
    async (actor, data) => {
      const item = await addItemManually(actor, data);
      refresh("/preparateur/stock", `/preparateur/clients/${data.customerId}`);
      return { ok: true, message: `${item.name} ajouté au stock (${item.sku}).` };
    },
  );
}

/** Inventaire : champs count:<itemId> = quantité comptée. */
export async function inventoryCountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const counts: { itemId: string; counted: number }[] = [];
  const fieldErrors: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("count:") || typeof value !== "string") continue;
    const itemId = key.slice(6);
    if (value.trim() === "") continue;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 99999) fieldErrors[key] = "Quantité invalide";
    else counts.push({ itemId, counted: n });
  }
  return runAction(z.object({ customerId: id, notes: optionalText(2000) }), formToObject(formData), async (actor, data) => {
    if (Object.keys(fieldErrors).length) return { ok: false, error: "Certaines quantités sont invalides.", fieldErrors };
    if (!counts.length) return { ok: false, error: "Saisissez au moins une quantité comptée." };
    const { discrepancies } = await performInventoryCount(actor, { customerId: data.customerId, counts, notes: data.notes });
    refresh("/preparateur/stock", `/preparateur/clients/${data.customerId}`);
    return {
      ok: true,
      message: discrepancies ? `Inventaire enregistré : ${discrepancies} écart(s) corrigé(s), le client est informé.` : "Inventaire enregistré : aucun écart.",
    };
  });
}

export async function adjustQuantityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(
    z.object({ itemId: id, delta: intField("Variation", { min: -999, max: 999 }), reason: requiredText("Motif", 3, 500) }),
    formToObject(formData),
    async (actor, data) => {
      if (data.delta === 0) return { ok: false, error: "Indiquez une variation non nulle.", fieldErrors: { delta: "Non nulle" } };
      await adjustQuantity(actor, data);
      refresh(`/preparateur/stock/${data.itemId}`, "/preparateur/stock", "/preparateur/a-vendre");
      return { ok: true, message: "Quantité mise à jour." };
    },
  );
}

export async function updateItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const raw = formToObject(formData);
  return runAction(
    z.object({
      itemId: id,
      name: optionalText(200),
      storageLocation: z.string().max(60).optional(),
      notes: z.string().max(2000).optional(),
      photoIds: stringArray(),
    }),
    raw,
    async (actor, data) => {
      await updateItemDetails(actor, {
        itemId: data.itemId,
        name: data.name,
        storageLocation: "storageLocation" in raw ? (data.storageLocation ?? null) : undefined,
        notes: "notes" in raw ? (data.notes ?? null) : undefined,
        photoIds: data.photoIds,
      });
      refresh(`/preparateur/stock/${data.itemId}`, "/preparateur/stock", "/preparateur/a-vendre");
      return { ok: true, message: data.photoIds.length ? "Photos ajoutées." : "Article mis à jour." };
    },
  );
}

const lossSchema = z.object({ itemId: id, kind: z.enum(["DAMAGE", "MISSING"]), quantity: intField("Quantité", { min: 1, max: 999 }), reason: requiredText("Description", 3, 1000) });

export async function declareLossAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(lossSchema, formToObject(formData), async (actor, data) => {
    const input = { itemId: data.itemId, quantity: data.quantity, reason: data.reason };
    if (data.kind === "DAMAGE") await declareDamaged(actor, input);
    else await declareMissing(actor, input);
    refresh(`/preparateur/stock/${data.itemId}`, "/preparateur/stock", "/preparateur/incidents");
    return { ok: true, message: "Signalement enregistré : un incident est ouvert, le client et l'équipe Packio sont prévenus." };
  });
}

export async function markFoundAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ itemId: id, quantity: intField("Quantité", { min: 1, max: 999 }), reason: optionalText(500) }), formToObject(formData), async (actor, data) => {
    await markFound(actor, data);
    refresh(`/preparateur/stock/${data.itemId}`, "/preparateur/stock");
    return { ok: true, message: "Article de nouveau disponible." };
  });
}

// -----------------------------------------------------------------------------
// Expéditions
// -----------------------------------------------------------------------------

const classifySchema = z.object({
  shipmentId: id,
  size: z.enum(["SMALL", "MEDIUM", "LARGE"], { error: "Sélectionnez une catégorie de colis" }),
  weightGrams: optionalInt("Poids", { min: 1, max: 100000 }),
  lengthCm: optionalInt("Longueur", { min: 1, max: 500 }),
  widthCm: optionalInt("Largeur", { min: 1, max: 500 }),
  heightCm: optionalInt("Hauteur", { min: 1, max: 500 }),
  note: optionalText(1000),
});

export async function classifyShipmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(classifySchema, formToObject(formData), async (actor, data) => {
    const dims = [data.lengthCm, data.widthCm, data.heightCm].filter((d) => d !== undefined);
    if (dims.length > 0 && dims.length < 3) {
      return { ok: false, error: "Renseignez les trois dimensions, ou aucune.", fieldErrors: { lengthCm: "Dimensions incomplètes" } };
    }
    const updated = await classifyShipment(actor, data);
    refresh(`/preparateur/expeditions/${data.shipmentId}`, "/preparateur/expeditions");
    return {
      ok: true,
      message:
        updated.status === "AWAITING_CREDITS"
          ? "Classification enregistrée. Solde du client insuffisant : l'expédition reprendra après sa recharge."
          : `Classification enregistrée : ${updated.creditCost ?? 0} crédit(s) réservé(s).`,
    };
  });
}

export async function startPreparationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ shipmentId: id }), formToObject(formData), async (actor, data) => {
    await startPreparation(actor, data);
    refresh(`/preparateur/expeditions/${data.shipmentId}`, "/preparateur/expeditions");
    return { ok: true, message: "Préparation démarrée." };
  });
}

export async function markReadyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ shipmentId: id, photoIds: stringArray(), note: optionalText(1000) }), formToObject(formData), async (actor, data) => {
    await markReady(actor, data);
    refresh(`/preparateur/expeditions/${data.shipmentId}`, "/preparateur/expeditions");
    return { ok: true, message: "Colis prêt." };
  });
}

export async function confirmLabelAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ shipmentId: id, labelIds: stringArray(), note: optionalText(500) }), formToObject(formData), async (actor, data) => {
    await confirmLabel(actor, { shipmentId: data.shipmentId, labelFileId: data.labelIds[0] ?? null, note: data.note });
    refresh(`/preparateur/expeditions/${data.shipmentId}`, "/preparateur/expeditions");
    return { ok: true, message: "Étiquette validée." };
  });
}

const CARRIER_CODES = CARRIERS.map((c) => c.code) as [string, ...string[]];

export async function confirmDropOffAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(
    z.object({
      shipmentId: id,
      carrier: z.enum(CARRIER_CODES, { error: "Choisissez le transporteur" }),
      trackingNumber: requiredText("Numéro de suivi", 4, 80),
      shippingFee: optionalEuros(),
      shippingFeeNote: optionalText(300),
    }),
    formToObject(formData),
    async (actor, data) => {
      const res = await confirmDropOff(actor, {
        shipmentId: data.shipmentId,
        carrier: data.carrier,
        trackingNumber: data.trackingNumber,
        shippingFeeCents: data.shippingFee ?? null,
        shippingFeeNote: data.shippingFeeNote,
      });
      refresh(`/preparateur/expeditions/${data.shipmentId}`, "/preparateur/expeditions", "/preparateur/stock");
      return {
        ok: true,
        message: res.alreadyConfirmed ? "Ce dépôt était déjà confirmé : aucun nouveau débit." : "Dépôt confirmé. Les crédits ont été débités et le client est notifié.",
      };
    },
  );
}

export async function updateTransitAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ shipmentId: id, status: z.enum(["IN_TRANSIT", "DELIVERED"]), note: optionalText(500) }), formToObject(formData), async (actor, data) => {
    await updateTransit(actor, data);
    refresh(`/preparateur/expeditions/${data.shipmentId}`, "/preparateur/expeditions");
    return { ok: true, message: data.status === "DELIVERED" ? "Expédition marquée comme livrée." : "Expédition marquée en transit." };
  });
}

export async function reportShipmentIncidentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(
    z.object({ shipmentId: id, type: z.enum(["SHIPMENT_ISSUE", "OTHER"]), description: requiredText("Description", 5, 4000), photoIds: stringArray() }),
    formToObject(formData),
    async (actor, data) => {
      const incident = await reportShipmentIncident(actor, data);
      refresh(`/preparateur/expeditions/${data.shipmentId}`, "/preparateur/incidents");
      return { ok: true, message: `Incident ${incident.reference} signalé.` };
    },
  );
}

// -----------------------------------------------------------------------------
// Disponibilités, absences, points de réception
// -----------------------------------------------------------------------------

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function updateAvailabilityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ note: optionalText(300) }), formToObject(formData), async (actor, data) => {
    const availability = {} as WeeklyAvailability;
    const fieldErrors: Record<string, string> = {};
    for (const d of DAYS) {
      const open = formData.get(`open:${d}`) === "on";
      const from = String(formData.get(`from:${d}`) ?? "09:00");
      const to = String(formData.get(`to:${d}`) ?? "18:00");
      if (open && (!TIME.test(from) || !TIME.test(to) || from >= to)) fieldErrors[`from:${d}`] = "Horaires invalides";
      availability[d] = { open, from: TIME.test(from) ? from : "09:00", to: TIME.test(to) ? to : "18:00" };
    }
    if (Object.keys(fieldErrors).length) return { ok: false, error: "Vérifiez les horaires (l'ouverture doit précéder la fermeture).", fieldErrors };
    await updateAvailability(actor, { availability, note: data.note });
    refresh("/preparateur/disponibilites");
    return { ok: true, message: "Disponibilités enregistrées." };
  });
}

export async function declareAbsenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(
    z.object({ startsAt: dateField("Date de début"), endsAt: dateField("Date de fin"), reason: optionalText(300) }),
    formToObject(formData),
    async (actor, data) => {
      const endsAt = new Date(data.endsAt);
      endsAt.setHours(23, 59, 59, 999);
      if (endsAt < data.startsAt) return { ok: false, error: "La date de fin doit suivre la date de début.", fieldErrors: { endsAt: "Date invalide" } };
      await declareAbsence(actor, { startsAt: data.startsAt, endsAt, reason: data.reason });
      refresh("/preparateur/disponibilites", "/preparateur");
      return { ok: true, message: "Absence déclarée. L'équipe Packio et vos clients sont prévenus." };
    },
  );
}

export async function cancelAbsenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ absenceId: id }), formToObject(formData), async (actor, data) => {
    await cancelAbsence(actor, data.absenceId);
    refresh("/preparateur/disponibilites", "/preparateur");
    return { ok: true, message: "Absence annulée." };
  });
}

const locationSchema = z.object({
  type: z.enum(["BUSINESS_ADDRESS", "LOCKER", "RELAY_POINT", "POST_OFFICE"], { error: "Type requis" }),
  label: requiredText("Libellé", 2, 80),
  network: optionalText(40),
  relayName: optionalText(160),
  addressLine1: requiredText("Adresse", 3, 200),
  addressLine2: optionalText(200),
  postalCode: requiredText("Code postal", 2, 12),
  city: requiredText("Ville", 2, 80),
  country: requiredText("Pays", 2, 2),
  externalId: optionalText(60),
  recipientName: requiredText("Nom du destinataire", 2, 120),
  recipientPhone: optionalText(40),
  openingHours: optionalText(200),
  instructions: optionalText(1000),
});

export async function proposeLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(locationSchema.extend({ locationId: id.optional() }), formToObject(formData), async (actor, data) => {
    const preparerId = assertPreparer(actor);
    const { locationId, ...input } = data;
    const location = await saveLocation(actor, { ...input, preparerId, locationId, isPrimary: locationId ? undefined : false });
    refresh("/preparateur/disponibilites", "/preparateur/parametres");
    if (location.validatedAt) return { ok: true, message: locationId ? "Point de réception modifié." : "Point de réception ajouté." };
    return {
      ok: true,
      message: locationId
        ? "Point de réception modifié : il sera de nouveau proposé à vos clients après vérification par l'équipe Packio."
        : "Point de réception proposé. Il sera communiqué aux clients après validation par l'équipe Packio.",
    };
  });
}

export async function removeLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ locationId: id }), formToObject(formData), async (actor, data) => {
    assertPreparer(actor);
    const { pendingOrders } = await deactivateLocation(actor, data.locationId);
    refresh("/preparateur/disponibilites", "/preparateur/parametres");
    return {
      ok: true,
      message: pendingOrders
        ? `Point retiré. ${pendingOrders} commande(s) déjà en route y arrivent quand même : pensez à les récupérer.`
        : "Point de réception retiré : il n'est plus proposé à vos clients.",
    };
  });
}

export async function setPrimaryLocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ locationId: id }), formToObject(formData), async (actor, data) => {
    assertPreparer(actor);
    await setPrimaryLocation(actor, data.locationId);
    refresh("/preparateur/disponibilites", "/preparateur/parametres");
    return { ok: true, message: "Point principal mis à jour : il est proposé en premier à vos clients." };
  });
}

// -----------------------------------------------------------------------------
// Questionnaire de bienvenue
// -----------------------------------------------------------------------------

const onboardingSchema = z.object({
  phone: requiredText("Téléphone", 6, 30),
  ...Object.fromEntries(
    ONBOARDING_LOCKER_NETWORKS.flatMap((n) => [
      [`${n.code}_relayName`, optionalText(150)],
      [`${n.code}_addressLine1`, optionalText(200)],
      [`${n.code}_postalCode`, optionalText(10)],
      [`${n.code}_city`, optionalText(100)],
    ]),
  ),
});

export async function completeOnboardingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(onboardingSchema, formToObject(formData), async (actor, data) => {
    const values = data as Record<string, string | undefined>;
    const lockers: OnboardingInput["lockers"] = [];
    const fieldErrors: Record<string, string> = {};
    for (const n of ONBOARDING_LOCKER_NETWORKS) {
      const block = {
        relayName: values[`${n.code}_relayName`] ?? "",
        addressLine1: values[`${n.code}_addressLine1`] ?? "",
        postalCode: values[`${n.code}_postalCode`] ?? "",
        city: values[`${n.code}_city`] ?? "",
      };
      const filled = Object.values(block).filter((v) => v.trim()).length;
      if (filled === 0) continue; // Locker facultatif non renseigné.
      if (filled < 4) {
        for (const [k, v] of Object.entries(block)) if (!v.trim()) fieldErrors[`${n.code}_${k}`] = "Requis pour ce locker";
        continue;
      }
      lockers.push({ network: n.code, ...block });
    }
    if (Object.keys(fieldErrors).length) {
      throw new DomainError("LOCKER", "Complétez chaque locker renseigné, ou laissez-le entièrement vide.", { fieldErrors });
    }
    const res = await completeOnboarding(actor, { phone: data.phone, lockers });
    revalidatePath("/preparateur", "layout");
    return {
      ok: true,
      message: `Merci ! ${res.locations} point(s) de réception envoyé(s) à l'équipe Packio pour validation.`,
      redirectTo: "/preparateur",
    };
  });
}

// -----------------------------------------------------------------------------
// Retrait de crédits justifié
// -----------------------------------------------------------------------------

export async function preparerDebitCreditsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(
    z.object({ customerId: id, amount: intField("Crédits", { min: 1, max: PREPARER_DEBIT_MAX }), reason: requiredText("Motif", 10, 500), requestId: id }),
    formToObject(formData),
    async (actor, data) => {
      const res = await preparerDebitCredits(actor, data);
      revalidatePath(`/preparateur/clients/${data.customerId}`);
      return {
        ok: true,
        message: res.applied ? `${res.debited} crédit(s) retiré(s). Le motif a été envoyé à votre client dans la messagerie.` : "Ce retrait a déjà été enregistré.",
      };
    },
  );
}

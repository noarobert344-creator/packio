"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-types";
import { checkbox, emailField, euroToCents, intField, optionalEuroToCents, optionalInt, optionalText, requiredText, stringArray } from "@/lib/forms";
import { formToObject, runAction } from "@/server/action";
import { assertAdmin } from "@/server/auth/actor";
import { ALL_PERMISSIONS } from "@/server/auth/permissions";
import { refundPayment } from "@/server/billing";
import { inviteAdmin, saveCreditPack, savePlan, saveRole, saveSizeRules, saveSupplier, setStaffRole, updateSettings } from "@/server/services/catalog";
import { adminAdjustCredits } from "@/server/services/credits";
import { markNotificationsRead } from "@/server/services/notifications";
import { getSetting } from "@/server/services/settings";
import { adminReclassify, cancelShipment, updateTransit } from "@/server/services/shipments";

const SIZES = ["SMALL", "MEDIUM", "LARGE"] as const;
const LOCATION_TYPES = ["BUSINESS_ADDRESS", "LOCKER", "RELAY_POINT", "POST_OFFICE"] as const;

// ----------------------------------------------------------------------------- Expéditions

export async function cancelShipmentAdminAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ shipmentId: z.string(), reason: requiredText("Motif", 3, 500) }), formToObject(formData), async (actor, data) => {
    const { releasedCredits } = await cancelShipment(actor, data);
    revalidatePath(`/admin/expeditions/${data.shipmentId}`);
    revalidatePath("/admin/expeditions");
    return { ok: true, message: `Expédition annulée${releasedCredits ? ` — ${releasedCredits} crédit(s) libéré(s)` : ""}.` };
  });
}

export async function reclassifyShipmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(
    z.object({ shipmentId: z.string(), size: z.enum(SIZES, { error: "Catégorie requise" }), reason: requiredText("Justification", 5, 500) }),
    formToObject(formData),
    async (actor, data) => {
      await adminReclassify(actor, data);
      revalidatePath(`/admin/expeditions/${data.shipmentId}`);
      return { ok: true, message: "Classification corrigée." };
    },
  );
}

export async function updateTransitAdminAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(
    z.object({ shipmentId: z.string(), status: z.enum(["IN_TRANSIT", "DELIVERED"]), note: optionalText(500) }),
    formToObject(formData),
    async (actor, data) => {
      await updateTransit(actor, data);
      revalidatePath(`/admin/expeditions/${data.shipmentId}`);
      return { ok: true, message: data.status === "DELIVERED" ? "Expédition marquée comme livrée." : "Expédition marquée en transit." };
    },
  );
}

// ----------------------------------------------------------------------------- Offres, colis, recharges

const planSchema = z.object({
  id: optionalText(40),
  code: requiredText("Code", 2, 30),
  name: requiredText("Nom", 2, 60),
  tagline: optionalText(160),
  price: euroToCents("Prix"),
  monthlyCredits: intField("Crédits mensuels", { min: 0, max: 100000 }),
  storageLimit: optionalInt("Limite de stockage", { min: 0, max: 1000000 }),
  features: z.preprocess((v) => (typeof v === "string" ? v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []), z.array(z.string().max(160)).max(20)),
  highlighted: checkbox(),
  isActive: checkbox(),
  sortOrder: intField("Ordre", { min: 0, max: 999 }),
  whopPlanId: optionalText(80),
  annualPrice: optionalEuroToCents("Prix annuel"),
  whopAnnualPlanId: optionalText(80),
});

export async function savePlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(planSchema, formToObject(formData), async (actor, data) => {
    const { priceChanged } = await savePlan(actor, {
      id: data.id,
      code: data.code,
      name: data.name,
      tagline: data.tagline ?? null,
      priceCents: data.price,
      monthlyCredits: data.monthlyCredits,
      storageLimit: data.storageLimit ?? null,
      features: data.features,
      highlighted: data.highlighted,
      isActive: data.isActive,
      sortOrder: data.sortOrder,
      whopPlanId: data.whopPlanId ?? null,
      annualPriceCents: data.annualPrice,
      whopAnnualPlanId: data.whopAnnualPlanId ?? null,
    });
    revalidatePath("/admin/abonnements");
    revalidatePath("/");
    return {
      ok: true,
      message: priceChanged
        ? "Offre enregistrée. Le nouveau prix s'applique aux nouvelles souscriptions ; les abonnés actuels conservent leur tarif chez Whop."
        : "Offre enregistrée.",
    };
  });
}

export async function saveSizeRulesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({}).passthrough(), formToObject(formData), async (actor) => {
    const num = (k: string, label: string, required = false) => {
      const raw = String(formData.get(k) ?? "").trim();
      if (!raw) {
        if (required) throw new z.ZodError([{ code: "custom", path: [k], message: `${label} requis`, input: raw }]);
        return null;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) throw new z.ZodError([{ code: "custom", path: [k], message: `${label} invalide`, input: raw }]);
      return n;
    };
    const rules = SIZES.map((size) => ({
      size,
      label: String(formData.get(`${size}.label`) ?? "").trim() || size,
      description: String(formData.get(`${size}.description`) ?? "").trim() || null,
      creditCost: num(`${size}.creditCost`, "Coût", true)!,
      maxLengthCm: num(`${size}.maxLengthCm`, "Longueur"),
      maxWidthCm: num(`${size}.maxWidthCm`, "Largeur"),
      maxHeightCm: num(`${size}.maxHeightCm`, "Hauteur"),
      maxWeightGrams: num(`${size}.maxWeightGrams`, "Poids"),
    }));
    await saveSizeRules(actor, rules);
    revalidatePath("/admin/abonnements");
    revalidatePath("/");
    return { ok: true, message: "Catégories de colis enregistrées. Les nouvelles classifications appliqueront ces coûts." };
  });
}

const packSchema = z.object({
  id: optionalText(40),
  name: requiredText("Nom", 2, 60),
  credits: intField("Crédits", { min: 1, max: 10000 }),
  price: euroToCents("Prix"),
  isActive: checkbox(),
  sortOrder: intField("Ordre", { min: 0, max: 999 }),
  whopPlanId: optionalText(80),
});

export async function saveCreditPackAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(packSchema, formToObject(formData), async (actor, data) => {
    await saveCreditPack(actor, { id: data.id, name: data.name, credits: data.credits, priceCents: data.price, isActive: data.isActive, sortOrder: data.sortOrder, whopPlanId: data.whopPlanId ?? null });
    revalidatePath("/admin/abonnements");
    return { ok: true, message: "Recharge enregistrée." };
  });
}

// ----------------------------------------------------------------------------- Crédits

const policySchema = z.object({
  monthlyMode: z.enum(["EXPIRE", "ROLLOVER"]),
  rolloverMonths: intField("Durée du report", { min: 1, max: 12 }),
  rolloverCapPercent: intField("Plafond du report", { min: 0, max: 1000 }),
  purchasedMode: z.enum(["NEVER", "EXPIRE_AFTER_DAYS"]),
  purchasedDays: intField("Durée de validité", { min: 1, max: 3650 }),
});

export async function saveCreditPolicyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(policySchema, formToObject(formData), async (actor, data) => {
    assertAdmin(actor, "credits.manage");
    await updateSettings(actor, "credits", {
      monthly: { mode: data.monthlyMode, rolloverMonths: data.rolloverMonths, rolloverCapPercent: data.rolloverCapPercent },
      purchased: { mode: data.purchasedMode, days: data.purchasedDays },
    });
    revalidatePath("/admin/credits");
    return { ok: true, message: "Politique de crédits enregistrée. Elle s'applique aux prochaines allocations et achats." };
  });
}

const adjustSchema = z.object({
  customerId: z.string().min(1, { error: "Client requis" }),
  direction: z.enum(["CREDIT", "DEBIT"]),
  amount: intField("Montant", { min: 1, max: 10000 }),
  bucket: z.enum(["MONTHLY", "PURCHASED"]),
  reason: requiredText("Justification", 5, 500),
  requestId: z.string().min(8),
});

export async function adjustCreditsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(adjustSchema, formToObject(formData), async (actor, data) => {
    const { applied } = await adminAdjustCredits(actor, data);
    revalidatePath("/admin/credits");
    revalidatePath(`/admin/clients/${data.customerId}`);
    return { ok: true, message: applied ? `${data.direction === "CREDIT" ? "Crédit" : "Débit"} de ${data.amount} crédit(s) enregistré.` : "Opération déjà enregistrée." };
  });
}

// ----------------------------------------------------------------------------- Paiements

const refundSchema = z.object({
  paymentId: z.string(),
  amount: z.preprocess(
    (v) => (typeof v === "string" && v.trim() ? Math.round(Number(v.replace(",", ".").replace(/\s/g, "")) * 100) : undefined),
    z.number({ error: "Montant invalide" }).int().positive({ error: "Montant invalide" }).optional(),
  ),
  removeCredits: checkbox(),
  reason: requiredText("Justification", 5, 500),
});

export async function refundPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(refundSchema, formToObject(formData), async (actor, data) => {
    await refundPayment(actor, { paymentId: data.paymentId, amountCents: data.amount ?? null, removeCredits: data.removeCredits, reason: data.reason });
    revalidatePath("/admin/paiements");
    return { ok: true, message: "Remboursement enregistré." };
  });
}

// ----------------------------------------------------------------------------- Notifications

export async function markMyNotificationsReadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({}).passthrough(), formToObject(formData), async (actor) => {
    await markNotificationsRead(actor.userId);
    revalidatePath("/admin/notifications");
    return { ok: true, message: "Toutes les notifications sont marquées comme lues." };
  });
}

export async function saveAdminEmailsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object({
    adminEmails: z.preprocess(
      (v) => (typeof v === "string" ? v.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean) : []),
      z.array(z.email({ error: "Adresse e-mail invalide" })).max(10, { error: "10 adresses maximum" }),
    ),
  });
  return runAction(schema, formToObject(formData), async (actor, data) => {
    await updateSettings(actor, "notifications", { adminEmails: [...new Set(data.adminEmails)] });
    revalidatePath("/admin/notifications");
    return { ok: true, message: "Destinataires des alertes enregistrés." };
  });
}

// ----------------------------------------------------------------------------- Paramètres

const platformSchema = z.object({
  slaHours: intField("Délai d'attribution", { min: 1, max: 168 }),
  supervisionMinutes: intField("Durée de supervision", { min: 5, max: 1440 }),
  supportEmail: emailField(),
  supportPhone: optionalText(40),
  supportHours: optionalText(120),
  shippingSlaHours: intField("Délai d'expédition", { min: 1, max: 336 }),
  shippingReturnCredits: intField("Coût d'un retour à domicile", { min: 0, max: 100 }),
  storageIncludedDays: intField("Durée incluse", { min: 1, max: 365 }),
  storageExtensionDays: intField("Durée d'une prolongation", { min: 1, max: 365 }),
  storageExtensionCredits: intField("Coût d'une prolongation", { min: 0, max: 100 }),
  storageSlotsPerCredit: intField("Places par crédit", { min: 1, max: 1000 }),
  storageExtraSlotsDays: intField("Durée des places", { min: 1, max: 365 }),
  storageReminderDaysBefore: intField("Rappel", { min: 0, max: 30 }),
});

export async function savePlatformSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(platformSchema, formToObject(formData), async (actor, data) => {
    await updateSettings(actor, "assignment", { slaHours: data.slaHours });
    await updateSettings(actor, "messaging", { supervisionMinutes: data.supervisionMinutes });
    await updateSettings(actor, "support", { email: data.supportEmail, phone: data.supportPhone ?? "", hours: data.supportHours ?? "" });
    await updateSettings(actor, "shipping", { slaHours: data.shippingSlaHours, returnCredits: data.shippingReturnCredits });
    await updateSettings(actor, "storage", {
      includedDays: data.storageIncludedDays,
      extensionDays: data.storageExtensionDays,
      extensionCredits: data.storageExtensionCredits,
      slotsPerCredit: data.storageSlotsPerCredit,
      extraSlotsDays: data.storageExtraSlotsDays,
      reminderDaysBefore: data.storageReminderDaysBefore,
    });
    revalidatePath("/admin/parametres");
    revalidatePath("/", "layout");
    return { ok: true, message: "Paramètres de la plateforme enregistrés." };
  });
}

const LEGAL_KEYS = [
  "companyName",
  "legalForm",
  "capital",
  "address",
  "siret",
  "rcs",
  "vatNumber",
  "publicationDirector",
  "contactEmail",
  "hostName",
  "hostAddress",
  "dpoEmail",
  "consumerMediator",
] as const;
const LEGAL_MAX: Partial<Record<(typeof LEGAL_KEYS)[number], number>> = { address: 240, hostAddress: 240, consumerMediator: 300 };

export async function saveLegalSettingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const schema = z.object(Object.fromEntries(LEGAL_KEYS.map((k) => [k, optionalText(LEGAL_MAX[k] ?? 120)])) as Record<(typeof LEGAL_KEYS)[number], ReturnType<typeof optionalText>>);
  return runAction(schema, formToObject(formData), async (actor, data) => {
    const current = await getSetting("legal");
    const next = { ...current };
    for (const k of LEGAL_KEYS) next[k] = (data[k] as string | undefined) ?? "";
    await updateSettings(actor, "legal", next);
    revalidatePath("/admin/parametres");
    revalidatePath("/legal", "layout");
    return { ok: true, message: "Informations légales enregistrées." };
  });
}

const supplierSchema = z.object({
  id: optionalText(40),
  code: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.string().regex(/^[A-Z0-9_]{2,30}$/, { error: "Code : lettres majuscules, chiffres, _" })),
  name: requiredText("Nom", 2, 80),
  websiteUrl: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.url({ error: "URL invalide" }).optional()),
  description: optionalText(500),
  acceptedLocationTypes: z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(z.enum(LOCATION_TYPES))),
  acceptedNetworks: stringArray(),
  requiresPickupCode: checkbox(),
  compatibilityNotes: optionalText(1000),
  orderModes: z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(z.enum(["STOCK", "DROPSHIP"]))),
  isActive: checkbox(),
  sortOrder: intField("Ordre", { min: 0, max: 999 }),
});

export async function saveSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(supplierSchema, formToObject(formData), async (actor, data) => {
    if (!data.acceptedLocationTypes.length) {
      return { ok: false, error: "Sélectionnez au moins un type de point de réception.", fieldErrors: { acceptedLocationTypes: "Au moins un type" } };
    }
    await saveSupplier(actor, { ...data, websiteUrl: data.websiteUrl ?? null, description: data.description ?? null, compatibilityNotes: data.compatibilityNotes ?? null });
    revalidatePath("/admin/parametres");
    return { ok: true, message: "Fournisseur enregistré." };
  });
}

const roleSchema = z.object({
  id: optionalText(40),
  key: optionalText(40),
  name: requiredText("Nom", 2, 60),
  description: optionalText(200),
  permissions: stringArray(),
});

export async function saveRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(roleSchema, formToObject(formData), async (actor, data) => {
    const permissions = data.permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p));
    await saveRole(actor, { id: data.id, key: data.key ?? data.name, name: data.name, description: data.description ?? null, permissions });
    revalidatePath("/admin/parametres");
    return { ok: true, message: "Rôle enregistré. Les membres concernés devront se reconnecter si leurs droits ont changé." };
  });
}

export async function setStaffRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ userId: z.string(), roleId: z.string().min(1, { error: "Rôle requis" }) }), formToObject(formData), async (actor, data) => {
    await setStaffRole(actor, data);
    revalidatePath("/admin/parametres");
    return { ok: true, message: "Rôle modifié. La personne devra se reconnecter." };
  });
}

const inviteSchema = z.object({
  firstName: requiredText("Prénom", 1, 60),
  lastName: requiredText("Nom", 1, 60),
  email: emailField(),
  roleId: z.string().min(1, { error: "Rôle requis" }),
});

export async function inviteAdminAction(_prev: ActionState<{ url: string }>, formData: FormData): Promise<ActionState<{ url: string }>> {
  return runAction(inviteSchema, formToObject(formData), async (actor, data) => {
    const { invitationUrl } = await inviteAdmin(actor, data);
    revalidatePath("/admin/parametres");
    return { ok: true, message: "Invitation envoyée.", data: { url: invitationUrl } };
  });
}

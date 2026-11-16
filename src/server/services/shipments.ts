import type { OutboundShipment } from "@/generated/prisma/client";
import { addHours, format } from "date-fns";
import { fr } from "date-fns/locale";
import type { IncidentType, LabelMode, ParcelSize, ShipmentKind, ShipmentStatus } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/db";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { assertAdmin, assertCustomer, assertPreparer, can, type Actor } from "@/server/auth/actor";
import { reference } from "@/server/lib/ids";
import { PARCEL_SIZE, SHIPMENT_CANCELLABLE_BY_CUSTOMER, SHIPMENT_STATUS, carrierLabel } from "@/lib/labels";
import { trackingUrl } from "@/lib/tracking";
import { audit } from "./audit";
import { withEffects, type Effects } from "./notifications";
import { assertCustomerOperational } from "./customers";
import { applyMovement, linkPhotos, lockItems } from "./inventory";
import { captureCredits, grantCredits, releaseCredits, reserveCredits, purchasedCreditsExpiry } from "./credits";
import { createIncidentTx } from "./incidents";
import { getSetting } from "./settings";
import { retryOverdueStorage } from "./storage";

/**
 * EXPÉDITIONS
 * 1. Le client demande l'expédition : les quantités sont réservées en stock.
 * 2. Le préparateur — et lui seul — classe le colis (petit / moyen / grand)
 *    selon les règles de l'administrateur ; le coût en crédits est calculé et
 *    réservé. Solde insuffisant → « En attente de crédits ».
 * 3. Préparation, colis prêt, étiquette.
 * 4. Confirmation du dépôt : débit définitif des crédits (idempotent, protégé
 *    par verrou de ligne + clé d'idempotence + index partiel unique) et sortie
 *    de stock.
 * Les frais de transport éventuels sont distincts des crédits de préparation.
 */

async function lockShipment(tx: Tx, shipmentId: string) {
  await tx.$queryRaw`SELECT "id" FROM "outbound_shipments" WHERE "id" = ${shipmentId} FOR UPDATE`;
  const shipment = await tx.outboundShipment.findUnique({ where: { id: shipmentId }, include: { items: true } });
  if (!shipment) throw new NotFoundError("Expédition introuvable.");
  return shipment;
}

async function setStatus(tx: Tx, shipment: OutboundShipment, status: ShipmentStatus, actorId: string | null, note?: string | null, data?: object) {
  const updated = await tx.outboundShipment.update({ where: { id: shipment.id }, data: { status } });
  await tx.shipmentEvent.create({ data: { shipmentId: shipment.id, status, actorId, note: note?.trim() || null, data: data ?? undefined } });
  return updated;
}

async function preparerShipment(tx: Tx, actor: Actor, shipmentId: string) {
  const preparerId = assertPreparer(actor);
  const shipment = await lockShipment(tx, shipmentId);
  if (shipment.preparerId !== preparerId) throw new ForbiddenError("Cette expédition ne vous est pas attribuée.");
  return shipment;
}

function expect(shipment: OutboundShipment, allowed: ShipmentStatus[], action: string) {
  if (!allowed.includes(shipment.status)) {
    throw new DomainError("INVALID_STATUS", `Action « ${action} » impossible : l'expédition est « ${SHIPMENT_STATUS[shipment.status].label} ».`);
  }
}

async function customerUser(tx: Tx, customerId: string) {
  return (await tx.customerProfile.findUniqueOrThrow({ where: { id: customerId }, select: { userId: true } })).userId;
}

export type ShipmentRequestInput = {
  items: { itemId: string; quantity: number }[];
  recipientName: string;
  recipientCompany?: string | null;
  recipientPhone?: string | null;
  recipientEmail?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  postalCode: string;
  city: string;
  country: string;
  requestedCarrier?: string | null;
  labelMode: LabelMode;
  labelFileId?: string | null;
  instructions?: string | null;
  options?: string[];
  /** Vente (par défaut) ou retour des articles au domicile du client. */
  kind?: Extract<ShipmentKind, "SALE" | "RETURN_TO_CUSTOMER">;
};

/** Échéance d'expédition (« expédié sous 48 h »). */
export async function shipmentDueAt(client: Tx | typeof db, from = new Date()) {
  return addHours(from, (await getSetting("shipping", client)).slaHours);
}

function validateLines(input: Pick<ShipmentRequestInput, "items" | "labelMode" | "labelFileId">) {
  const lines = input.items.filter((l) => l.quantity > 0);
  if (!lines.length) throw new DomainError("NO_ITEMS", "Sélectionnez au moins un article.", { fieldErrors: { items: "Sélection requise" } });
  if (lines.some((l) => !Number.isInteger(l.quantity))) throw new DomainError("QUANTITY", "Quantités invalides.");
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) throw new DomainError("DUPLICATE", "Article sélectionné plusieurs fois.");
  if (input.labelMode === "CUSTOMER_PROVIDED" && !input.labelFileId) {
    throw new DomainError("LABEL_REQUIRED", "Ajoutez votre bordereau ou choisissez l'étiquette fournie par le préparateur.", {
      fieldErrors: { labelFileId: "Bordereau requis" },
    });
  }
  return lines;
}

/** Demande d'expédition par le client (vente ou retour à domicile). */
export async function requestShipment(actor: Actor, input: ShipmentRequestInput) {
  const customerId = assertCustomer(actor);
  validateLines(input);
  return withEffects((tx, fx) => createShipmentTx(tx, fx, { ...input, kind: input.kind ?? "SALE", customerId, actorUserId: actor.userId }));
}

/**
 * Création d'une expédition et réservation des quantités en stock. Utilisée
 * par la demande du client, le dropshipping (à la réception) et les ventes
 * détectées sur les comptes liés.
 */
export async function createShipmentTx(
  tx: Tx,
  fx: Effects,
  input: Omit<ShipmentRequestInput, "kind"> & { kind: ShipmentKind; customerId: string; actorUserId: string | null; system?: boolean },
) {
  const lines = validateLines(input);
  if (input.kind === "RETURN_TO_CUSTOMER" && (input.labelMode !== "CUSTOMER_PROVIDED" || !input.labelFileId)) {
    throw new DomainError("RETURN_LABEL", "Pour un retour à domicile, les frais de port sont à votre charge : joignez votre bordereau prépayé.", {
      fieldErrors: { labelFileId: "Bordereau prépayé requis" },
    });
  }
  const customerId = input.customerId;
  const customer = input.system
    ? await tx.customerProfile.findUniqueOrThrow({ where: { id: customerId }, include: { user: true } })
    : await assertCustomerOperational(tx, customerId);
  const items = await lockItems(tx, lines.map((l) => l.itemId));
  if (items.length !== lines.length) throw new NotFoundError("Article introuvable.");
  const preparerIds = new Set(items.map((i) => i.preparerId));
  for (const item of items) {
    if (item.customerId !== customerId) throw new ForbiddenError();
  }
  if (preparerIds.size > 1) throw new DomainError("MULTI_PREPARER", "Les articles d'une même expédition doivent être stockés chez le même préparateur.");
  const preparerId = items[0].preparerId;
  for (const line of lines) {
    const item = items.find((i) => i.id === line.itemId)!;
    if (item.quantityAvailable < line.quantity) {
      throw new DomainError("STOCK", `Stock insuffisant pour « ${item.name} » (${item.quantityAvailable} disponible(s)).`);
    }
  }
  if (input.labelFileId) {
    const file = await tx.file.findUnique({ where: { id: input.labelFileId } });
    const owned = file && (file.customerId ? file.customerId === customerId : file.uploadedById === input.actorUserId);
    if (!file || !owned || file.shipmentId || file.deletedAt) throw new DomainError("LABEL", "Bordereau invalide.");
  }

  const now = new Date();
  const shipment = await tx.outboundShipment.create({
    data: {
      reference: reference("EXP", 7),
      customerId,
      preparerId,
      status: "REQUESTED",
      kind: input.kind,
      dueAt: await shipmentDueAt(tx, now),
      recipientName: input.recipientName.trim(),
      recipientCompany: input.recipientCompany?.trim() || null,
      recipientPhone: input.recipientPhone?.trim() || null,
      recipientEmail: input.recipientEmail?.trim() || null,
      addressLine1: input.addressLine1.trim(),
      addressLine2: input.addressLine2?.trim() || null,
      postalCode: input.postalCode.trim(),
      city: input.city.trim(),
      country: input.country.trim().toUpperCase() || "FR",
      requestedCarrier: input.requestedCarrier || null,
      labelMode: input.labelMode,
      instructions: input.instructions?.trim() || null,
      options: input.options ?? [],
      items: { create: lines.map((l) => ({ inventoryItemId: l.itemId, quantity: l.quantity })) },
      events: { create: { status: "REQUESTED", actorId: input.actorUserId } },
    },
  });
  for (const line of lines) {
    const item = items.find((i) => i.id === line.itemId)!;
    await applyMovement(tx, item, "RESERVATION", { quantityAvailable: -line.quantity, quantityReserved: line.quantity }, {
      actorId: input.actorUserId,
      shipmentId: shipment.id,
      reason: `Réservé pour ${shipment.reference}`,
    });
  }
  if (input.labelFileId) {
    await tx.file.update({ where: { id: input.labelFileId }, data: { shipmentId: shipment.id, customerId, purpose: "SHIPPING_LABEL" } });
  }
  let updated = await setStatus(tx, shipment, "AWAITING_CLASSIFICATION", null, "Transmise au préparateur");
  if (input.kind === "RETURN_TO_CUSTOMER") updated = await reserveReturnCredits(tx, fx, updated, customer.userId);
  const preparer = await tx.preparerProfile.findUniqueOrThrow({ where: { id: preparerId }, select: { userId: true } });
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const due = format(updated.dueAt!, "EEEE d MMMM 'à' HH'h'mm", { locale: fr });
  const what =
    input.kind === "RETURN_TO_CUSTOMER"
      ? `retour de ${count} article(s) au domicile du client`
      : input.kind === "DROPSHIP"
        ? `dropshipping express : ${count} article(s) pour ${updated.recipientName}`
        : `${count} article(s) pour ${updated.recipientName} (${updated.city})`;
  fx.notify(preparer.userId, {
    type: "SHIPMENT_REQUESTED",
    title: input.kind === "DROPSHIP" ? "Expédition express à préparer" : input.kind === "RETURN_TO_CUSTOMER" ? "Retour d'articles au client" : "Nouvelle demande d'expédition",
    body: `${updated.reference} : ${what}.${input.kind === "RETURN_TO_CUSTOMER" ? "" : " Classification requise,"} À expédier avant ${due}.`,
    link: `/preparateur/expeditions/${updated.id}`,
  });
  fx.notify(customer.userId, {
    type: "SHIPMENT_REQUESTED",
    title: input.kind === "RETURN_TO_CUSTOMER" ? "Demande de retour envoyée" : "Demande d'expédition envoyée",
    body:
      input.kind === "RETURN_TO_CUSTOMER"
        ? `${updated.reference} a été transmise à votre préparateur, qui vous renvoie vos articles avec votre bordereau avant ${due}.`
        : `${updated.reference} a été transmise à votre préparateur, qui va déterminer la taille du colis. Expédition prévue avant ${due}.`,
    link: `/client/expeditions/${updated.id}`,
  });
  return updated;
}

/**
 * Retour à domicile : coût fixe en crédits (paramètre « shipping.returnCredits »,
 * 1 par défaut), réservé dès la demande, sans classification de taille ; les
 * frais de port sont payés par le client (bordereau prépayé). Sans crédits
 * suffisants, le retour attend une recharge et reprend automatiquement.
 */
async function reserveReturnCredits(tx: Tx, fx: Effects, shipment: OutboundShipment, customerUserId: string) {
  const cost = (await getSetting("shipping", tx)).returnCredits;
  let updated = await tx.outboundShipment.update({ where: { id: shipment.id }, data: { creditCost: cost, classificationVersion: 1 } });
  if (cost === 0) {
    updated = await tx.outboundShipment.update({ where: { id: shipment.id }, data: { creditState: "NONE" } });
    return setStatus(tx, updated, "CLASSIFIED", null, "Retour à domicile : aucun crédit requis");
  }
  const res = await reserveCredits(tx, { customerId: shipment.customerId, shipmentId: shipment.id, amount: cost, version: 1, description: `Retour à domicile ${shipment.reference}` });
  if (res.ok) {
    updated = await tx.outboundShipment.update({ where: { id: shipment.id }, data: { creditState: "RESERVED" } });
    return setStatus(tx, updated, "CLASSIFIED", null, `Retour à domicile : ${cost} crédit${cost > 1 ? "s" : ""} réservé${cost > 1 ? "s" : ""}`, { cost });
  }
  updated = await tx.outboundShipment.update({ where: { id: shipment.id }, data: { creditState: "INSUFFICIENT" } });
  updated = await setStatus(tx, updated, "AWAITING_CREDITS", null, `${cost} crédit(s) requis, ${res.available} disponible(s)`, { cost });
  fx.notify(customerUserId, {
    type: "CREDITS_INSUFFICIENT",
    title: "Crédits insuffisants",
    body: `Le retour ${shipment.reference} coûte ${cost} crédit${cost > 1 ? "s" : ""} mais votre solde disponible est de ${res.available}. Rechargez vos crédits : le retour reprendra automatiquement.`,
    link: "/client/credits",
  });
  return updated;
}

export async function getSizeRules(client: Tx | typeof db = db) {
  return client.parcelSizeRule.findMany({ orderBy: { sortOrder: "asc" } });
}

/** Classification par le préparateur + réservation des crédits. */
export async function classifyShipment(
  actor: Actor,
  input: { shipmentId: string; size: ParcelSize; weightGrams?: number | null; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null; note?: string | null },
) {
  return withEffects(async (tx, fx) => {
    const shipment = await preparerShipment(tx, actor, input.shipmentId);
    if (shipment.kind === "RETURN_TO_CUSTOMER") throw new DomainError("RETURN_FIXED", "Un retour à domicile a un coût fixe : aucune classification n'est nécessaire.");
    expect(shipment, ["AWAITING_CLASSIFICATION", "CLASSIFIED", "AWAITING_CREDITS"], "Classifier");
    return classifyInternal(tx, fx, actor, shipment, input);
  });
}

async function classifyInternal(
  tx: Tx,
  fx: Effects,
  actor: Actor,
  shipment: OutboundShipment,
  input: { size: ParcelSize; weightGrams?: number | null; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null; note?: string | null },
) {
  const rule = await tx.parcelSizeRule.findUnique({ where: { size: input.size } });
  if (!rule) throw new DomainError("RULE", "Catégorie de colis non configurée.");
  const exceeds: string[] = [];
  if (rule.maxWeightGrams && input.weightGrams && input.weightGrams > rule.maxWeightGrams) exceeds.push(`poids > ${rule.maxWeightGrams / 1000} kg`);
  const dims = [input.lengthCm, input.widthCm, input.heightCm].filter((d): d is number => !!d).sort((a, b) => b - a);
  const maxDims = [rule.maxLengthCm, rule.maxWidthCm, rule.maxHeightCm].filter((d): d is number => !!d).sort((a, b) => b - a);
  if (dims.length === 3 && maxDims.length === 3 && dims.some((d, i) => d > maxDims[i])) {
    exceeds.push(`dimensions > ${rule.maxLengthCm}×${rule.maxWidthCm}×${rule.maxHeightCm} cm`);
  }
  if (exceeds.length) {
    throw new DomainError("SIZE_EXCEEDED", `Le colis dépasse la catégorie « ${rule.label} » (${exceeds.join(", ")}). Sélectionnez une catégorie supérieure.`);
  }

  const version = shipment.classificationVersion + 1;
  await tx.shipmentClassification.updateMany({ where: { shipmentId: shipment.id, supersededAt: null }, data: { supersededAt: new Date() } });
  await tx.shipmentClassification.create({
    data: {
      shipmentId: shipment.id,
      size: input.size,
      weightGrams: input.weightGrams ?? null,
      lengthCm: input.lengthCm ?? null,
      widthCm: input.widthCm ?? null,
      heightCm: input.heightCm ?? null,
      creditCost: rule.creditCost,
      classifiedById: actor.userId,
      note: input.note?.trim() || null,
    },
  });
  let updated = await tx.outboundShipment.update({
    where: { id: shipment.id },
    data: {
      sizeCategory: input.size,
      weightGrams: input.weightGrams ?? null,
      lengthCm: input.lengthCm ?? null,
      widthCm: input.widthCm ?? null,
      heightCm: input.heightCm ?? null,
      creditCost: rule.creditCost,
      classifiedAt: new Date(),
      classifiedById: actor.userId,
      classificationVersion: version,
    },
  });

  const userId = await customerUser(tx, shipment.customerId);
  const sizeLabel = PARCEL_SIZE[input.size].label;
  if (rule.creditCost === 0) {
    await releaseCredits(tx, { customerId: shipment.customerId, shipmentId: shipment.id, description: `Reclassification ${shipment.reference}` });
    updated = await tx.outboundShipment.update({ where: { id: shipment.id }, data: { creditState: "NONE" } });
    updated = await setStatus(tx, updated, "CLASSIFIED", actor.userId, `${sizeLabel} — aucun crédit requis`);
  } else {
    const res = await reserveCredits(tx, {
      customerId: shipment.customerId,
      shipmentId: shipment.id,
      amount: rule.creditCost,
      version,
      description: `Réservation pour ${shipment.reference} (${sizeLabel})`,
    });
    if (res.ok) {
      updated = await tx.outboundShipment.update({ where: { id: shipment.id }, data: { creditState: "RESERVED" } });
      updated = await setStatus(tx, updated, "CLASSIFIED", actor.userId, `${sizeLabel} — ${rule.creditCost} crédit(s) réservé(s)`, { size: input.size, cost: rule.creditCost });
    } else {
      updated = await tx.outboundShipment.update({ where: { id: shipment.id }, data: { creditState: "INSUFFICIENT" } });
      updated = await setStatus(tx, updated, "AWAITING_CREDITS", null, `${rule.creditCost} crédit(s) requis, ${res.available} disponible(s)`, { size: input.size, cost: rule.creditCost });
      fx.notify(userId, {
        type: "CREDITS_INSUFFICIENT",
        title: "Crédits insuffisants",
        body: `${shipment.reference} nécessite ${rule.creditCost} crédit(s) mais votre solde disponible est de ${res.available}. Rechargez vos crédits : l'expédition reprendra automatiquement.`,
        link: "/client/credits",
      });
    }
  }
  fx.notify(userId, {
    type: "PARCEL_CLASSIFIED",
    title: `Colis classé : ${sizeLabel}`,
    body: `Votre préparateur a classé ${shipment.reference} en « ${sizeLabel} » (${rule.creditCost} crédit${rule.creditCost > 1 ? "s" : ""}). En cas d'erreur, vous pouvez contester la classification.`,
    link: `/client/expeditions/${shipment.id}`,
  });
  return updated;
}

/**
 * Relance les expéditions « En attente de crédits » après une recharge, dans
 * l'ordre chronologique, tant que le solde le permet.
 */
export async function retryAwaitingCredits(customerId: string) {
  const waiting = await db.outboundShipment.findMany({ where: { customerId, status: "AWAITING_CREDITS" }, orderBy: { createdAt: "asc" } });
  let resumed = 0;
  for (const s of waiting) {
    const ok = await withEffects(async (tx, fx) => {
      const shipment = await lockShipment(tx, s.id);
      if (shipment.status !== "AWAITING_CREDITS" || !shipment.creditCost) return true;
      const res = await reserveCredits(tx, {
        customerId,
        shipmentId: shipment.id,
        amount: shipment.creditCost,
        version: shipment.classificationVersion,
        description: `Réservation pour ${shipment.reference} (après recharge)`,
      }).catch(async (err) => {
        if (err instanceof DomainError && err.code === "STALE_RESERVATION") {
          const v = shipment.classificationVersion + 1;
          await tx.outboundShipment.update({ where: { id: shipment.id }, data: { classificationVersion: v } });
          return reserveCredits(tx, { customerId, shipmentId: shipment.id, amount: shipment.creditCost!, version: v, description: `Réservation pour ${shipment.reference} (après recharge)` });
        }
        throw err;
      });
      if (!res.ok) return false;
      // Le délai d'expédition repart à la réservation des crédits.
      const updated = await tx.outboundShipment.update({ where: { id: shipment.id }, data: { creditState: "RESERVED", dueAt: await shipmentDueAt(tx), lateAlertedAt: null } });
      await setStatus(tx, updated, "CLASSIFIED", null, `${shipment.creditCost} crédit(s) réservé(s) après recharge`);
      const prep = await tx.preparerProfile.findUniqueOrThrow({ where: { id: shipment.preparerId }, select: { userId: true } });
      fx.notify(prep.userId, {
        type: "SHIPMENT_UPDATED",
        title: "Expédition débloquée",
        body: `${shipment.reference} : les crédits sont réservés, vous pouvez lancer la préparation.`,
        link: `/preparateur/expeditions/${shipment.id}`,
      });
      fx.notify(await customerUser(tx, customerId), {
        type: "SHIPMENT_UPDATED",
        title: "Expédition relancée",
        body: `${shipment.reference} reprend : ${shipment.creditCost} crédit(s) réservé(s).`,
        link: `/client/expeditions/${shipment.id}`,
      });
      resumed++;
      return true;
    });
    if (!ok) break;
  }
  // Prolongations de stockage en attente de crédits.
  const storage = await retryOverdueStorage(customerId);
  return { resumed, storageCharged: storage.charged };
}

/** Statuts pendant lesquels l'expédition est entre les mains du préparateur. */
const SLA_STATUSES: ShipmentStatus[] = ["REQUESTED", "AWAITING_CLASSIFICATION", "CLASSIFIED", "PREPARING", "READY", "LABEL_READY"];

/**
 * Engagement « expédié sous 48 h » : alerte le préparateur et l'administration
 * pour chaque expédition non déposée à l'échéance (une seule fois).
 * L'attente de crédits suspend le délai (il repart à la réservation).
 */
export async function runShipmentSlaCheck(now = new Date()) {
  const late = await db.outboundShipment.findMany({
    where: { dueAt: { lt: now }, lateAlertedAt: null, status: { in: SLA_STATUSES } },
    include: { preparer: { select: { userId: true, user: { select: { firstName: true, lastName: true } } } }, customer: { select: { referenceCode: true } } },
    take: 200,
  });
  for (const s of late) {
    await withEffects(async (tx, fx) => {
      const res = await tx.outboundShipment.updateMany({ where: { id: s.id, lateAlertedAt: null }, data: { lateAlertedAt: now } });
      if (!res.count) return;
      fx.notify(s.preparer.userId, {
        type: "SHIPMENT_LATE",
        title: "Expédition en retard",
        body: `${s.reference} devait être expédiée avant ${format(s.dueAt!, "d MMMM 'à' HH'h'mm", { locale: fr })}. Déposez-la au plus vite ou signalez un incident.`,
        link: `/preparateur/expeditions/${s.id}`,
      });
      fx.notifyAdmins(
        {
          type: "SHIPMENT_LATE",
          title: "Expédition hors délai (48 h)",
          body: `${s.reference} (${s.customer.referenceCode}) chez ${s.preparer.user.firstName} ${s.preparer.user.lastName} : échéance dépassée, statut « ${SHIPMENT_STATUS[s.status].label} ».`,
          link: `/admin/expeditions?retard=1`,
        },
        "operations.read",
      );
    });
  }
  return { late: late.length };
}

export async function startPreparation(actor: Actor, input: { shipmentId: string }) {
  return withEffects(async (tx, fx) => {
    const shipment = await preparerShipment(tx, actor, input.shipmentId);
    expect(shipment, ["CLASSIFIED"], "Démarrer la préparation");
    if (shipment.creditCost && shipment.creditState !== "RESERVED") throw new DomainError("CREDITS", "Les crédits ne sont pas réservés.");
    const updated = await setStatus(tx, shipment, "PREPARING", actor.userId);
    fx.notify(await customerUser(tx, shipment.customerId), {
      type: "SHIPMENT_UPDATED",
      title: "Préparation en cours",
      body: `Votre préparateur prépare ${shipment.reference}.`,
      link: `/client/expeditions/${shipment.id}`,
      dedupeKey: `shipment:${shipment.id}`,
    });
    return updated;
  });
}

export async function markReady(actor: Actor, input: { shipmentId: string; photoIds?: string[]; note?: string | null }) {
  return withEffects(async (tx) => {
    const shipment = await preparerShipment(tx, actor, input.shipmentId);
    expect(shipment, ["PREPARING"], "Colis prêt");
    if (input.photoIds?.length) {
      await linkPhotos(tx, actor, input.photoIds, { shipmentId: shipment.id, customerId: shipment.customerId });
      await tx.file.updateMany({ where: { id: { in: input.photoIds } }, data: { purpose: "PREPARATION_PHOTO" } });
    }
    return setStatus(tx, shipment, "READY", actor.userId, input.note);
  });
}

export async function confirmLabel(actor: Actor, input: { shipmentId: string; labelFileId?: string | null; note?: string | null }) {
  return withEffects(async (tx) => {
    const shipment = await preparerShipment(tx, actor, input.shipmentId);
    expect(shipment, ["READY"], "Étiquette");
    if (input.labelFileId) {
      await linkPhotos(tx, actor, [input.labelFileId], { shipmentId: shipment.id, customerId: shipment.customerId });
      await tx.file.update({ where: { id: input.labelFileId }, data: { purpose: "SHIPPING_LABEL" } });
    } else {
      const existing = await tx.file.count({ where: { shipmentId: shipment.id, purpose: "SHIPPING_LABEL", deletedAt: null } });
      if (!existing) throw new DomainError("LABEL_REQUIRED", "Ajoutez l'étiquette d'expédition.");
    }
    return setStatus(tx, shipment, "LABEL_READY", actor.userId, input.note ?? (input.labelFileId ? "Étiquette créée par le préparateur" : "Étiquette fournie par le client"));
  });
}

/**
 * Dépôt au transporteur : débit définitif des crédits et sortie de stock.
 * Rejouable sans effet (double clic, requête répétée).
 */
export async function confirmDropOff(
  actor: Actor,
  input: { shipmentId: string; carrier: string; trackingNumber: string; shippingFeeCents?: number | null; shippingFeeNote?: string | null },
) {
  if (!input.carrier) throw new DomainError("CARRIER", "Indiquez le transporteur.", { fieldErrors: { carrier: "Requis" } });
  if (input.trackingNumber.trim().length < 4) throw new DomainError("TRACKING", "Numéro de suivi invalide.", { fieldErrors: { trackingNumber: "Requis" } });
  return withEffects(async (tx, fx) => {
    const shipment = await preparerShipment(tx, actor, input.shipmentId);
    if (["DROPPED_OFF", "IN_TRANSIT", "DELIVERED"].includes(shipment.status)) {
      return { shipment, alreadyConfirmed: true };
    }
    expect(shipment, ["LABEL_READY"], "Confirmer le dépôt");

    let debited = 0;
    if (shipment.creditCost && shipment.creditCost > 0) {
      const res = await captureCredits(tx, {
        customerId: shipment.customerId,
        shipmentId: shipment.id,
        description: `Débit définitif ${shipment.reference} (${shipment.sizeCategory ? PARCEL_SIZE[shipment.sizeCategory].label : "colis"})`,
      });
      debited = res.amount;
    }
    const items = await lockItems(tx, shipment.items.map((i) => i.inventoryItemId));
    for (const line of shipment.items) {
      const item = items.find((i) => i.id === line.inventoryItemId)!;
      await applyMovement(tx, item, "SHIPMENT", { quantityReserved: -line.quantity, quantityShipped: line.quantity }, {
        actorId: actor.userId,
        shipmentId: shipment.id,
        reason: `Expédié — ${shipment.reference}`,
      });
    }
    const tracking = input.trackingNumber.trim();
    let updated = await tx.outboundShipment.update({
      where: { id: shipment.id },
      data: {
        carrier: input.carrier,
        trackingNumber: tracking,
        trackingUrl: trackingUrl(input.carrier, tracking),
        shippingFeeCents: input.shippingFeeCents ?? null,
        shippingFeeNote: input.shippingFeeNote?.trim() || null,
        droppedOffAt: new Date(),
        creditState: shipment.creditCost ? "CAPTURED" : shipment.creditState,
      },
    });
    updated = await setStatus(tx, updated, "DROPPED_OFF", actor.userId, `${carrierLabel(input.carrier)} — ${tracking}`, { debited });
    await tx.preparerProfile.update({ where: { id: shipment.preparerId }, data: { parcelsProcessed: { increment: 1 } } });
    fx.notify(await customerUser(tx, shipment.customerId), {
      type: "SHIPMENT_SHIPPED",
      title: "Colis expédié",
      body: `${shipment.reference} a été déposé chez ${carrierLabel(input.carrier)}. Numéro de suivi : ${tracking}.${debited ? ` ${debited} crédit(s) débité(s).` : ""}`,
      link: `/client/expeditions/${shipment.id}`,
    });
    return { shipment: updated, alreadyConfirmed: false };
  });
}

export async function updateTransit(actor: Actor, input: { shipmentId: string; status: "IN_TRANSIT" | "DELIVERED"; note?: string | null }) {
  return withEffects(async (tx, fx) => {
    const shipment = await lockShipment(tx, input.shipmentId);
    const allowed = (actor.role === "PREPARER" && shipment.preparerId === actor.preparerId) || (actor.role === "ADMIN" && can(actor, "operations.manage"));
    if (!allowed) throw new ForbiddenError();
    expect(shipment, input.status === "IN_TRANSIT" ? ["DROPPED_OFF"] : ["DROPPED_OFF", "IN_TRANSIT", "INCIDENT"], SHIPMENT_STATUS[input.status].label);
    let updated = shipment as OutboundShipment;
    if (input.status === "DELIVERED") updated = await tx.outboundShipment.update({ where: { id: shipment.id }, data: { deliveredAt: new Date() } });
    updated = await setStatus(tx, updated, input.status, actor.userId, input.note);
    fx.notify(await customerUser(tx, shipment.customerId), {
      type: "SHIPMENT_UPDATED",
      title: input.status === "DELIVERED" ? "Colis livré" : "Colis en transit",
      body: `${shipment.reference} : ${SHIPMENT_STATUS[input.status].label}.`,
      link: `/client/expeditions/${shipment.id}`,
    });
    return updated;
  });
}

/** Annulation : libère les crédits réservés et le stock réservé. */
export async function cancelShipment(actor: Actor, input: { shipmentId: string; reason: string }) {
  return withEffects(async (tx, fx) => {
    const shipment = await lockShipment(tx, input.shipmentId);
    if (actor.role === "CUSTOMER") {
      if (shipment.customerId !== actor.customerId) throw new ForbiddenError();
      expect(shipment, SHIPMENT_CANCELLABLE_BY_CUSTOMER, "Annuler");
    } else if (actor.role === "ADMIN") {
      assertAdmin(actor, "operations.manage");
      expect(shipment, [...SHIPMENT_CANCELLABLE_BY_CUSTOMER, "PREPARING", "READY", "LABEL_READY"], "Annuler");
    } else {
      throw new ForbiddenError("Contactez le client ou l'administration pour annuler une expédition.");
    }
    const { released } = await releaseCredits(tx, {
      customerId: shipment.customerId,
      shipmentId: shipment.id,
      description: `Annulation de ${shipment.reference}`,
    });
    const items = await lockItems(tx, shipment.items.map((i) => i.inventoryItemId));
    for (const line of shipment.items) {
      const item = items.find((i) => i.id === line.inventoryItemId)!;
      await applyMovement(tx, item, "RESERVATION_RELEASE", { quantityAvailable: line.quantity, quantityReserved: -line.quantity }, {
        actorId: actor.userId,
        shipmentId: shipment.id,
        reason: `Annulation ${shipment.reference}`,
      });
    }
    let updated = await tx.outboundShipment.update({
      where: { id: shipment.id },
      data: { cancelledAt: new Date(), cancelReason: input.reason.trim() || null, creditState: released ? "RELEASED" : shipment.creditState === "INSUFFICIENT" ? "NONE" : shipment.creditState },
    });
    updated = await setStatus(tx, updated, "CANCELLED", actor.userId, input.reason, { releasedCredits: released });
    await audit({ actor, action: "shipment.cancelled", entityType: "shipment", entityId: shipment.id, summary: input.reason, metadata: { releasedCredits: released } }, tx);
    const prep = await tx.preparerProfile.findUniqueOrThrow({ where: { id: shipment.preparerId }, select: { userId: true } });
    fx.notify(prep.userId, { type: "SHIPMENT_UPDATED", title: "Expédition annulée", body: `${shipment.reference} a été annulée.`, link: `/preparateur/expeditions/${shipment.id}` });
    if (actor.role === "ADMIN") {
      fx.notify(await customerUser(tx, shipment.customerId), {
        type: "SHIPMENT_UPDATED",
        title: "Expédition annulée",
        body: `${shipment.reference} a été annulée par l'équipe Packio${released ? ` ; ${released} crédit(s) libéré(s)` : ""}.`,
        link: `/client/expeditions/${shipment.id}`,
      });
    }
    return { shipment: updated, releasedCredits: released };
  });
}

/** Contestation de classification par le client → incident traité par l'admin. */
export async function disputeClassification(actor: Actor, input: { shipmentId: string; reason: string }) {
  const customerId = assertCustomer(actor);
  if (input.reason.trim().length < 10) throw new DomainError("REASON", "Expliquez votre contestation (10 caractères minimum).");
  return withEffects(async (tx, fx) => {
    const shipment = await lockShipment(tx, input.shipmentId);
    if (shipment.customerId !== customerId) throw new ForbiddenError();
    if (shipment.kind === "RETURN_TO_CUSTOMER") throw new DomainError("RETURN_FIXED", "Un retour à domicile a un coût fixe : il n'y a pas de classification à contester.");
    if (!shipment.sizeCategory) throw new DomainError("NOT_CLASSIFIED", "Ce colis n'a pas encore été classé.");
    const open = await tx.incident.findFirst({ where: { shipmentId: shipment.id, type: "CLASSIFICATION_DISPUTE", status: { in: ["OPEN", "IN_PROGRESS"] } } });
    if (open) throw new DomainError("ALREADY_DISPUTED", "Une contestation est déjà en cours pour ce colis.");
    return createIncidentTx(tx, fx, actor, {
      type: "CLASSIFICATION_DISPUTE",
      title: `Contestation ${shipment.reference} (${PARCEL_SIZE[shipment.sizeCategory].label})`,
      description: input.reason,
      customerId,
      preparerId: shipment.preparerId,
      shipmentId: shipment.id,
      priority: "NORMAL",
    });
  });
}

/**
 * Correction de classification par l'administration (suite à contestation).
 * Avant débit : reclassification normale. Après débit : seule une correction
 * à la baisse est possible, la différence est recréditée.
 */
export async function adminReclassify(actor: Actor, input: { shipmentId: string; size: ParcelSize; reason: string }) {
  assertAdmin(actor, "operations.manage");
  if (input.reason.trim().length < 5) throw new DomainError("REASON", "Justification obligatoire.");
  return withEffects(async (tx, fx) => {
    const shipment = await lockShipment(tx, input.shipmentId);
    if (shipment.kind === "RETURN_TO_CUSTOMER") throw new DomainError("RETURN_FIXED", "Un retour à domicile a un coût fixe : il ne se reclasse pas.");
    const rule = await tx.parcelSizeRule.findUniqueOrThrow({ where: { size: input.size } });
    if (["AWAITING_CLASSIFICATION", "CLASSIFIED", "AWAITING_CREDITS"].includes(shipment.status)) {
      const updated = await classifyInternal(tx, fx, actor, shipment, { size: input.size, note: `Correction administrateur : ${input.reason}` });
      await audit({ actor, action: "shipment.reclassified", entityType: "shipment", entityId: shipment.id, summary: input.reason }, tx);
      return updated;
    }
    if (shipment.creditState !== "CAPTURED" || !shipment.creditCost) {
      throw new DomainError("INVALID_STATUS", "Correction impossible à ce stade de l'expédition.");
    }
    const diff = shipment.creditCost - rule.creditCost;
    if (diff < 0) throw new DomainError("UPWARD", "Après débit, seule une correction à la baisse est possible.");
    await tx.shipmentClassification.updateMany({ where: { shipmentId: shipment.id, supersededAt: null }, data: { supersededAt: new Date() } });
    await tx.shipmentClassification.create({
      data: { shipmentId: shipment.id, size: input.size, creditCost: rule.creditCost, classifiedById: actor.userId, note: `Correction administrateur : ${input.reason}` },
    });
    const updated = await tx.outboundShipment.update({ where: { id: shipment.id }, data: { sizeCategory: input.size, creditCost: rule.creditCost } });
    if (diff > 0) {
      await grantCredits(tx, {
        customerId: shipment.customerId,
        bucket: "PURCHASED",
        amount: diff,
        source: "ADMIN",
        sourceRef: shipment.id,
        expiresAt: await purchasedCreditsExpiry(tx),
        type: "ADMIN_CREDIT",
        description: `Correction de classification ${shipment.reference} (+${diff})`,
        reason: input.reason.trim(),
        actorId: actor.userId,
        idempotencyKey: `reclassify:${shipment.id}:${input.size}`,
      });
    }
    await tx.shipmentEvent.create({ data: { shipmentId: shipment.id, status: shipment.status, actorId: actor.userId, note: `Classification corrigée : ${PARCEL_SIZE[input.size].label} (${input.reason})` } });
    await audit({ actor, action: "shipment.reclassified_after_capture", entityType: "shipment", entityId: shipment.id, summary: input.reason, metadata: { refunded: diff } }, tx);
    fx.notify(await customerUser(tx, shipment.customerId), {
      type: "PARCEL_CLASSIFIED",
      title: "Classification corrigée",
      body: `${shipment.reference} est reclassé en « ${PARCEL_SIZE[input.size].label} »${diff > 0 ? ` : ${diff} crédit(s) vous ont été restitué(s)` : ""}.`,
      link: `/client/expeditions/${shipment.id}`,
    });
    return updated;
  });
}

export async function reportShipmentIncident(actor: Actor, input: { shipmentId: string; type: IncidentType; description: string; photoIds?: string[] }) {
  return withEffects(async (tx, fx) => {
    const shipment = await lockShipment(tx, input.shipmentId);
    const allowed =
      (actor.role === "PREPARER" && shipment.preparerId === actor.preparerId) ||
      (actor.role === "CUSTOMER" && shipment.customerId === actor.customerId) ||
      (actor.role === "ADMIN" && can(actor, "operations.manage"));
    if (!allowed) throw new ForbiddenError();
    const incident = await createIncidentTx(tx, fx, actor, {
      type: input.type,
      title: `${shipment.reference} — ${SHIPMENT_STATUS[shipment.status].label}`,
      description: input.description,
      customerId: shipment.customerId,
      preparerId: shipment.preparerId,
      shipmentId: shipment.id,
      priority: "HIGH",
    });
    if (input.photoIds?.length) await linkPhotos(tx, actor, input.photoIds, { incidentId: incident.id, customerId: shipment.customerId });
    if (["DROPPED_OFF", "IN_TRANSIT"].includes(shipment.status)) {
      await setStatus(tx, shipment, "INCIDENT", actor.userId, input.description);
    }
    return incident;
  });
}

export async function getShipmentForActor(actor: Actor, shipmentId: string) {
  const shipment = await db.outboundShipment.findUnique({
    where: { id: shipmentId },
    include: {
      items: { include: { inventoryItem: { select: { id: true, sku: true, name: true, storageLocation: true, files: { where: { purpose: "PRODUCT_PHOTO", deletedAt: null }, select: { id: true }, take: 1 } } } } },
      events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { firstName: true, lastName: true, role: true } } } },
      classifications: { orderBy: { createdAt: "desc" }, include: { classifiedBy: { select: { firstName: true, lastName: true, role: true } } } },
      files: { where: { deletedAt: null }, select: { id: true, filename: true, mimeType: true, purpose: true, createdAt: true } },
      incidents: { select: { id: true, reference: true, type: true, status: true } },
      customer: { include: { user: { select: { firstName: true, lastName: true, email: true } } } },
      preparer: { include: { user: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (!shipment) throw new NotFoundError("Expédition introuvable.");
  const allowed =
    (actor.role === "CUSTOMER" && shipment.customerId === actor.customerId) ||
    (actor.role === "PREPARER" && shipment.preparerId === actor.preparerId) ||
    (actor.role === "ADMIN" && can(actor, "operations.read"));
  if (!allowed) throw new ForbiddenError();
  return shipment;
}

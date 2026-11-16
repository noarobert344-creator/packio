import type { LocationType, PreparerStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { assertAdmin, assertPreparer, type Actor } from "@/server/auth/actor";
import { audit } from "./audit";
import { normalizeEmail, sendInvitation } from "./auth";
import { withEffects } from "./notifications";

export type WeeklyAvailability = Record<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun", { open: boolean; from: string; to: string }>;

export const DEFAULT_AVAILABILITY: WeeklyAvailability = {
  mon: { open: true, from: "09:00", to: "18:00" },
  tue: { open: true, from: "09:00", to: "18:00" },
  wed: { open: true, from: "09:00", to: "18:00" },
  thu: { open: true, from: "09:00", to: "18:00" },
  fri: { open: true, from: "09:00", to: "18:00" },
  sat: { open: false, from: "10:00", to: "13:00" },
  sun: { open: false, from: "10:00", to: "13:00" },
};

export type PreparerInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  city: string;
  country: string;
  businessAddressLine1?: string | null;
  businessAddressLine2?: string | null;
  businessPostalCode?: string | null;
  businessCity?: string | null;
  businessCountry?: string | null;
  compatibleCarriers: string[];
  storageCapacity: number;
  maxClients: number;
  availabilityNote?: string | null;
  adminNotes?: string | null;
  status?: PreparerStatus;
};

export async function createPreparer(actor: Actor, input: PreparerInput) {
  assertAdmin(actor, "preparers.manage");
  const email = normalizeEmail(input.email);
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new DomainError("EMAIL_TAKEN", "Un compte existe déjà avec cette adresse e-mail.", { fieldErrors: { email: "Adresse déjà utilisée" } });
  }
  const user = await db.user.create({
    data: {
      email,
      role: "PREPARER",
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phone: input.phone?.trim() || null,
      preparerProfile: {
        create: {
          city: input.city.trim(),
          country: input.country.trim().toUpperCase() || "FR",
          businessAddressLine1: input.businessAddressLine1?.trim() || null,
          businessAddressLine2: input.businessAddressLine2?.trim() || null,
          businessPostalCode: input.businessPostalCode?.trim() || null,
          businessCity: input.businessCity?.trim() || null,
          businessCountry: input.businessCountry?.trim().toUpperCase() || "FR",
          compatibleCarriers: input.compatibleCarriers,
          storageCapacity: input.storageCapacity,
          maxClients: input.maxClients,
          availability: DEFAULT_AVAILABILITY,
          availabilityNote: input.availabilityNote?.trim() || null,
          adminNotes: input.adminNotes?.trim() || null,
          status: input.status ?? "ACTIVE",
        },
      },
    },
    include: { preparerProfile: true },
  });
  await audit({ actor, action: "preparer.created", entityType: "preparer", entityId: user.preparerProfile!.id, summary: `${user.firstName} ${user.lastName}` });
  const { url } = await sendInvitation(user.id);
  return { preparer: user.preparerProfile!, invitationUrl: url };
}

export async function updatePreparer(actor: Actor, preparerId: string, input: PreparerInput) {
  assertAdmin(actor, "preparers.manage");
  const preparer = await db.preparerProfile.findUnique({ where: { id: preparerId }, include: { user: true } });
  if (!preparer) throw new NotFoundError("Préparateur introuvable.");
  const email = normalizeEmail(input.email);
  if (email !== preparer.user.email && (await db.user.findUnique({ where: { email }, select: { id: true } }))) {
    throw new DomainError("EMAIL_TAKEN", "Adresse déjà utilisée.", { fieldErrors: { email: "Adresse déjà utilisée" } });
  }
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: preparer.userId },
      data: { email, firstName: input.firstName.trim(), lastName: input.lastName.trim(), phone: input.phone?.trim() || null },
    });
    await tx.preparerProfile.update({
      where: { id: preparerId },
      data: {
        city: input.city.trim(),
        country: input.country.trim().toUpperCase() || "FR",
        businessAddressLine1: input.businessAddressLine1?.trim() || null,
        businessAddressLine2: input.businessAddressLine2?.trim() || null,
        businessPostalCode: input.businessPostalCode?.trim() || null,
        businessCity: input.businessCity?.trim() || null,
        businessCountry: input.businessCountry?.trim().toUpperCase() || "FR",
        compatibleCarriers: input.compatibleCarriers,
        storageCapacity: input.storageCapacity,
        maxClients: input.maxClients,
        availabilityNote: input.availabilityNote?.trim() || null,
        adminNotes: input.adminNotes?.trim() || null,
      },
    });
    await audit({ actor, action: "preparer.updated", entityType: "preparer", entityId: preparerId }, tx);
  });
}

/** Changement de statut ; la suspension peut lancer la réattribution de ses clients. */
export async function setPreparerStatus(actor: Actor, input: { preparerId: string; status: PreparerStatus; reason: string; startReassignment?: boolean; deactivateAccount?: boolean }) {
  assertAdmin(actor, "preparers.manage");
  const preparer = await db.preparerProfile.findUnique({ where: { id: input.preparerId }, include: { user: true } });
  if (!preparer) throw new NotFoundError("Préparateur introuvable.");
  return withEffects(async (tx, fx) => {
    await tx.preparerProfile.update({ where: { id: preparer.id }, data: { status: input.status } });
    if (input.deactivateAccount !== undefined) {
      await tx.user.update({ where: { id: preparer.userId }, data: { status: input.deactivateAccount ? "SUSPENDED" : "ACTIVE" } });
      if (input.deactivateAccount) await tx.session.deleteMany({ where: { userId: preparer.userId } });
    }
    let reassigning = 0;
    if (input.startReassignment && input.status !== "ACTIVE") {
      const customers = await tx.customerProfile.findMany({ where: { currentPreparerId: preparer.id } });
      const now = new Date();
      for (const c of customers) {
        await tx.customerProfile.update({
          where: { id: c.id },
          data: { assignmentState: "REASSIGNING", assignmentRequestedAt: now, assignmentDueAt: new Date(now.getTime() + 24 * 3600 * 1000), assignmentAdminAlertedAt: null },
        });
        reassigning++;
      }
      if (reassigning) {
        fx.notifyAdmins(
          {
            type: "ADMIN_ASSIGNMENT_REQUEST",
            title: "Réattributions à traiter",
            body: `${reassigning} client(s) de ${preparer.user.firstName} ${preparer.user.lastName} doivent être réattribués.`,
            link: "/admin/attributions",
          },
          "assignments.manage",
        );
      }
    }
    await audit(
      { actor, action: "preparer.status", entityType: "preparer", entityId: preparer.id, summary: `${input.status} — ${input.reason}`, metadata: { reassigning, deactivated: input.deactivateAccount ?? null } },
      tx,
    );
    return { reassigning };
  });
}

export type LocationInput = {
  type: LocationType;
  label: string;
  network?: string | null;
  relayName?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  postalCode: string;
  city: string;
  country: string;
  externalId?: string | null;
  recipientName: string;
  /** Téléphone à indiquer sur les commandes (Vinted l'exige ; le code de retrait arrive par SMS). */
  recipientPhone?: string | null;
  openingHours?: string | null;
  instructions?: string | null;
  isPrimary: boolean;
};

/**
 * Création / modification d'un lieu de réception. Un lieu modifié perd sa
 * validation : il doit être revalidé par un administrateur avant d'être
 * communiqué aux clients.
 */
export async function saveLocation(actor: Actor, input: LocationInput & { preparerId: string; locationId?: string; validate?: boolean }) {
  const isAdmin = actor.role === "ADMIN";
  if (isAdmin) assertAdmin(actor, "preparers.manage");
  else if (assertPreparer(actor) !== input.preparerId) throw new ForbiddenError();
  if ((input.type === "LOCKER" || input.type === "RELAY_POINT") && (!input.network || !input.relayName)) {
    throw new DomainError("RELAY", "Indiquez le réseau et le nom exact du locker / point relais.", { fieldErrors: { relayName: "Requis", network: "Requis" } });
  }
  return db.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.preparerLocation.updateMany({ where: { preparerId: input.preparerId, isPrimary: true, NOT: input.locationId ? { id: input.locationId } : undefined }, data: { isPrimary: false } });
    }
    const data = {
      type: input.type,
      label: input.label.trim(),
      network: input.type === "BUSINESS_ADDRESS" ? null : input.network || null,
      relayName: input.relayName?.trim() || null,
      addressLine1: input.addressLine1.trim(),
      addressLine2: input.addressLine2?.trim() || null,
      postalCode: input.postalCode.trim(),
      city: input.city.trim(),
      country: input.country.trim().toUpperCase() || "FR",
      externalId: input.externalId?.trim() || null,
      recipientName: input.recipientName.trim(),
      recipientPhone: input.recipientPhone?.trim() || null,
      openingHours: input.openingHours?.trim() || null,
      instructions: input.instructions?.trim() || null,
      isPrimary: input.isPrimary,
      isActive: true,
      validatedAt: isAdmin && input.validate ? new Date() : null,
      validatedById: isAdmin && input.validate ? actor.userId : null,
    };
    let location;
    if (input.locationId) {
      const existing = await tx.preparerLocation.findUnique({ where: { id: input.locationId } });
      if (!existing || existing.preparerId !== input.preparerId) throw new NotFoundError("Lieu introuvable.");
      location = await tx.preparerLocation.update({ where: { id: input.locationId }, data });
    } else {
      location = await tx.preparerLocation.create({ data: { ...data, preparerId: input.preparerId } });
    }
    await audit({ actor, action: input.locationId ? "location.updated" : "location.created", entityType: "preparer_location", entityId: location.id, summary: `${location.label}${data.validatedAt ? " (validé)" : " (à valider)"}` }, tx);
    return location;
  });
}

export async function setLocationValidation(actor: Actor, input: { locationId: string; validated: boolean }) {
  assertAdmin(actor, "preparers.manage");
  const loc = await db.preparerLocation.update({
    where: { id: input.locationId },
    data: input.validated ? { validatedAt: new Date(), validatedById: actor.userId } : { validatedAt: null, validatedById: null },
  });
  await audit({ actor, action: input.validated ? "location.validated" : "location.unvalidated", entityType: "preparer_location", entityId: loc.id, summary: loc.label });
  return loc;
}

export async function deactivateLocation(actor: Actor, locationId: string) {
  const loc = await db.preparerLocation.findUnique({ where: { id: locationId } });
  if (!loc) throw new NotFoundError();
  if (actor.role === "ADMIN") assertAdmin(actor, "preparers.manage");
  else if (assertPreparer(actor) !== loc.preparerId) throw new ForbiddenError();
  const pending = await db.supplierOrder.count({ where: { locationId, status: { in: ["REGISTERED", "SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER"] } } });
  await db.preparerLocation.update({ where: { id: locationId }, data: { isActive: false, isPrimary: false } });
  await audit({ actor, action: "location.deactivated", entityType: "preparer_location", entityId: locationId, summary: `${pending} commande(s) encore en route` });
  return { pendingOrders: pending };
}

export async function updateAvailability(actor: Actor, input: { availability: WeeklyAvailability; note?: string | null }) {
  const preparerId = assertPreparer(actor);
  await db.preparerProfile.update({ where: { id: preparerId }, data: { availability: input.availability, availabilityNote: input.note?.trim() || null } });
}

/** Déclaration d'absence : l'administration et les clients attribués sont prévenus. */
export async function declareAbsence(actor: Actor, input: { preparerId?: string; startsAt: Date; endsAt: Date; reason?: string | null }) {
  const preparerId = actor.role === "ADMIN" ? input.preparerId! : assertPreparer(actor);
  if (actor.role === "ADMIN") assertAdmin(actor, "preparers.manage");
  if (!(input.endsAt > input.startsAt)) throw new DomainError("DATES", "La date de fin doit suivre la date de début.");
  return withEffects(async (tx, fx) => {
    const preparer = await tx.preparerProfile.findUniqueOrThrow({ where: { id: preparerId }, include: { user: true, currentCustomers: { select: { userId: true } } } });
    const absence = await tx.preparerAbsence.create({
      data: { preparerId, startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason?.trim() || null, createdById: actor.userId },
    });
    const period = `du ${input.startsAt.toLocaleDateString("fr-FR")} au ${input.endsAt.toLocaleDateString("fr-FR")}`;
    await audit({ actor, action: "preparer.absence", entityType: "preparer", entityId: preparerId, summary: period }, tx);
    fx.notifyAdmins(
      {
        type: "PREPARER_ABSENCE",
        title: "Absence de préparateur",
        body: `${preparer.user.firstName} ${preparer.user.lastName} sera absent(e) ${period}${input.reason ? ` (${input.reason})` : ""}.`,
        link: `/admin/preparateurs/${preparerId}`,
      },
      "preparers.read",
    );
    for (const c of preparer.currentCustomers) {
      fx.notify(c.userId, {
        type: "PREPARER_ABSENCE",
        title: "Absence de votre préparateur",
        body: `Votre préparateur sera absent ${period}. Les colis arrivant pendant cette période seront traités à son retour.`,
        link: "/client/preparateur",
      });
    }
    return absence;
  });
}

export async function cancelAbsence(actor: Actor, absenceId: string) {
  const absence = await db.preparerAbsence.findUnique({ where: { id: absenceId } });
  if (!absence) throw new NotFoundError();
  if (actor.role === "ADMIN") assertAdmin(actor, "preparers.manage");
  else if (assertPreparer(actor) !== absence.preparerId) throw new ForbiddenError();
  await db.preparerAbsence.update({ where: { id: absenceId }, data: { cancelledAt: new Date() } });
}

export async function getPreparerStats(preparerId: string) {
  const since = new Date(Date.now() - 30 * 86400000);
  const [clients, received, shipped30, shipmentsByStatus, incidents, stock] = await Promise.all([
    db.preparerAssignment.count({ where: { preparerId, status: "ACTIVE" } }),
    db.supplierOrder.count({ where: { preparerId, status: "IN_STOCK" } }),
    db.outboundShipment.count({ where: { preparerId, droppedOffAt: { gte: since } } }),
    db.outboundShipment.groupBy({ by: ["status"], where: { preparerId }, _count: true }),
    db.incident.count({ where: { preparerId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.inventoryItem.aggregate({ where: { preparerId }, _sum: { quantityAvailable: true, quantityReserved: true } }),
  ]);
  return {
    clients,
    receivedOrders: received,
    shippedLast30Days: shipped30,
    shipmentsByStatus: Object.fromEntries(shipmentsByStatus.map((s) => [s.status, s._count])),
    openIncidents: incidents,
    storedUnits: (stock._sum.quantityAvailable ?? 0) + (stock._sum.quantityReserved ?? 0),
  };
}

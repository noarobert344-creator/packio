import { db, type Tx } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";
import { assertCustomer, type Actor } from "@/server/auth/actor";
import { audit } from "./audit";

/** Souscription principale active (ou en impayé) du client. */
export async function getActiveSubscription(
  customerId: string,
  client: Tx | typeof db = db,
) {
  return client.subscription.findFirst({
    where: { customerId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    // Souscription principale : celle qui n'a pas été remplacée par un changement d'offre.
    orderBy: [
      { supersededAt: { sort: "asc", nulls: "first" } },
      { createdAt: "desc" },
    ],
    include: { plan: true, pendingPlan: true },
  });
}

/**
 * Vérifie qu'un client peut lancer de nouvelles opérations logistiques :
 * abonnement actif, à jour de paiement, préparateur attribué.
 */
export async function assertCustomerOperational(
  client: Tx | typeof db,
  customerId: string,
  opts?: { requirePreparer?: boolean },
) {
  const customer = await client.customerProfile.findUnique({
    where: { id: customerId },
  });
  if (!customer) throw new NotFoundError("Client introuvable.");
  if (customer.status === "PAST_DUE") {
    throw new DomainError(
      "PAST_DUE",
      "Votre dernier paiement a échoué. Mettez à jour votre moyen de paiement pour continuer.",
    );
  }
  if (customer.status !== "ACTIVE") {
    throw new DomainError("INACTIVE", "Votre abonnement n'est pas actif.");
  }
  if (opts?.requirePreparer !== false && !customer.currentPreparerId) {
    throw new DomainError(
      "NO_PREPARER",
      "Votre préparateur n'est pas encore attribué.",
    );
  }
  return customer;
}

export type ReturnAddressInput = {
  returnName: string;
  returnPhone?: string | null;
  returnAddressLine1: string;
  returnAddressLine2?: string | null;
  returnPostalCode: string;
  returnCity: string;
  returnCountry: string;
};

/** Adresse de retour à domicile du client (pré-remplie dans les demandes de retour). */
export async function updateReturnAddress(
  customerId: string,
  input: ReturnAddressInput,
) {
  return db.customerProfile.update({
    where: { id: customerId },
    data: {
      returnName: input.returnName.trim(),
      returnPhone: input.returnPhone?.trim() || null,
      returnAddressLine1: input.returnAddressLine1.trim(),
      returnAddressLine2: input.returnAddressLine2?.trim() || null,
      returnPostalCode: input.returnPostalCode.trim(),
      returnCity: input.returnCity.trim(),
      returnCountry: input.returnCountry.trim().toUpperCase() || "FR",
    },
  });
}

// ----------------------------------------------------------------------------- Informations du client

/**
 * L'inscription ne demande que l'e-mail et le mot de passe. Nom, téléphone et
 * adresse sont demandés juste après le paiement : tant qu'ils manquent,
 * l'espace client affiche un formulaire imposé à la place des pages.
 */
export function missingCustomerDetails(
  user: { lastName: string; phone: string | null },
  profile: {
    returnAddressLine1: string | null;
    returnPostalCode: string | null;
    returnCity: string | null;
  },
) {
  return (
    !user.lastName.trim() ||
    !user.phone?.trim() ||
    !profile.returnAddressLine1?.trim() ||
    !profile.returnPostalCode?.trim() ||
    !profile.returnCity?.trim()
  );
}

export type CustomerDetailsDefaults = {
  firstName: string;
  lastName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  country: string;
};

/**
 * Formulaire imposé ? Oui pour un client qui a payé (ou reçu un abonnement
 * offert) et dont les informations sont incomplètes. Renvoie alors les valeurs
 * déjà connues pour pré-remplir le formulaire ; sinon null.
 * Les comptes internes (administrateur avec un espace client) ne sont pas concernés.
 */
export async function customerDetailsGate(
  customerId: string,
): Promise<CustomerDetailsDefaults | null> {
  const c = await db.customerProfile.findUnique({
    where: { id: customerId },
    select: {
      status: true,
      returnAddressLine1: true,
      returnAddressLine2: true,
      returnPostalCode: true,
      returnCity: true,
      returnCountry: true,
      user: {
        select: { role: true, firstName: true, lastName: true, phone: true },
      },
    },
  });
  if (!c || c.status === "PENDING_PAYMENT" || c.user.role !== "CUSTOMER")
    return null;
  if (!missingCustomerDetails(c.user, c)) return null;
  const named = !!c.user.lastName.trim();
  return {
    // Sans nom de famille, le prénom est provisoire (début de l'e-mail) : non repris.
    firstName: named ? c.user.firstName : "",
    lastName: c.user.lastName,
    phone: c.user.phone ?? "",
    addressLine1: c.returnAddressLine1 ?? "",
    addressLine2: c.returnAddressLine2 ?? "",
    postalCode: c.returnPostalCode ?? "",
    city: c.returnCity ?? "",
    country: c.returnCountry ?? "FR",
  };
}

export type CustomerDetailsInput = {
  firstName: string;
  lastName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | null;
  postalCode: string;
  city: string;
  country: string;
};

/** Enregistre le nom, le téléphone et l'adresse du client (formulaire après paiement). */
export async function completeCustomerDetails(
  actor: Actor,
  input: CustomerDetailsInput,
) {
  const customerId = assertCustomer(actor);
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const phone = input.phone.trim();
  if (
    !firstName ||
    !lastName ||
    !phone ||
    !input.addressLine1.trim() ||
    !input.postalCode.trim() ||
    !input.city.trim()
  ) {
    throw new DomainError(
      "DETAILS_REQUIRED",
      "Toutes les informations sont obligatoires (seul le complément d'adresse est facultatif).",
    );
  }
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.userId },
      data: { firstName, lastName, phone },
    });
    await tx.customerProfile.update({
      where: { id: customerId },
      data: {
        returnName: `${firstName} ${lastName}`,
        returnPhone: phone,
        returnAddressLine1: input.addressLine1.trim(),
        returnAddressLine2: input.addressLine2?.trim() || null,
        returnPostalCode: input.postalCode.trim(),
        returnCity: input.city.trim(),
        returnCountry: input.country.trim().toUpperCase() || "FR",
      },
    });
    await audit(
      {
        actor,
        action: "customer.details_completed",
        entityType: "customer",
        entityId: customerId,
        summary: "Nom, téléphone et adresse renseignés",
      },
      tx,
    );
  });
}

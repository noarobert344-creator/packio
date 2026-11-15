import { db, type Tx } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";

/** Souscription principale active (ou en impayé) du client. */
export async function getActiveSubscription(customerId: string, client: Tx | typeof db = db) {
  return client.subscription.findFirst({
    where: { customerId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    // Souscription principale : celle qui n'a pas été remplacée par un changement d'offre.
    orderBy: [{ supersededAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    include: { plan: true, pendingPlan: true },
  });
}

/**
 * Vérifie qu'un client peut lancer de nouvelles opérations logistiques :
 * abonnement actif, à jour de paiement, préparateur attribué.
 */
export async function assertCustomerOperational(client: Tx | typeof db, customerId: string, opts?: { requirePreparer?: boolean }) {
  const customer = await client.customerProfile.findUnique({ where: { id: customerId } });
  if (!customer) throw new NotFoundError("Client introuvable.");
  if (customer.status === "PAST_DUE") {
    throw new DomainError("PAST_DUE", "Votre dernier paiement a échoué. Mettez à jour votre moyen de paiement pour continuer.");
  }
  if (customer.status !== "ACTIVE") {
    throw new DomainError("INACTIVE", "Votre abonnement n'est pas actif.");
  }
  if (opts?.requirePreparer !== false && !customer.currentPreparerId) {
    throw new DomainError("NO_PREPARER", "Votre préparateur n'est pas encore attribué.");
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
export async function updateReturnAddress(customerId: string, input: ReturnAddressInput) {
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

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

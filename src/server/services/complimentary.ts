import { addMonths } from "date-fns";
import { db } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";
import { assertAdmin, type Actor } from "@/server/auth/actor";
import { audit } from "./audit";
import { grantDueAnnualCredits, syncSubscription } from "./billing";
import { withEffects } from "./notifications";

/**
 * ABONNEMENT OFFERT PAR L'ADMINISTRATION
 * Active l'abonnement d'un client sans paiement (inscrit qui n'a pas payé,
 * geste commercial, partenaire…) pour 1, 3, 6 ou 12 mois. Jamais envoyé à
 * Whop ni facturé. Les crédits de l'offre sont versés chaque mois (le premier
 * mois tout de suite) ; à la date de fin, l'abonnement s'arrête tout seul.
 */

export const COMPLIMENTARY_PREFIX = "offert_";
export const COMPLIMENTARY_MONTHS = [1, 3, 6, 12] as const;

export function isComplimentary(externalId: string) {
  return (
    externalId.startsWith(COMPLIMENTARY_PREFIX) ||
    externalId.startsWith("interne_")
  );
}

export async function activateComplimentarySubscription(
  actor: Actor,
  input: { customerId: string; planId: string; months: number; reason: string },
) {
  assertAdmin(actor, "billing.manage");
  if (!(COMPLIMENTARY_MONTHS as readonly number[]).includes(input.months)) {
    throw new DomainError("MONTHS", "Durée invalide : 1, 3, 6 ou 12 mois.", {
      fieldErrors: { months: "Durée invalide" },
    });
  }
  const reason = input.reason.trim();
  if (reason.length < 3)
    throw new DomainError(
      "REASON",
      "Indiquez un motif (au moins 3 caractères).",
      { fieldErrors: { reason: "Motif requis" } },
    );
  const [customer, plan] = await Promise.all([
    db.customerProfile.findUnique({
      where: { id: input.customerId },
      select: { id: true, referenceCode: true, status: true },
    }),
    db.plan.findUnique({ where: { id: input.planId } }),
  ]);
  if (!customer) throw new NotFoundError("Client introuvable.");
  if (customer.status === "SUSPENDED")
    throw new DomainError(
      "SUSPENDED",
      "Ce compte est suspendu : réactivez-le d'abord.",
    );
  if (!plan || !plan.isActive)
    throw new DomainError("PLAN", "Offre indisponible.", {
      fieldErrors: { planId: "Offre indisponible" },
    });
  const active = await db.subscription.findFirst({
    where: {
      customerId: customer.id,
      status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
    },
  });
  if (active)
    throw new DomainError(
      "ALREADY_SUBSCRIBED",
      "Ce client a déjà un abonnement en cours.",
    );

  const now = new Date();
  const end = addMonths(now, input.months);
  const externalId = `${COMPLIMENTARY_PREFIX}${customer.referenceCode}_${now.getTime().toString(36)}`;
  await withEffects(async (tx, fx) => {
    await syncSubscription(tx, fx, {
      customerId: customer.id,
      planId: plan.id,
      // Abonnement interne : jamais transmis à Whop.
      provider: "dev",
      externalId,
      status: "ACTIVE",
      periodStart: now,
      periodEnd: end,
      cancelAtPeriodEnd: true,
      canceledAt: null,
      endedAt: null,
      // Calendrier mensuel des crédits (comme la formule annuelle), jusqu'à la date de fin.
      billingInterval: "YEARLY",
    });
    await tx.subscription.update({
      where: { externalId },
      data: {
        creditAnchorAt: now,
        creditMonthsGranted: 0,
        nextCreditGrantAt: now,
      },
    });
    await audit(
      {
        actor,
        action: "subscription.complimentary",
        entityType: "customer",
        entityId: customer.id,
        summary: `${plan.name} offert ${input.months} mois — ${reason}`,
        metadata: { externalId, until: end.toISOString() },
      },
      tx,
    );
  });
  // Crédits du premier mois versés tout de suite.
  await grantDueAnnualCredits(now);
  return { externalId, until: end };
}

/** Tâche planifiée : les abonnements offerts arrivés à leur date de fin s'arrêtent. */
export async function endExpiredComplimentarySubscriptions(now = new Date()) {
  const due = await db.subscription.findMany({
    where: {
      externalId: { startsWith: COMPLIMENTARY_PREFIX },
      status: { in: ["ACTIVE", "TRIALING"] },
      currentPeriodEnd: { lte: now },
    },
    take: 200,
  });
  for (const sub of due) {
    await withEffects((tx, fx) =>
      syncSubscription(tx, fx, {
        customerId: sub.customerId,
        planId: sub.planId,
        provider: "dev",
        externalId: sub.externalId,
        status: "CANCELED",
        periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: false,
        canceledAt: now,
        endedAt: now,
      }),
    );
  }
  return { complimentaryEnded: due.length };
}

import { addMonths, format } from "date-fns";
import { fr } from "date-fns/locale";
import type { BillingInterval, SubscriptionStatus } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/db";
import { MONTHS_PER_YEAR } from "@/lib/billing-intervals";
import { audit } from "./audit";
import { grantCredits, grantMonthlyCycle, purchasedCreditsExpiry } from "./credits";
import { type Effects, withEffects } from "./notifications";
import { openAssignmentRequest, WAITING_STATES } from "./assignments";

/**
 * TRAITEMENTS DE FACTURATION (indépendants du prestataire)
 * Appelés par le traitement des webhooks Whop vérifiés, ou par le mode de
 * paiement de démonstration en développement. Tous sont idempotents.
 */

const ACTIVE: SubscriptionStatus[] = ["ACTIVE", "TRIALING"];
const DELINQUENT: SubscriptionStatus[] = ["PAST_DUE", "UNPAID"];
const NOT_STARTED: SubscriptionStatus[] = ["INCOMPLETE", "INCOMPLETE_EXPIRED"];

const dateFr = (d: Date) => format(d, "d MMMM yyyy", { locale: fr });

export type SubscriptionSnapshot = {
  customerId: string;
  planId: string;
  provider: "whop" | "dev";
  externalId: string;
  status: SubscriptionStatus;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  endedAt: Date | null;
  /** Périodicité, retenue à la création de la souscription (ignorée ensuite). */
  billingInterval?: BillingInterval;
};

export async function syncSubscription(tx: Tx, fx: Effects, snap: SubscriptionSnapshot) {
  await tx.$queryRaw`SELECT "id" FROM "customer_profiles" WHERE "id" = ${snap.customerId} FOR UPDATE`;
  const existing = await tx.subscription.findUnique({ where: { externalId: snap.externalId }, include: { plan: true } });
  const data = {
    customerId: snap.customerId,
    planId: snap.planId,
    provider: snap.provider,
    status: snap.status,
    currentPeriodStart: snap.periodStart,
    currentPeriodEnd: snap.periodEnd,
    cancelAtPeriodEnd: snap.cancelAtPeriodEnd,
    canceledAt: snap.canceledAt,
    endedAt: snap.endedAt,
  };
  const subscription = existing
    ? await tx.subscription.update({ where: { id: existing.id }, data, include: { plan: true } })
    : await tx.subscription.create({ data: { ...data, externalId: snap.externalId, billingInterval: snap.billingInterval ?? "MONTHLY" }, include: { plan: true } });
  const yearly = subscription.billingInterval === "YEARLY";
  const formula = `${subscription.plan.name}${yearly ? " (formule annuelle)" : ""}`;

  // Nouvelle souscription active alors qu'une autre existe : changement d'offre
  // immédiat. L'ancienne n'est plus renouvelée et conserve ce qui a été payé.
  const replaced: { name: string; externalId: string; provider: string }[] = [];
  if (ACTIVE.includes(snap.status) && (!existing || NOT_STARTED.includes(existing.status))) {
    const previous = await tx.subscription.findMany({
      where: { customerId: snap.customerId, id: { not: subscription.id }, supersededAt: null, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
      include: { plan: true },
    });
    for (const old of previous) {
      await tx.subscription.update({
        where: { id: old.id },
        data: { supersededAt: new Date(), cancelAtPeriodEnd: true, pendingPlanId: null, pendingBillingInterval: null, pendingSyncedAt: null },
      });
      replaced.push({ name: old.plan.name, externalId: old.externalId, provider: old.provider });
      await audit({ actor: null, action: "subscription.superseded", entityType: "customer", entityId: snap.customerId, summary: `${old.plan.name} → ${subscription.plan.name}` }, tx);
      if (old.provider === "whop") {
        fx.after(async () => {
          try {
            await (await import("@/server/billing/whop")).cancelMembershipAtPeriodEnd(old.externalId);
          } catch (err) {
            await withEffects(async (_tx, afx) =>
              afx.notifyAdmins(
                {
                  type: "SUBSCRIPTION_UPDATED",
                  title: "Ancienne adhésion Whop à arrêter",
                  body: `Changement d'offre du client ${snap.customerId} : l'adhésion ${old.externalId} n'a pas pu être arrêtée automatiquement (${err instanceof Error ? err.message : "erreur"}). Désactivez son renouvellement dans Whop.`,
                  link: `/admin/clients/${snap.customerId}`,
                },
                "billing.manage",
              ),
            );
          }
        });
      }
    }
  }

  const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: snap.customerId }, include: { user: true } });
  const others = await tx.subscription.findMany({ where: { customerId: snap.customerId }, select: { status: true } });
  let status = customer.status;
  if (customer.status !== "SUSPENDED") {
    if (others.some((s) => ACTIVE.includes(s.status))) status = "ACTIVE";
    else if (others.some((s) => DELINQUENT.includes(s.status))) status = "PAST_DUE";
    else if (others.every((s) => s.status === "INCOMPLETE")) status = "PENDING_PAYMENT";
    else status = "CANCELED";
  }
  if (status !== customer.status) {
    await tx.customerProfile.update({ where: { id: customer.id }, data: { status } });
  }

  const wasActive = !!existing && ACTIVE.includes(existing.status);
  const isActive = ACTIVE.includes(snap.status);
  let activated = false;
  if (isActive && !wasActive) {
    activated = true;
    if (!customer.currentPreparerId && !WAITING_STATES.includes(customer.assignmentState)) {
      if (customer.assignmentState !== "NOT_REQUESTED") {
        await tx.customerProfile.update({ where: { id: customer.id }, data: { assignmentState: "NOT_REQUESTED" } });
      }
      await openAssignmentRequest(tx, fx, customer.id);
    }
    await audit({ actor: null, action: "subscription.activated", entityType: "customer", entityId: customer.id, summary: formula }, tx);
    fx.notify(customer.userId, {
      type: "SUBSCRIPTION_ACTIVATED",
      title: replaced.length ? `Nouvelle offre ${formula} activée` : `Abonnement ${formula} activé`,
      body:
        `Votre abonnement ${formula} est actif : ${subscription.plan.monthlyCredits} crédits sont disponibles chaque mois.` +
        (replaced.length ? ` Votre offre précédente (${replaced.map((r) => r.name).join(", ")}) ne sera plus renouvelée ; ses crédits restent utilisables.` : ""),
      link: "/client",
    });
  }

  if (existing && !existing.supersededAt && existing.cancelAtPeriodEnd !== snap.cancelAtPeriodEnd && snap.status !== "CANCELED") {
    fx.notify(customer.userId, {
      type: "SUBSCRIPTION_UPDATED",
      title: snap.cancelAtPeriodEnd ? "Résiliation programmée" : "Résiliation annulée",
      body: snap.cancelAtPeriodEnd
        ? `Votre abonnement prendra fin le ${snap.periodEnd ? dateFr(snap.periodEnd) : "à la fin de la période"}. Vous conservez l'accès d'ici là.`
        : "Votre abonnement continuera d'être renouvelé automatiquement.",
      link: "/client/facturation",
    });
  }

  if (snap.status === "CANCELED" && existing?.status !== "CANCELED" && existing?.supersededAt) {
    // Fin normale d'une offre remplacée : le client dispose déjà de sa nouvelle offre.
    await tx.subscription.update({ where: { id: subscription.id }, data: { nextCreditGrantAt: null } });
    await audit({ actor: null, action: "subscription.ended_superseded", entityType: "customer", entityId: customer.id, summary: subscription.plan.name }, tx);
  } else if (snap.status === "CANCELED" && existing?.status !== "CANCELED" && existing?.pendingBillingInterval === "MONTHLY") {
    // Fin de la formule annuelle : le client a demandé à passer au mensuel.
    const next = existing.pendingPlanId ? await tx.plan.findUnique({ where: { id: existing.pendingPlanId } }) : null;
    await tx.subscription.update({ where: { id: subscription.id }, data: { nextCreditGrantAt: null } });
    await audit({ actor: null, action: "subscription.annual_ended", entityType: "customer", entityId: customer.id, summary: `${subscription.plan.name} → ${next?.name ?? "?"} mensuel` }, tx);
    fx.notify(customer.userId, {
      type: "SUBSCRIPTION_UPDATED",
      title: "Activez votre formule mensuelle",
      body: `Votre formule annuelle ${subscription.plan.name} est arrivée à échéance. Activez maintenant votre formule mensuelle ${next?.name ?? ""} pour continuer à recevoir vos crédits et à expédier vos colis.`.replace("  ", " "),
      link: "/client/abonnement",
      forceEmail: true,
    });
  } else if (snap.status === "CANCELED" && existing?.status !== "CANCELED") {
    await tx.subscription.update({ where: { id: subscription.id }, data: { nextCreditGrantAt: null } });
    await audit({ actor: null, action: "subscription.canceled", entityType: "customer", entityId: customer.id }, tx);
    fx.notify(customer.userId, {
      type: "SUBSCRIPTION_UPDATED",
      title: "Abonnement résilié",
      body: "Votre abonnement est résilié. Votre stock reste consultable ; contactez le support pour organiser la restitution de vos articles.",
      link: "/client/facturation",
    });
    fx.notifyAdmins(
      {
        type: "SUBSCRIPTION_UPDATED",
        title: "Abonnement résilié",
        body: `${customer.user.firstName} ${customer.user.lastName} (${customer.referenceCode}) a résilié. Vérifiez le stock restant et l'affectation.`,
        link: `/admin/clients/${customer.id}`,
      },
      "customers.manage",
    );
  }
  return { subscription, activated };
}

export type InvoiceSnapshot = {
  externalId: string;
  customerId: string;
  subscriptionExternalId: string | null;
  number: string | null;
  status: string;
  billingReason: string | null;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  issuedAt: Date;
  planId: string | null;
  membershipId: string | null;
  provider: "whop" | "dev";
};

export async function recordInvoice(tx: Tx, snap: InvoiceSnapshot) {
  const subscription = snap.subscriptionExternalId
    ? await tx.subscription.findUnique({ where: { externalId: snap.subscriptionExternalId }, select: { id: true } })
    : null;
  const data = {
    customerId: snap.customerId,
    subscriptionId: subscription?.id ?? null,
    number: snap.number,
    status: snap.status,
    billingReason: snap.billingReason,
    amountDueCents: snap.amountDueCents,
    amountPaidCents: snap.amountPaidCents,
    currency: snap.currency,
    hostedUrl: snap.hostedUrl,
    pdfUrl: snap.pdfUrl,
    periodStart: snap.periodStart,
    periodEnd: snap.periodEnd,
    issuedAt: snap.issuedAt,
  };
  return tx.invoice.upsert({ where: { externalId: snap.externalId }, create: { ...data, externalId: snap.externalId }, update: data });
}

function periodLabel(start: Date | null, end: Date | null) {
  if (!start || !end) return "";
  return `${format(start, "d MMM", { locale: fr })} – ${format(end, "d MMM yyyy", { locale: fr })}`;
}

/**
 * Paiement d'abonnement réussi : enregistrement du paiement et de la facture,
 * application d'un éventuel changement d'offre programmé (au renouvellement),
 * puis allocation des crédits du mois. Pour la formule annuelle, les mois
 * suivants sont distribués par grantDueAnnualCredits.
 */
export async function onInvoicePaid(tx: Tx, fx: Effects, snap: InvoiceSnapshot) {
  const invoice = await recordInvoice(tx, snap);
  let subscription = snap.subscriptionExternalId
    ? await tx.subscription.findUnique({ where: { externalId: snap.subscriptionExternalId }, include: { plan: true, pendingPlan: true } })
    : null;
  const isCycle = snap.billingReason === "subscription_cycle";
  if (subscription && isCycle && subscription.pendingPlan) {
    // Chez Whop, la baisse de prix doit avoir été transmise avant l'échéance ;
    // sinon le client a payé l'offre actuelle et la conserve pour cette période.
    if (subscription.provider !== "whop" || subscription.pendingSyncedAt) {
      const from = subscription.plan.name;
      subscription = await tx.subscription.update({
        where: { id: subscription.id },
        data: { planId: subscription.pendingPlan.id, pendingPlanId: null, pendingSyncedAt: null },
        include: { plan: true, pendingPlan: true },
      });
      await audit({ actor: null, action: "subscription.plan_changed", entityType: "customer", entityId: snap.customerId, summary: `${from} → ${subscription.plan.name}` }, tx);
    } else {
      fx.notifyAdmins(
        {
          type: "SUBSCRIPTION_UPDATED",
          title: "Changement d'offre non transmis à Whop",
          body: `Le passage à l'offre ${subscription.pendingPlan.name} (client ${snap.customerId}) n'a pas été transmis à Whop avant le renouvellement : le client conserve l'offre ${subscription.plan.name} cette période. Nouvel essai avant la prochaine échéance.`,
          link: `/admin/clients/${snap.customerId}`,
        },
        "billing.manage",
      );
    }
  }
  const plan = subscription?.plan ?? (snap.planId ? await tx.plan.findUnique({ where: { id: snap.planId } }) : null);
  const yearly = subscription?.billingInterval === "YEARLY";
  const paymentData = {
    customerId: snap.customerId,
    kind: "SUBSCRIPTION" as const,
    status: "SUCCEEDED" as const,
    amountCents: snap.amountPaidCents,
    currency: snap.currency,
    description: `Abonnement ${plan?.name ?? ""}${yearly ? " annuel" : ""} ${periodLabel(snap.periodStart, snap.periodEnd)}`.trim(),
    provider: snap.provider,
    invoiceId: invoice.id,
    membershipId: snap.membershipId,
    failureMessage: null,
  };
  await tx.payment.upsert({ where: { externalId: snap.externalId }, create: { ...paymentData, externalId: snap.externalId }, update: paymentData });

  let granted = false;
  if (plan && (snap.billingReason === "subscription_create" || isCycle)) {
    const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: snap.customerId }, select: { userId: true } });
    const anchor = snap.periodStart ?? new Date();
    const firstMonthEnd = yearly ? addMonths(anchor, 1) : (snap.periodEnd ?? addMonths(new Date(), 1));
    const res = await grantMonthlyCycle(tx, {
      customerId: snap.customerId,
      amount: plan.monthlyCredits,
      periodEnd: firstMonthEnd,
      sourceRef: snap.subscriptionExternalId ?? snap.externalId,
      idempotencyKey: `cycle:${snap.externalId}`,
      description: yearly
        ? `Crédits mensuels ${plan.name} — formule annuelle, mois 1/${MONTHS_PER_YEAR}`
        : `Crédits mensuels ${plan.name} ${periodLabel(snap.periodStart, snap.periodEnd)}`.trim(),
    });
    granted = res.applied;
    if (res.applied && subscription && yearly) {
      // Calendrier de distribution des 11 mois suivants de la période annuelle.
      const next = addMonths(anchor, 1);
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { creditAnchorAt: anchor, creditMonthsGranted: 1, nextCreditGrantAt: !snap.periodEnd || next < snap.periodEnd ? next : null },
      });
    }
    if (res.applied && isCycle) {
      fx.notify(customer.userId, {
        type: "SUBSCRIPTION_RENEWED",
        title: yearly ? "Formule annuelle renouvelée" : "Abonnement renouvelé",
        body: yearly
          ? `Votre formule annuelle ${plan.name} a été renouvelée pour un an : ${plan.monthlyCredits} crédits sont disponibles, puis chaque mois.`
          : `Votre abonnement ${plan.name} a été renouvelé : ${plan.monthlyCredits} nouveaux crédits sont disponibles.`,
        link: "/client/credits",
      });
    }
    if (res.applied) fx.after(async () => (await import("./shipments")).retryAwaitingCredits(snap.customerId));
  }
  return { invoice, granted };
}

/**
 * Formule annuelle : distribution des crédits du mois, le même jour que la
 * souscription (rattrapage si une exécution a été manquée). Idempotent.
 * Appelée par la tâche planifiée « credits ».
 */
export async function grantDueAnnualCredits(now = new Date()) {
  const due = await db.subscription.findMany({
    where: { billingInterval: "YEARLY", status: { in: ACTIVE }, nextCreditGrantAt: { lte: now } },
    select: { id: true },
    orderBy: { nextCreditGrantAt: "asc" },
    take: 500,
  });
  let grants = 0;
  for (const { id } of due) {
    grants += await withEffects((tx, fx) => grantAnnualMonths(tx, fx, id, now));
  }
  return { annualGrants: grants };
}

async function grantAnnualMonths(tx: Tx, fx: Effects, subscriptionId: string, now: Date) {
  await tx.$queryRaw`SELECT "id" FROM "subscriptions" WHERE "id" = ${subscriptionId} FOR UPDATE`;
  let sub = await tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, include: { plan: true } });
  let granted = 0;
  while (
    sub.nextCreditGrantAt &&
    sub.nextCreditGrantAt <= now &&
    sub.creditAnchorAt &&
    sub.creditMonthsGranted < MONTHS_PER_YEAR &&
    ACTIVE.includes(sub.status)
  ) {
    const month = sub.creditMonthsGranted + 1;
    const periodEnd = sub.currentPeriodEnd;
    if (periodEnd && sub.nextCreditGrantAt >= periodEnd) {
      sub = await tx.subscription.update({ where: { id: sub.id }, data: { nextCreditGrantAt: null }, include: { plan: true } });
      break;
    }
    const monthEnd = addMonths(sub.creditAnchorAt, month);
    const res = await grantMonthlyCycle(tx, {
      customerId: sub.customerId,
      amount: sub.plan.monthlyCredits,
      periodEnd: periodEnd && monthEnd > periodEnd ? periodEnd : monthEnd,
      sourceRef: sub.externalId,
      idempotencyKey: `annual:${sub.externalId}:${sub.creditAnchorAt.toISOString()}:${month}`,
      description: `Crédits mensuels ${sub.plan.name} — formule annuelle, mois ${month}/${MONTHS_PER_YEAR}`,
    });
    if (res.applied) granted++;
    const next = month < MONTHS_PER_YEAR ? monthEnd : null;
    sub = await tx.subscription.update({
      where: { id: sub.id },
      data: { creditMonthsGranted: month, nextCreditGrantAt: next && (!periodEnd || next < periodEnd) ? next : null },
      include: { plan: true },
    });
  }
  if (granted > 0) {
    const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: sub.customerId }, select: { userId: true } });
    fx.notify(customer.userId, {
      type: "CREDITS_ADDED",
      title: "Crédits du mois disponibles",
      body: `${sub.plan.monthlyCredits} crédits de votre formule annuelle ${sub.plan.name} ont été ajoutés (mois ${sub.creditMonthsGranted}/${MONTHS_PER_YEAR}).`,
      link: "/client/credits",
    });
    fx.after(async () => (await import("./shipments")).retryAwaitingCredits(sub.customerId));
  }
  return granted;
}

export async function onInvoicePaymentFailed(tx: Tx, fx: Effects, snap: InvoiceSnapshot & { failureMessage: string | null }) {
  const invoice = await recordInvoice(tx, snap);
  const existing = await tx.payment.findUnique({ where: { externalId: snap.externalId } });
  if (!existing || existing.status !== "SUCCEEDED") {
    const data = {
      customerId: snap.customerId,
      kind: "SUBSCRIPTION" as const,
      status: "FAILED" as const,
      amountCents: snap.amountDueCents,
      currency: snap.currency,
      description: `Échec de paiement de l'abonnement ${periodLabel(snap.periodStart, snap.periodEnd)}`.trim(),
      provider: snap.provider,
      invoiceId: invoice.id,
      membershipId: snap.membershipId,
      failureMessage: snap.failureMessage?.slice(0, 300) ?? null,
    };
    await tx.payment.upsert({ where: { externalId: snap.externalId }, create: { ...data, externalId: snap.externalId }, update: data });
  }
  const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: snap.customerId }, include: { user: true } });
  fx.notify(customer.userId, {
    type: "PAYMENT_FAILED",
    title: "Échec du paiement",
    body: "Le paiement de votre abonnement n'a pas abouti. Mettez à jour votre moyen de paiement pour éviter l'interruption du service.",
    link: "/client/facturation",
    forceEmail: true,
  });
  fx.notifyAdmins(
    {
      type: "PAYMENT_FAILED",
      title: "Paiement échoué",
      body: `${customer.user.firstName} ${customer.user.lastName} (${customer.referenceCode}) : échec de paiement de ${(snap.amountDueCents / 100).toFixed(2)} €.`,
      link: `/admin/clients/${customer.id}`,
    },
    "billing.read",
  );
  return { invoice };
}

export async function onCreditPackPaid(
  tx: Tx,
  fx: Effects,
  input: {
    customerId: string;
    packId: string | null;
    credits: number;
    amountCents: number;
    currency: string;
    externalId: string;
    membershipId: string | null;
    provider: "whop" | "dev";
    description: string;
  },
) {
  const data = {
    customerId: input.customerId,
    kind: "CREDIT_PACK" as const,
    status: "SUCCEEDED" as const,
    amountCents: input.amountCents,
    currency: input.currency,
    description: input.description,
    provider: input.provider,
    membershipId: input.membershipId,
    creditPackId: input.packId,
    creditsGranted: input.credits,
  };
  const payment = await tx.payment.upsert({ where: { externalId: input.externalId }, create: { ...data, externalId: input.externalId }, update: data });
  const { applied } = await grantCredits(tx, {
    customerId: input.customerId,
    bucket: "PURCHASED",
    amount: input.credits,
    source: "PURCHASE",
    sourceRef: input.externalId,
    expiresAt: await purchasedCreditsExpiry(tx),
    type: "PURCHASE",
    description: input.description,
    paymentId: payment.id,
    idempotencyKey: `purchase:${input.externalId}`,
  });
  if (applied) {
    const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: input.customerId }, select: { userId: true } });
    fx.notify(customer.userId, {
      type: "CREDITS_ADDED",
      title: "Recharge confirmée",
      body: `${input.credits} crédits ont été ajoutés à votre portefeuille.`,
      link: "/client/credits",
    });
    fx.after(async () => (await import("./shipments")).retryAwaitingCredits(input.customerId));
  }
  return { payment, applied };
}

export async function onPaymentRefunded(tx: Tx, input: { externalId: string; amountRefundedCents: number }) {
  const payment = await tx.payment.findUnique({ where: { externalId: input.externalId } });
  if (!payment) return null;
  const refunded = Math.min(payment.amountCents, Math.max(payment.refundedCents, input.amountRefundedCents));
  return tx.payment.update({
    where: { id: payment.id },
    data: { refundedCents: refunded, status: refunded >= payment.amountCents ? "REFUNDED" : refunded > 0 ? "PARTIALLY_REFUNDED" : payment.status },
  });
}

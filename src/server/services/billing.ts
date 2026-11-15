import { addMonths, format } from "date-fns";
import { fr } from "date-fns/locale";
import type { SubscriptionStatus } from "@/generated/prisma/enums";
import { type Tx } from "@/server/db";
import { audit } from "./audit";
import { grantCredits, grantMonthlyCycle, purchasedCreditsExpiry } from "./credits";
import { type Effects } from "./notifications";
import { openAssignmentRequest, WAITING_STATES } from "./assignments";

/**
 * TRAITEMENTS DE FACTURATION (indépendants du prestataire)
 * Appelés par le traitement des webhooks Whop vérifiés, ou par le mode de
 * paiement de démonstration en développement. Tous sont idempotents.
 */

const ACTIVE: SubscriptionStatus[] = ["ACTIVE", "TRIALING"];
const DELINQUENT: SubscriptionStatus[] = ["PAST_DUE", "UNPAID"];

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
    : await tx.subscription.create({ data: { ...data, externalId: snap.externalId }, include: { plan: true } });

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
    await audit({ actor: null, action: "subscription.activated", entityType: "customer", entityId: customer.id, summary: subscription.plan.name }, tx);
    fx.notify(customer.userId, {
      type: "SUBSCRIPTION_ACTIVATED",
      title: `Abonnement ${subscription.plan.name} activé`,
      body: `Votre abonnement ${subscription.plan.name} est actif : ${subscription.plan.monthlyCredits} crédits sont disponibles chaque mois.`,
      link: "/client",
    });
  }

  if (existing && existing.cancelAtPeriodEnd !== snap.cancelAtPeriodEnd && snap.status !== "CANCELED") {
    fx.notify(customer.userId, {
      type: "SUBSCRIPTION_UPDATED",
      title: snap.cancelAtPeriodEnd ? "Résiliation programmée" : "Résiliation annulée",
      body: snap.cancelAtPeriodEnd
        ? `Votre abonnement prendra fin le ${snap.periodEnd ? format(snap.periodEnd, "d MMMM yyyy", { locale: fr }) : "à la fin de la période"}. Vous conservez l'accès d'ici là.`
        : "Votre abonnement continuera d'être renouvelé automatiquement.",
      link: "/client/facturation",
    });
  }

  if (snap.status === "CANCELED" && existing?.status !== "CANCELED") {
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
 * puis allocation mensuelle de crédits.
 */
export async function onInvoicePaid(tx: Tx, fx: Effects, snap: InvoiceSnapshot) {
  const invoice = await recordInvoice(tx, snap);
  let subscription = snap.subscriptionExternalId
    ? await tx.subscription.findUnique({ where: { externalId: snap.subscriptionExternalId }, include: { plan: true, pendingPlan: true } })
    : null;
  if (subscription && snap.billingReason === "subscription_cycle" && subscription.pendingPlan) {
    const from = subscription.plan.name;
    subscription = await tx.subscription.update({
      where: { id: subscription.id },
      data: { planId: subscription.pendingPlan.id, pendingPlanId: null },
      include: { plan: true, pendingPlan: true },
    });
    await audit({ actor: null, action: "subscription.plan_changed", entityType: "customer", entityId: snap.customerId, summary: `${from} → ${subscription.plan.name}` }, tx);
  }
  const plan = subscription?.plan ?? (snap.planId ? await tx.plan.findUnique({ where: { id: snap.planId } }) : null);
  const paymentData = {
    customerId: snap.customerId,
    kind: "SUBSCRIPTION" as const,
    status: "SUCCEEDED" as const,
    amountCents: snap.amountPaidCents,
    currency: snap.currency,
    description: `Abonnement ${plan?.name ?? ""} ${periodLabel(snap.periodStart, snap.periodEnd)}`.trim(),
    provider: snap.provider,
    invoiceId: invoice.id,
    membershipId: snap.membershipId,
    failureMessage: null,
  };
  await tx.payment.upsert({ where: { externalId: snap.externalId }, create: { ...paymentData, externalId: snap.externalId }, update: paymentData });

  let granted = false;
  if (plan && (snap.billingReason === "subscription_create" || snap.billingReason === "subscription_cycle")) {
    const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: snap.customerId }, select: { userId: true } });
    const res = await grantMonthlyCycle(tx, {
      customerId: snap.customerId,
      amount: plan.monthlyCredits,
      periodEnd: snap.periodEnd ?? addMonths(new Date(), 1),
      sourceRef: snap.externalId,
      idempotencyKey: `cycle:${snap.externalId}`,
      description: `Crédits mensuels ${plan.name} ${periodLabel(snap.periodStart, snap.periodEnd)}`.trim(),
    });
    granted = res.applied;
    if (res.applied && snap.billingReason === "subscription_cycle") {
      fx.notify(customer.userId, {
        type: "SUBSCRIPTION_RENEWED",
        title: "Abonnement renouvelé",
        body: `Votre abonnement ${plan.name} a été renouvelé : ${plan.monthlyCredits} nouveaux crédits sont disponibles.`,
        link: "/client/credits",
      });
    }
    if (res.applied) fx.after(async () => (await import("./shipments")).retryAwaitingCredits(snap.customerId));
  }
  return { invoice, granted };
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

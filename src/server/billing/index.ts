import "server-only";
import { addMonths } from "date-fns";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { DomainError, NotFoundError } from "@/server/errors";
import { assertAdmin, assertCustomer, type Actor } from "@/server/auth/actor";
import { randomCode } from "@/server/lib/ids";
import { isCreditPackSize } from "@/lib/credit-packs";
import { audit } from "@/server/services/audit";
import { withEffects } from "@/server/services/notifications";
import { debitCredits } from "@/server/services/credits";
import { getActiveSubscription } from "@/server/services/customers";
import { onCreditPackPaid, onInvoicePaid, onInvoicePaymentFailed, onPaymentRefunded, syncSubscription } from "@/server/services/billing";
import {
  asObj,
  cancelMembershipAtPeriodEnd,
  createCheckoutConfiguration,
  isWhopConfigured,
  mapMembershipStatus,
  refundWhopPayment,
  retrieveMembership,
  toDate,
  updateMembership,
} from "./whop";

export { isWhopConfigured };

/**
 * Façade de facturation : Whop en production ; mode de paiement de
 * démonstration (aucun encaissement) uniquement si BILLING_MODE=dev hors
 * production.
 */


/** Durée de facturation des abonnements Whop (en jours). */
const BILLING_PERIOD_DAYS = 30;

export function billingMode() {
  return env.billingMode;
}

function assertDevBilling() {
  if (env.billingMode !== "dev") throw new DomainError("DEV_ONLY", "Le mode de paiement de démonstration est désactivé.");
}

function assertWhop() {
  if (!isWhopConfigured()) throw new DomainError("WHOP_NOT_CONFIGURED", "Le paiement en ligne n'est pas encore configuré. Contactez le support.");
}

const toMajor = (cents: number) => Math.round(cents) / 100;

async function syncFromWhop(membershipObj: unknown, customerId: string, planId: string) {
  const m = asObj(membershipObj);
  const status = mapMembershipStatus(m.status);
  await withEffects((tx, fx) =>
    syncSubscription(tx, fx, {
      customerId,
      planId,
      provider: "whop",
      externalId: String(m.id),
      status,
      periodStart: toDate(m.current_period_start),
      periodEnd: toDate(m.current_period_end),
      cancelAtPeriodEnd: m.cancel_at_period_end === true,
      canceledAt: toDate(m.canceled_at),
      endedAt: status === "CANCELED" ? (toDate(m.expires_at) ?? new Date()) : null,
    }),
  );
}

// -----------------------------------------------------------------------------
// Abonnement
// -----------------------------------------------------------------------------

export async function startSubscriptionCheckout(actor: Actor, planId: string): Promise<{ url: string }> {
  const customerId = assertCustomer(actor);
  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) throw new DomainError("PLAN", "Cette offre n'est pas disponible.");
  if (await getActiveSubscription(customerId)) throw new DomainError("ALREADY_SUBSCRIBED", "Vous avez déjà un abonnement actif : utilisez le changement d'offre.");

  if (env.billingMode === "dev") return { url: `/paiement-demo?type=abonnement&offre=${plan.id}` };

  assertWhop();
  const checkout = await createCheckoutConfiguration({
    variantId: plan.whopPlanId,
    variant: {
      billing_type: "renewal",
      billing_period: BILLING_PERIOD_DAYS,
      initial_price: toMajor(plan.priceCents),
      renewal_price: toMajor(plan.priceCents),
      currency: plan.currency,
      title: `Packio ${plan.name}`,
      description: `${plan.monthlyCredits} crédits de préparation par mois`,
      product_id: env.whop.productId || undefined,
      visibility: "hidden",
      release_method: "buy_now",
      unlimited_stock: true,
    },
    metadata: { kind: "subscription", packio_customer_id: customerId, plan_id: plan.id },
    redirectUrl: `${env.appUrl}/client?abonnement=confirme`,
  });
  return { url: checkout.purchase_url };
}

/** Lien de gestion de l'abonnement chez Whop (moyen de paiement, reçus). */
export async function openBillingPortal(actor: Actor): Promise<{ url: string }> {
  const customerId = assertCustomer(actor);
  if (env.billingMode === "dev") return { url: "/client/facturation?portail=demo" };
  assertWhop();
  const sub = await getActiveSubscription(customerId);
  if (sub?.provider === "whop") {
    const membership = asObj(await retrieveMembership(sub.externalId).catch(() => null));
    if (typeof membership.manage_url === "string" && membership.manage_url) return { url: membership.manage_url };
  }
  return { url: "https://whop.com/@me/settings/orders" };
}

/**
 * Changement d'offre, appliqué au prochain renouvellement (Whop ne facture pas
 * de prorata) : le prix de renouvellement est modifié chez Whop et l'offre
 * programmée prend effet à la réception du paiement suivant, avec ses crédits.
 * Choisir l'offre actuelle annule un changement programmé.
 */
export async function changePlan(actor: Actor, planId: string) {
  const customerId = assertCustomer(actor);
  const [sub, plan] = await Promise.all([getActiveSubscription(customerId), db.plan.findUnique({ where: { id: planId } })]);
  if (!sub) throw new DomainError("NO_SUBSCRIPTION", "Aucun abonnement actif.");
  if (!plan || !plan.isActive) throw new DomainError("PLAN", "Offre indisponible.");
  if (sub.status === "PAST_DUE") throw new DomainError("PAST_DUE", "Régularisez votre paiement avant de changer d'offre.");
  const cancelPending = sub.planId === plan.id;
  if (cancelPending && !sub.pendingPlanId) throw new DomainError("SAME_PLAN", "Vous êtes déjà sur cette offre.");

  if (sub.provider === "whop") {
    assertWhop();
    await updateMembership(sub.externalId, {
      renewal_price: toMajor(plan.priceCents),
      metadata: { kind: "subscription", packio_customer_id: customerId, plan_id: sub.planId, next_plan_id: cancelPending ? null : plan.id },
    });
  } else {
    assertDevBilling();
  }
  await withEffects(async (tx, fx) => {
    await tx.subscription.update({ where: { id: sub.id }, data: { pendingPlanId: cancelPending ? null : plan.id } });
    await audit({ actor, action: cancelPending ? "subscription.plan_change_canceled" : "subscription.plan_change_scheduled", entityType: "customer", entityId: customerId, summary: `${sub.plan.name} → ${plan.name}` }, tx);
    fx.notify(actor.userId, {
      type: "SUBSCRIPTION_UPDATED",
      title: cancelPending ? "Changement d'offre annulé" : "Changement d'offre programmé",
      body: cancelPending
        ? `Votre abonnement reste sur l'offre ${sub.plan.name}.`
        : `Votre abonnement passera à l'offre ${plan.name} au prochain renouvellement : vous recevrez alors ${plan.monthlyCredits} crédits par mois.`,
      link: "/client/facturation",
    });
  });
  return { scheduled: !cancelPending };
}

export async function setCancelAtPeriodEnd(actor: Actor, cancel: boolean) {
  const customerId = assertCustomer(actor);
  const sub = await getActiveSubscription(customerId);
  if (!sub) throw new DomainError("NO_SUBSCRIPTION", "Aucun abonnement actif.");
  if (sub.provider === "dev") {
    assertDevBilling();
    await withEffects((tx, fx) =>
      syncSubscription(tx, fx, {
        customerId,
        planId: sub.planId,
        provider: "dev",
        externalId: sub.externalId,
        status: sub.status,
        periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: cancel,
        canceledAt: cancel ? new Date() : null,
        endedAt: null,
      }),
    );
  } else {
    assertWhop();
    const membership = cancel ? await cancelMembershipAtPeriodEnd(sub.externalId) : await updateMembership(sub.externalId, { cancel_at_period_end: false });
    await syncFromWhop({ ...asObj(membership), id: sub.externalId }, customerId, sub.planId);
  }
  await audit({ actor, action: cancel ? "subscription.cancel_requested" : "subscription.cancel_reverted", entityType: "customer", entityId: customerId });
}

// -----------------------------------------------------------------------------
// Recharges de crédits (10, 30, 50 ou 100)
// -----------------------------------------------------------------------------

export async function startCreditPackCheckout(actor: Actor, packId: string): Promise<{ url: string }> {
  const customerId = assertCustomer(actor);
  const pack = await db.creditPack.findUnique({ where: { id: packId } });
  if (!pack || !pack.isActive || !isCreditPackSize(pack.credits)) {
    throw new DomainError("PACK", "Cette recharge n'est pas disponible.");
  }
  if (!(await getActiveSubscription(customerId))) throw new DomainError("NO_SUBSCRIPTION", "Un abonnement actif est nécessaire pour acheter des crédits.");

  if (env.billingMode === "dev") return { url: `/paiement-demo?type=credits&pack=${pack.id}` };

  assertWhop();
  const checkout = await createCheckoutConfiguration({
    variantId: pack.whopPlanId,
    variant: {
      billing_type: "one_time",
      initial_price: toMajor(pack.priceCents),
      currency: pack.currency,
      title: `Packio — ${pack.credits} crédits`,
      description: `${pack.credits} crédits de préparation supplémentaires`,
      product_id: env.whop.productId || undefined,
      visibility: "hidden",
      release_method: "buy_now",
      unlimited_stock: true,
    },
    metadata: { kind: "credit_pack", packio_customer_id: customerId, pack_id: pack.id, credits: String(pack.credits) },
    redirectUrl: `${env.appUrl}/client/credits?recharge=confirmee`,
  });
  return { url: checkout.purchase_url };
}

// -----------------------------------------------------------------------------
// Remboursements
// -----------------------------------------------------------------------------

/** Remboursement (total ou partiel) d'un paiement, avec retrait optionnel des crédits achetés. */
export async function refundPayment(actor: Actor, input: { paymentId: string; amountCents?: number | null; removeCredits: boolean; reason: string }) {
  assertAdmin(actor, "billing.manage");
  if (input.reason.trim().length < 5) throw new DomainError("REASON", "Justification obligatoire.");
  const payment = await db.payment.findUnique({ where: { id: input.paymentId } });
  if (!payment) throw new NotFoundError("Paiement introuvable.");
  if (payment.status !== "SUCCEEDED" && payment.status !== "PARTIALLY_REFUNDED") throw new DomainError("STATUS", "Ce paiement ne peut pas être remboursé.");
  const remaining = payment.amountCents - payment.refundedCents;
  const amount = input.amountCents ?? remaining;
  if (amount <= 0 || amount > remaining) throw new DomainError("AMOUNT", `Montant invalide (maximum ${(remaining / 100).toFixed(2)} €).`);

  if (payment.provider === "whop") {
    assertWhop();
    await refundWhopPayment(payment.externalId, amount < remaining ? toMajor(amount) : null, `refund:${payment.id}:${payment.refundedCents}:${amount}`);
  }
  await withEffects(async (tx) => {
    await onPaymentRefunded(tx, { externalId: payment.externalId, amountRefundedCents: payment.refundedCents + amount });
    if (input.removeCredits && payment.kind === "CREDIT_PACK" && payment.creditsGranted) {
      const credits = Math.ceil((payment.creditsGranted * amount) / payment.amountCents);
      await debitCredits(tx, {
        customerId: payment.customerId,
        amount: credits,
        bucket: "PURCHASED",
        type: "REFUND_DEBIT",
        description: `Retrait de ${credits} crédit(s) suite au remboursement`,
        reason: input.reason.trim(),
        actorId: actor.userId,
        paymentId: payment.id,
        idempotencyKey: `refund-credits:${payment.id}:${payment.refundedCents}`,
        allowPartial: true,
      });
    }
    await audit(
      { actor, action: "payment.refunded", entityType: "payment", entityId: payment.id, summary: `${(amount / 100).toFixed(2)} € — ${input.reason.trim()}`, metadata: { removeCredits: input.removeCredits } },
      tx,
    );
  });
}

// -----------------------------------------------------------------------------
// Mode de paiement de démonstration (développement uniquement)
// -----------------------------------------------------------------------------

function devInvoice(input: {
  customerId: string;
  subscriptionExternalId: string;
  billingReason: "subscription_create" | "subscription_cycle";
  amountCents: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  planId: string;
  paid: boolean;
}) {
  return {
    externalId: `dev_pay_${randomCode(14)}`,
    customerId: input.customerId,
    subscriptionExternalId: input.subscriptionExternalId,
    number: `DEMO-${randomCode(6)}`,
    status: input.paid ? "paid" : "open",
    billingReason: input.billingReason,
    amountDueCents: input.amountCents,
    amountPaidCents: input.paid ? input.amountCents : 0,
    currency: input.currency,
    hostedUrl: null,
    pdfUrl: null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    issuedAt: new Date(),
    planId: input.planId,
    membershipId: input.subscriptionExternalId,
    provider: "dev" as const,
  };
}

export async function devCompleteSubscription(actor: Actor, planId: string) {
  assertDevBilling();
  const customerId = assertCustomer(actor);
  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) throw new DomainError("PLAN", "Offre indisponible.");
  if (await getActiveSubscription(customerId)) throw new DomainError("ALREADY_SUBSCRIBED", "Abonnement déjà actif.");
  const now = new Date();
  const end = addMonths(now, 1);
  const externalId = `dev_mem_${randomCode(14)}`;
  await withEffects(async (tx, fx) => {
    await syncSubscription(tx, fx, { customerId, planId, provider: "dev", externalId, status: "ACTIVE", periodStart: now, periodEnd: end, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null });
    await onInvoicePaid(tx, fx, devInvoice({ customerId, subscriptionExternalId: externalId, billingReason: "subscription_create", amountCents: plan.priceCents, currency: plan.currency, periodStart: now, periodEnd: end, planId, paid: true }));
  });
}

export async function devCompleteCreditPack(actor: Actor, packId: string) {
  assertDevBilling();
  const customerId = assertCustomer(actor);
  const pack = await db.creditPack.findUnique({ where: { id: packId } });
  if (!pack || !pack.isActive || !isCreditPackSize(pack.credits)) throw new DomainError("PACK", "Recharge indisponible.");
  if (!(await getActiveSubscription(customerId))) throw new DomainError("NO_SUBSCRIPTION", "Un abonnement actif est nécessaire pour acheter des crédits.");
  await withEffects((tx, fx) =>
    onCreditPackPaid(tx, fx, {
      customerId,
      packId: pack.id,
      credits: pack.credits,
      amountCents: pack.priceCents,
      currency: pack.currency,
      externalId: `dev_pay_${randomCode(14)}`,
      membershipId: null,
      provider: "dev",
      description: `Recharge de ${pack.credits} crédits`,
    }),
  );
}

/** Simule le renouvellement mensuel (nouvelle période, offre programmée appliquée, crédits). */
export async function devSimulateRenewal(customerId: string) {
  assertDevBilling();
  const sub = await getActiveSubscription(customerId);
  if (!sub || sub.provider !== "dev") throw new DomainError("NO_DEV_SUB", "Aucun abonnement de démonstration actif.");
  const start = sub.currentPeriodEnd ?? new Date();
  const end = addMonths(start, 1);
  const renewalPlan = sub.pendingPlanId ? await db.plan.findUniqueOrThrow({ where: { id: sub.pendingPlanId } }) : sub.plan;
  await withEffects(async (tx, fx) => {
    await syncSubscription(tx, fx, { customerId, planId: sub.planId, provider: "dev", externalId: sub.externalId, status: "ACTIVE", periodStart: start, periodEnd: end, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, canceledAt: sub.canceledAt, endedAt: null });
    await onInvoicePaid(tx, fx, devInvoice({ customerId, subscriptionExternalId: sub.externalId, billingReason: "subscription_cycle", amountCents: renewalPlan.priceCents, currency: renewalPlan.currency, periodStart: start, periodEnd: end, planId: renewalPlan.id, paid: true }));
  });
}

export async function devSimulatePaymentFailure(customerId: string) {
  assertDevBilling();
  const sub = await getActiveSubscription(customerId);
  if (!sub || sub.provider !== "dev") throw new DomainError("NO_DEV_SUB", "Aucun abonnement de démonstration actif.");
  await withEffects(async (tx, fx) => {
    await syncSubscription(tx, fx, { customerId, planId: sub.planId, provider: "dev", externalId: sub.externalId, status: "PAST_DUE", periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, canceledAt: null, endedAt: null });
    await onInvoicePaymentFailed(tx, fx, {
      ...devInvoice({ customerId, subscriptionExternalId: sub.externalId, billingReason: "subscription_cycle", amountCents: sub.plan.priceCents, currency: sub.plan.currency, periodStart: sub.currentPeriodEnd, periodEnd: sub.currentPeriodEnd ? addMonths(sub.currentPeriodEnd, 1) : null, planId: sub.planId, paid: false }),
      failureMessage: "Carte refusée (simulation)",
    });
  });
}

/** Régularisation d'un impayé en mode démo. */
export async function devRecoverPayment(customerId: string) {
  assertDevBilling();
  const sub = await getActiveSubscription(customerId);
  if (!sub || sub.provider !== "dev" || sub.status !== "PAST_DUE") throw new DomainError("NO_PAST_DUE", "Aucun impayé à régulariser.");
  await withEffects((tx, fx) =>
    syncSubscription(tx, fx, { customerId, planId: sub.planId, provider: "dev", externalId: sub.externalId, status: "ACTIVE", periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, canceledAt: null, endedAt: null }),
  );
}

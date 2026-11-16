import "server-only";
import { addDays, addMonths, addYears } from "date-fns";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { DomainError, NotFoundError } from "@/server/errors";
import { assertAdmin, assertCustomer, type Actor } from "@/server/auth/actor";
import { randomCode } from "@/server/lib/ids";
import { isCreditPackSize } from "@/lib/credit-packs";
import { BILLING_PERIOD_DAYS, intervalParam, priceFor, type BillingIntervalValue } from "@/lib/billing-intervals";
import { audit } from "@/server/services/audit";
import { withEffects } from "@/server/services/notifications";
import { debitCredits } from "@/server/services/credits";
import { getActiveSubscription } from "@/server/services/customers";
import { grantDueAnnualCredits, onCreditPackPaid, onInvoicePaid, onInvoicePaymentFailed, onPaymentRefunded, syncSubscription } from "@/server/services/billing";
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

/** Une baisse de prix programmée est transmise à Whop ce nombre de jours avant l'échéance. */
const PENDING_CHANGE_LEAD_DAYS = 2;

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

type CheckoutPlan = {
  id: string;
  name: string;
  priceCents: number;
  annualPriceCents: number | null;
  currency: string;
  monthlyCredits: number;
  whopPlanId: string | null;
  whopAnnualPlanId: string | null;
};

function assertIntervalAvailable(plan: CheckoutPlan, interval: BillingIntervalValue): number {
  const price = priceFor(plan, interval);
  if (price === null) throw new DomainError("NO_ANNUAL", `La formule annuelle n'est pas proposée pour l'offre ${plan.name}.`);
  return price;
}

/** Paiement Whop d'une souscription (nouvel abonnement ou changement d'offre immédiat). */
async function createSubscriptionCheckout(input: { customerId: string; plan: CheckoutPlan; interval: BillingIntervalValue; replaces?: string; redirectPath: string }) {
  const { plan, interval } = input;
  const price = assertIntervalAvailable(plan, interval);
  const yearly = interval === "YEARLY";
  const checkout = await createCheckoutConfiguration({
    variantId: yearly ? plan.whopAnnualPlanId : plan.whopPlanId,
    variant: {
      billing_type: "renewal",
      billing_period: BILLING_PERIOD_DAYS[interval],
      initial_price: toMajor(price),
      renewal_price: toMajor(price),
      currency: plan.currency,
      title: `Packio ${plan.name}${yearly ? " — annuel" : ""}`,
      description: yearly
        ? `${plan.monthlyCredits} crédits de préparation par mois, facturation annuelle`
        : `${plan.monthlyCredits} crédits de préparation par mois`,
      product_id: env.whop.productId || undefined,
      visibility: "hidden",
      release_method: "buy_now",
      unlimited_stock: true,
    },
    metadata: {
      kind: "subscription",
      packio_customer_id: input.customerId,
      plan_id: plan.id,
      billing_interval: yearly ? "yearly" : "monthly",
      ...(input.replaces ? { replaces: input.replaces } : {}),
    },
    redirectUrl: `${env.appUrl}${input.redirectPath}`,
  });
  return { url: checkout.purchase_url };
}

export async function startSubscriptionCheckout(actor: Actor, planId: string, interval: BillingIntervalValue = "MONTHLY"): Promise<{ url: string }> {
  const customerId = assertCustomer(actor);
  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) throw new DomainError("PLAN", "Cette offre n'est pas disponible.");
  assertIntervalAvailable(plan, interval);
  if (await getActiveSubscription(customerId)) throw new DomainError("ALREADY_SUBSCRIBED", "Vous avez déjà un abonnement actif : utilisez le changement d'offre.");

  if (env.billingMode === "dev") return { url: `/paiement-demo?type=abonnement&offre=${plan.id}&periodicite=${intervalParam(interval)}` };

  assertWhop();
  // Retour sur une page d'attente : le webhook de Whop arrive parfois quelques secondes après le client.
  return createSubscriptionCheckout({ customerId, plan, interval, redirectPath: "/client/abonnement?paiement=confirme" });
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

export type PlanChangeResult =
  | { mode: "checkout"; url: string }
  | { mode: "scheduled"; effectiveAt: Date | null }
  | { mode: "canceled" };

/**
 * Changement d'offre ou de périodicité. Whop ne facture pas de prorata et ne
 * permet que de baisser le prix d'une adhésion existante, d'où trois cas :
 *  - offre moins chère, même périodicité → programmé au prochain renouvellement ;
 *  - offre plus chère, ou passage du mensuel à l'annuel → nouveau paiement
 *    immédiat ; l'ancienne souscription n'est plus renouvelée et conserve ce
 *    qui a été payé (crédits déjà versés, mois restants de l'annuel) ;
 *  - passage de l'annuel au mensuel → à l'échéance de l'année : le
 *    renouvellement annuel est désactivé et le client active ensuite le mensuel.
 * Choisir l'offre et la périodicité actuelles annule un changement programmé.
 */
export async function changePlan(actor: Actor, planId: string, interval?: BillingIntervalValue): Promise<PlanChangeResult> {
  const customerId = assertCustomer(actor);
  const [sub, plan] = await Promise.all([getActiveSubscription(customerId), db.plan.findUnique({ where: { id: planId } })]);
  if (!sub) throw new DomainError("NO_SUBSCRIPTION", "Aucun abonnement actif.");
  if (!plan || !plan.isActive) throw new DomainError("PLAN", "Offre indisponible.");
  if (sub.status === "PAST_DUE") throw new DomainError("PAST_DUE", "Régularisez votre paiement avant de changer d'offre.");
  const target: BillingIntervalValue = interval ?? sub.billingInterval;
  const targetPrice = assertIntervalAvailable(plan, target);
  if (sub.provider === "whop") assertWhop();
  else assertDevBilling();

  // Retour à l'offre actuelle : annulation du changement programmé.
  if (sub.planId === plan.id && sub.billingInterval === target) {
    if (!sub.pendingPlanId && !sub.pendingBillingInterval) throw new DomainError("SAME_PLAN", "Vous êtes déjà sur cette offre.");
    await cancelScheduledChange(actor, customerId, sub);
    return { mode: "canceled" };
  }

  // Passage de l'annuel au mensuel : à l'échéance.
  if (sub.billingInterval === "YEARLY" && target === "MONTHLY") {
    if (sub.provider === "whop" && !sub.cancelAtPeriodEnd) await cancelMembershipAtPeriodEnd(sub.externalId);
    await withEffects(async (tx, fx) => {
      await tx.subscription.update({
        where: { id: sub.id },
        data: { cancelAtPeriodEnd: true, canceledAt: new Date(), pendingPlanId: plan.id, pendingBillingInterval: "MONTHLY", pendingSyncedAt: null },
      });
      await audit({ actor, action: "subscription.interval_change_scheduled", entityType: "customer", entityId: customerId, summary: `${sub.plan.name} annuel → ${plan.name} mensuel` }, tx);
      fx.notify(actor.userId, {
        type: "SUBSCRIPTION_UPDATED",
        title: "Passage au mensuel programmé",
        body: `Votre formule annuelle ${sub.plan.name} continue jusqu'à son échéance${sub.currentPeriodEnd ? ` (${sub.currentPeriodEnd.toLocaleDateString("fr-FR")})` : ""}, avec ses crédits chaque mois. Vous pourrez ensuite activer la formule mensuelle ${plan.name} en un clic.`,
        link: "/client/abonnement",
      });
    });
    return { mode: "scheduled", effectiveAt: sub.currentPeriodEnd };
  }

  const currentPrice = priceFor(sub.plan, sub.billingInterval) ?? sub.plan.priceCents;
  // Baisse, même périodicité : programmée au renouvellement.
  if (sub.billingInterval === target && targetPrice < currentPrice) {
    const dueSoon = !!sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() - Date.now() <= PENDING_CHANGE_LEAD_DAYS * 86_400_000;
    if (sub.provider === "whop" && dueSoon) await updateMembership(sub.externalId, { renewal_price: toMajor(targetPrice) });
    await withEffects(async (tx, fx) => {
      await tx.subscription.update({
        where: { id: sub.id },
        data: { pendingPlanId: plan.id, pendingBillingInterval: null, pendingSyncedAt: sub.provider === "whop" && dueSoon ? new Date() : null },
      });
      await audit({ actor, action: "subscription.plan_change_scheduled", entityType: "customer", entityId: customerId, summary: `${sub.plan.name} → ${plan.name}` }, tx);
      fx.notify(actor.userId, {
        type: "SUBSCRIPTION_UPDATED",
        title: "Changement d'offre programmé",
        body: `Votre abonnement passera à l'offre ${plan.name} au prochain renouvellement : vous recevrez alors ${plan.monthlyCredits} crédits par mois.`,
        link: "/client/facturation",
      });
    });
    return { mode: "scheduled", effectiveAt: sub.currentPeriodEnd };
  }

  // Montée en gamme ou passage à l'annuel : nouveau paiement immédiat.
  if (sub.provider === "dev") {
    return { mode: "checkout", url: `/paiement-demo?type=changement&offre=${plan.id}&periodicite=${intervalParam(target)}` };
  }
  const { url } = await createSubscriptionCheckout({ customerId, plan, interval: target, replaces: sub.externalId, redirectPath: "/client/abonnement?changement=confirme" });
  return { mode: "checkout", url };
}

type ActiveSub = NonNullable<Awaited<ReturnType<typeof getActiveSubscription>>>;

async function cancelScheduledChange(actor: Actor, customerId: string, sub: ActiveSub) {
  if (sub.pendingBillingInterval) {
    // Annuel → mensuel annulé : le renouvellement annuel est réactivé.
    if (sub.provider === "whop") await updateMembership(sub.externalId, { cancel_at_period_end: false });
  } else if (sub.pendingSyncedAt && sub.provider === "whop") {
    throw new DomainError(
      "CHANGE_LOCKED",
      "Le changement a déjà été transmis à Whop pour l'échéance toute proche et ne peut plus être annulé. Vous pourrez repasser à votre offre actuelle après le renouvellement.",
    );
  }
  await withEffects(async (tx, fx) => {
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        pendingPlanId: null,
        pendingBillingInterval: null,
        pendingSyncedAt: null,
        ...(sub.pendingBillingInterval ? { cancelAtPeriodEnd: false, canceledAt: null } : {}),
      },
    });
    await audit({ actor, action: "subscription.plan_change_canceled", entityType: "customer", entityId: customerId, summary: sub.plan.name }, tx);
    fx.notify(actor.userId, {
      type: "SUBSCRIPTION_UPDATED",
      title: "Changement d'offre annulé",
      body: `Votre abonnement reste sur l'offre ${sub.plan.name}${sub.billingInterval === "YEARLY" ? " (formule annuelle)" : ""}.`,
      link: "/client/facturation",
    });
  });
}

/**
 * Transmet à Whop les baisses de prix programmées dont l'échéance approche
 * (tâche planifiée « credits »). Avant cela, le client peut encore annuler.
 */
export async function pushPendingPlanChanges(now = new Date()) {
  if (!isWhopConfigured()) return { pushed: 0, failed: 0 };
  const due = await db.subscription.findMany({
    where: {
      provider: "whop",
      status: { in: ["ACTIVE", "TRIALING"] },
      pendingPlanId: { not: null },
      pendingBillingInterval: null,
      pendingSyncedAt: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: { lte: addDays(now, PENDING_CHANGE_LEAD_DAYS) },
    },
    include: { pendingPlan: true },
    take: 200,
  });
  let pushed = 0;
  let failed = 0;
  for (const sub of due) {
    const price = sub.pendingPlan ? priceFor(sub.pendingPlan, sub.billingInterval) : null;
    if (price === null) continue;
    try {
      await updateMembership(sub.externalId, { renewal_price: toMajor(price) });
      await db.subscription.update({ where: { id: sub.id }, data: { pendingSyncedAt: new Date() } });
      pushed++;
    } catch (err) {
      failed++;
      console.error(`[whop] Changement d'offre non transmis pour ${sub.externalId}`, err);
    }
  }
  return { pushed, failed };
}

/** Tâche planifiée « credits » : crédits mensuels de la formule annuelle et changements programmés. */
export async function runBillingSchedule(now = new Date()) {
  const [annual, changes] = [await grantDueAnnualCredits(now), await pushPendingPlanChanges(now)];
  return { ...annual, pendingChanges: changes };
}

export async function setCancelAtPeriodEnd(actor: Actor, cancel: boolean) {
  const customerId = assertCustomer(actor);
  const sub = await getActiveSubscription(customerId);
  if (!sub) throw new DomainError("NO_SUBSCRIPTION", "Aucun abonnement actif.");
  if (sub.supersededAt) throw new DomainError("SUPERSEDED", "Cette offre a été remplacée et ne sera pas renouvelée.");
  if (cancel && sub.pendingSyncedAt && sub.provider === "whop") {
    throw new DomainError("CHANGE_LOCKED", "Un changement d'offre vient d'être transmis à Whop pour l'échéance toute proche : résiliez après le renouvellement, ou contactez le support.");
  }
  // Résilier ou réactiver le renouvellement remplace tout changement programmé.
  if (sub.pendingPlanId || sub.pendingBillingInterval) {
    await db.subscription.update({ where: { id: sub.id }, data: { pendingPlanId: null, pendingBillingInterval: null, pendingSyncedAt: null } });
  }
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

const periodEndFor = (start: Date, interval: BillingIntervalValue) => (interval === "YEARLY" ? addYears(start, 1) : addMonths(start, 1));

/**
 * Paiement de démonstration d'une souscription. Avec `change`, il s'agit d'un
 * changement d'offre immédiat : la souscription actuelle est remplacée.
 */
export async function devCompleteSubscription(actor: Actor, planId: string, interval: BillingIntervalValue = "MONTHLY", opts?: { change?: boolean }) {
  assertDevBilling();
  const customerId = assertCustomer(actor);
  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) throw new DomainError("PLAN", "Offre indisponible.");
  const price = assertIntervalAvailable(plan, interval);
  const current = await getActiveSubscription(customerId);
  if (opts?.change) {
    if (!current) throw new DomainError("NO_SUBSCRIPTION", "Aucun abonnement actif à modifier.");
    if (current.planId === plan.id && current.billingInterval === interval) throw new DomainError("SAME_PLAN", "Vous êtes déjà sur cette offre.");
  } else if (current) {
    throw new DomainError("ALREADY_SUBSCRIBED", "Abonnement déjà actif.");
  }
  const now = new Date();
  const end = periodEndFor(now, interval);
  const externalId = `dev_mem_${randomCode(14)}`;
  await withEffects(async (tx, fx) => {
    await syncSubscription(tx, fx, { customerId, planId, provider: "dev", externalId, status: "ACTIVE", periodStart: now, periodEnd: end, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null, billingInterval: interval });
    await onInvoicePaid(tx, fx, devInvoice({ customerId, subscriptionExternalId: externalId, billingReason: "subscription_create", amountCents: price, currency: plan.currency, periodStart: now, periodEnd: end, planId, paid: true }));
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

/**
 * Simule l'échéance de la souscription principale : renouvellement (offre
 * programmée appliquée, crédits), ou fin de la formule annuelle si le passage
 * au mensuel a été demandé ou la résiliation programmée.
 */
export async function devSimulateRenewal(customerId: string) {
  assertDevBilling();
  const sub = await getActiveSubscription(customerId);
  if (!sub || sub.provider !== "dev") throw new DomainError("NO_DEV_SUB", "Aucun abonnement de démonstration actif.");
  const start = sub.currentPeriodEnd ?? new Date();
  const end = periodEndFor(start, sub.billingInterval);
  // Les offres remplacées dont la période se termine d'ici là prennent fin.
  const ending = await db.subscription.findMany({
    where: { customerId, provider: "dev", id: { not: sub.id }, supersededAt: { not: null }, status: { in: ["ACTIVE", "TRIALING"] }, currentPeriodEnd: { lte: sub.cancelAtPeriodEnd ? start : end } },
  });
  for (const old of ending) {
    await withEffects((tx, fx) =>
      syncSubscription(tx, fx, { customerId, planId: old.planId, provider: "dev", externalId: old.externalId, status: "CANCELED", periodStart: old.currentPeriodStart, periodEnd: old.currentPeriodEnd, cancelAtPeriodEnd: true, canceledAt: old.canceledAt ?? new Date(), endedAt: old.currentPeriodEnd }),
    );
  }
  if (sub.cancelAtPeriodEnd) {
    await withEffects((tx, fx) =>
      syncSubscription(tx, fx, { customerId, planId: sub.planId, provider: "dev", externalId: sub.externalId, status: "CANCELED", periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: true, canceledAt: sub.canceledAt ?? new Date(), endedAt: start }),
    );
    return;
  }
  const renewalPlan = sub.pendingPlanId ? await db.plan.findUniqueOrThrow({ where: { id: sub.pendingPlanId } }) : sub.plan;
  const amount = priceFor(renewalPlan, sub.billingInterval) ?? renewalPlan.priceCents;
  await withEffects(async (tx, fx) => {
    await syncSubscription(tx, fx, { customerId, planId: sub.planId, provider: "dev", externalId: sub.externalId, status: "ACTIVE", periodStart: start, periodEnd: end, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, canceledAt: sub.canceledAt, endedAt: null });
    await onInvoicePaid(tx, fx, devInvoice({ customerId, subscriptionExternalId: sub.externalId, billingReason: "subscription_cycle", amountCents: amount, currency: renewalPlan.currency, periodStart: start, periodEnd: end, planId: renewalPlan.id, paid: true }));
  });
}

/**
 * Formule annuelle (démonstration) : avance le calendrier d'un mois pour
 * verser immédiatement les crédits du mois suivant.
 */
export async function devAdvanceAnnualMonth(customerId: string) {
  assertDevBilling();
  const subs = await db.subscription.findMany({
    where: { customerId, provider: "dev", billingInterval: "YEARLY", status: { in: ["ACTIVE", "TRIALING"] }, nextCreditGrantAt: { not: null } },
    select: { id: true },
  });
  if (!subs.length) throw new DomainError("NO_ANNUAL", "Aucune formule annuelle de démonstration avec des crédits à venir.");
  const now = new Date();
  await db.subscription.updateMany({ where: { id: { in: subs.map((s) => s.id) } }, data: { nextCreditGrantAt: now } });
  return grantDueAnnualCredits(now);
}

export async function devSimulatePaymentFailure(customerId: string) {
  assertDevBilling();
  const sub = await getActiveSubscription(customerId);
  if (!sub || sub.provider !== "dev") throw new DomainError("NO_DEV_SUB", "Aucun abonnement de démonstration actif.");
  await withEffects(async (tx, fx) => {
    await syncSubscription(tx, fx, { customerId, planId: sub.planId, provider: "dev", externalId: sub.externalId, status: "PAST_DUE", periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, canceledAt: null, endedAt: null });
    await onInvoicePaymentFailed(tx, fx, {
      ...devInvoice({ customerId, subscriptionExternalId: sub.externalId, billingReason: "subscription_cycle", amountCents: priceFor(sub.plan, sub.billingInterval) ?? sub.plan.priceCents, currency: sub.plan.currency, periodStart: sub.currentPeriodEnd, periodEnd: sub.currentPeriodEnd ? periodEndFor(sub.currentPeriodEnd, sub.billingInterval) : null, planId: sub.planId, paid: false }),
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

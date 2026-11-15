import "server-only";
import { addMonths } from "date-fns";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { DomainError, NotFoundError } from "@/server/errors";
import { assertAdmin, assertCustomer, type Actor } from "@/server/auth/actor";
import { randomCode } from "@/server/lib/ids";
import { audit } from "@/server/services/audit";
import { withEffects } from "@/server/services/notifications";
import { debitCredits } from "@/server/services/credits";
import { getActiveSubscription } from "@/server/services/customers";
import { onCreditPackPaid, onInvoicePaid, onInvoicePaymentFailed, onPaymentRefunded, syncSubscription } from "@/server/services/billing";
import { asObj, getStripe, idOf, isStripeConfigured, mapSubscriptionStatus, subscriptionPeriod, toDate } from "./stripe";

/**
 * Façade de facturation : Stripe Billing en production ; mode de paiement de
 * démonstration (aucun encaissement) uniquement si BILLING_MODE=dev hors
 * production.
 */

export function billingMode() {
  return env.billingMode;
}

function assertDevBilling() {
  if (env.billingMode !== "dev") throw new DomainError("DEV_ONLY", "Le mode de paiement de démonstration est désactivé.");
}

function assertStripe() {
  if (!isStripeConfigured()) throw new DomainError("STRIPE_NOT_CONFIGURED", "Le paiement en ligne n'est pas encore configuré. Contactez le support.");
  return getStripe();
}

async function ensureStripeCustomer(customerId: string) {
  const customer = await db.customerProfile.findUniqueOrThrow({ where: { id: customerId }, include: { user: true } });
  if (customer.stripeCustomerId) return customer.stripeCustomerId;
  const stripe = assertStripe();
  const created = await stripe.customers.create(
    {
      email: customer.user.email,
      name: customer.companyName || `${customer.user.firstName} ${customer.user.lastName}`,
      phone: customer.user.phone ?? undefined,
      preferred_locales: ["fr"],
      metadata: { packio_customer_id: customer.id, packio_reference: customer.referenceCode },
    },
    { idempotencyKey: `customer:${customer.id}` },
  );
  await db.customerProfile.update({ where: { id: customer.id }, data: { stripeCustomerId: created.id } });
  return created.id;
}

/** Crée (ou met à jour) le produit et le prix Stripe d'une offre. */
export async function syncPlanWithStripe(actor: Actor | null, planId: string) {
  if (actor) assertAdmin(actor, "billing.manage");
  const stripe = assertStripe();
  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new NotFoundError("Offre introuvable.");
  let productId = plan.stripeProductId;
  if (!productId) {
    productId = (await stripe.products.create({ name: `Packio ${plan.name}`, description: plan.tagline ?? undefined, metadata: { plan_id: plan.id, plan_code: plan.code } })).id;
  } else {
    await stripe.products.update(productId, { name: `Packio ${plan.name}`, active: plan.isActive });
  }
  let priceId = plan.stripePriceId;
  let needsPrice = !priceId;
  if (priceId) {
    const price = await stripe.prices.retrieve(priceId);
    needsPrice = price.unit_amount !== plan.priceCents || price.currency !== plan.currency || !price.active;
  }
  if (needsPrice) {
    const price = await stripe.prices.create({
      product: productId,
      unit_amount: plan.priceCents,
      currency: plan.currency,
      recurring: { interval: "month" },
      tax_behavior: "inclusive",
      metadata: { plan_id: plan.id },
    });
    if (priceId) await stripe.prices.update(priceId, { active: false }).catch(() => undefined);
    priceId = price.id;
  }
  const updated = await db.plan.update({ where: { id: plan.id }, data: { stripeProductId: productId, stripePriceId: priceId } });
  if (actor) await audit({ actor, action: "plan.stripe_sync", entityType: "plan", entityId: plan.id, summary: priceId ?? undefined });
  return updated;
}

export async function startSubscriptionCheckout(actor: Actor, planId: string): Promise<{ url: string }> {
  const customerId = assertCustomer(actor);
  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) throw new DomainError("PLAN", "Cette offre n'est pas disponible.");
  const current = await getActiveSubscription(customerId);
  if (current) throw new DomainError("ALREADY_SUBSCRIBED", "Vous avez déjà un abonnement actif : utilisez le changement d'offre.");

  if (env.billingMode === "dev") return { url: `/paiement-demo?type=abonnement&offre=${plan.id}` };

  const stripe = assertStripe();
  const priced = plan.stripePriceId ? plan : await syncPlanWithStripe(null, plan.id);
  const stripeCustomer = await ensureStripeCustomer(customerId);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: stripeCustomer,
    client_reference_id: customerId,
    line_items: [{ price: priced.stripePriceId!, quantity: 1 }],
    allow_promotion_codes: true,
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    tax_id_collection: { enabled: true },
    locale: "fr",
    metadata: { packio_customer_id: customerId, plan_id: plan.id },
    subscription_data: { metadata: { packio_customer_id: customerId, plan_id: plan.id } },
    ...(env.stripeTaxEnabled ? { automatic_tax: { enabled: true } } : {}),
    success_url: `${env.appUrl}/client?abonnement=confirme`,
    cancel_url: `${env.appUrl}/client/abonnement?paiement=annule`,
  });
  if (!session.url) throw new Error("Session Checkout sans URL");
  return { url: session.url };
}

export async function startCreditPackCheckout(actor: Actor, packId: string): Promise<{ url: string }> {
  const customerId = assertCustomer(actor);
  const pack = await db.creditPack.findUnique({ where: { id: packId } });
  if (!pack || !pack.isActive) throw new DomainError("PACK", "Cette recharge n'est pas disponible.");
  const sub = await getActiveSubscription(customerId);
  if (!sub) throw new DomainError("NO_SUBSCRIPTION", "Un abonnement actif est nécessaire pour acheter des crédits.");

  if (env.billingMode === "dev") return { url: `/paiement-demo?type=credits&pack=${pack.id}` };

  const stripe = assertStripe();
  const stripeCustomer = await ensureStripeCustomer(customerId);
  const metadata = { kind: "credit_pack", pack_id: pack.id, credits: String(pack.credits), packio_customer_id: customerId };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomer,
    client_reference_id: customerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: pack.currency,
          unit_amount: pack.priceCents,
          tax_behavior: "inclusive",
          product_data: { name: `Packio — ${pack.name} (${pack.credits} crédits)` },
        },
      },
    ],
    allow_promotion_codes: true,
    invoice_creation: { enabled: true },
    locale: "fr",
    metadata,
    payment_intent_data: { metadata },
    ...(env.stripeTaxEnabled ? { automatic_tax: { enabled: true } } : {}),
    success_url: `${env.appUrl}/client/credits?recharge=confirmee`,
    cancel_url: `${env.appUrl}/client/credits?recharge=annulee`,
  });
  if (!session.url) throw new Error("Session Checkout sans URL");
  return { url: session.url };
}

export async function openBillingPortal(actor: Actor): Promise<{ url: string }> {
  const customerId = assertCustomer(actor);
  if (env.billingMode === "dev") return { url: "/client/facturation?portail=demo" };
  const stripe = assertStripe();
  const stripeCustomer = await ensureStripeCustomer(customerId);
  const session = await stripe.billingPortal.sessions.create({ customer: stripeCustomer, return_url: `${env.appUrl}/client/facturation`, locale: "fr" });
  return { url: session.url };
}

async function syncFromStripe(subObj: unknown, customerId: string, planId: string) {
  const sub = asObj(subObj);
  const period = subscriptionPeriod(sub);
  const status = mapSubscriptionStatus(sub.status);
  await withEffects((tx, fx) =>
    syncSubscription(tx, fx, {
      customerId,
      planId,
      provider: "stripe",
      externalId: String(sub.id),
      status,
      periodStart: period.start,
      periodEnd: period.end,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end || (!!sub.cancel_at && status !== "CANCELED"),
      canceledAt: toDate(sub.canceled_at),
      endedAt: toDate(sub.ended_at),
    }),
  );
}

/** Changement d'offre : hausse immédiate (prorata facturé), baisse sans prorata. */
export async function changePlan(actor: Actor, planId: string) {
  const customerId = assertCustomer(actor);
  const [sub, plan] = await Promise.all([getActiveSubscription(customerId), db.plan.findUnique({ where: { id: planId } })]);
  if (!sub) throw new DomainError("NO_SUBSCRIPTION", "Aucun abonnement actif.");
  if (!plan || !plan.isActive) throw new DomainError("PLAN", "Offre indisponible.");
  if (sub.planId === plan.id) throw new DomainError("SAME_PLAN", "Vous êtes déjà sur cette offre.");
  if (sub.status === "PAST_DUE") throw new DomainError("PAST_DUE", "Régularisez votre paiement avant de changer d'offre.");
  const upgrade = plan.priceCents > sub.plan.priceCents;

  if (sub.provider === "dev") {
    assertDevBilling();
    await withEffects((tx, fx) =>
      syncSubscription(tx, fx, {
        customerId,
        planId: plan.id,
        provider: "dev",
        externalId: sub.externalId,
        status: sub.status,
        periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        canceledAt: sub.canceledAt,
        endedAt: sub.endedAt,
      }),
    );
    return { upgrade };
  }
  const stripe = assertStripe();
  const priced = plan.stripePriceId ? plan : await syncPlanWithStripe(null, plan.id);
  const current = await stripe.subscriptions.retrieve(sub.externalId);
  const itemId = current.items.data[0]?.id;
  if (!itemId) throw new Error("Abonnement Stripe sans élément");
  const updated = await stripe.subscriptions.update(sub.externalId, {
    items: [{ id: itemId, price: priced.stripePriceId! }],
    proration_behavior: upgrade ? "always_invoice" : "none",
    ...(upgrade ? { payment_behavior: "error_if_incomplete" as const } : {}),
    metadata: { packio_customer_id: customerId, plan_id: plan.id },
  });
  await syncFromStripe(updated, customerId, plan.id);
  return { upgrade };
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
    const stripe = assertStripe();
    const updated = await stripe.subscriptions.update(sub.externalId, { cancel_at_period_end: cancel });
    await syncFromStripe(updated, customerId, sub.planId);
  }
  await audit({ actor, action: cancel ? "subscription.cancel_requested" : "subscription.cancel_reverted", entityType: "customer", entityId: customerId });
}

/** Remboursement (total ou partiel) d'un paiement, avec retrait optionnel des crédits achetés. */
export async function refundPayment(actor: Actor, input: { paymentId: string; amountCents?: number | null; removeCredits: boolean; reason: string }) {
  assertAdmin(actor, "billing.manage");
  if (input.reason.trim().length < 5) throw new DomainError("REASON", "Justification obligatoire.");
  const payment = await db.payment.findUnique({ where: { id: input.paymentId }, include: { invoice: true } });
  if (!payment) throw new NotFoundError("Paiement introuvable.");
  if (payment.status !== "SUCCEEDED" && payment.status !== "PARTIALLY_REFUNDED") throw new DomainError("STATUS", "Ce paiement ne peut pas être remboursé.");
  const remaining = payment.amountCents - payment.refundedCents;
  const amount = input.amountCents ?? remaining;
  if (amount <= 0 || amount > remaining) throw new DomainError("AMOUNT", `Montant invalide (maximum ${(remaining / 100).toFixed(2)} €).`);

  if (payment.provider === "stripe") {
    const stripe = assertStripe();
    let paymentIntent = payment.paymentIntentId;
    if (!paymentIntent && payment.invoice) {
      const list = await stripe.invoicePayments.list({ invoice: payment.invoice.externalId, limit: 5 });
      paymentIntent = list.data.map((p) => idOf(asObj(p.payment).payment_intent)).find(Boolean) ?? null;
    }
    if (!paymentIntent) throw new DomainError("NO_INTENT", "Impossible de retrouver le paiement Stripe correspondant.");
    await stripe.refunds.create(
      { payment_intent: paymentIntent, amount, reason: "requested_by_customer", metadata: { packio_payment_id: payment.id } },
      { idempotencyKey: `refund:${payment.id}:${payment.refundedCents}:${amount}` },
    );
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

export async function createPromotionCode(
  actor: Actor,
  input: { code: string; percentOff?: number | null; amountOffCents?: number | null; duration: "once" | "repeating" | "forever"; durationInMonths?: number | null; maxRedemptions?: number | null; expiresAt?: Date | null },
) {
  assertAdmin(actor, "billing.manage");
  const stripe = assertStripe();
  if (!input.percentOff && !input.amountOffCents) throw new DomainError("VALUE", "Indiquez une remise en % ou en euros.");
  const coupon = await stripe.coupons.create({
    name: input.code,
    ...(input.percentOff ? { percent_off: input.percentOff } : { amount_off: input.amountOffCents!, currency: "eur" }),
    duration: input.duration,
    ...(input.duration === "repeating" ? { duration_in_months: input.durationInMonths ?? 1 } : {}),
  });
  const promo = await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: coupon.id },
    code: input.code.toUpperCase(),
    ...(input.maxRedemptions ? { max_redemptions: input.maxRedemptions } : {}),
    ...(input.expiresAt ? { expires_at: Math.floor(input.expiresAt.getTime() / 1000) } : {}),
  });
  await audit({ actor, action: "promotion_code.created", entityType: "promotion_code", entityId: promo.id, summary: input.code.toUpperCase() });
  return promo;
}

export async function listPromotionCodes(actor: Actor) {
  assertAdmin(actor, "billing.read");
  if (!isStripeConfigured()) return null;
  const stripe = getStripe();
  const list = await stripe.promotionCodes.list({ limit: 50, expand: ["data.promotion.coupon"] });
  return list.data.map((p) => {
    const coupon = asObj(asObj(asObj(p).promotion).coupon);
    return {
      id: p.id,
      code: p.code,
      active: p.active,
      timesRedeemed: p.times_redeemed,
      maxRedemptions: p.max_redemptions,
      expiresAt: toDate(p.expires_at),
      percentOff: typeof coupon.percent_off === "number" ? coupon.percent_off : null,
      amountOff: typeof coupon.amount_off === "number" ? coupon.amount_off : null,
      duration: typeof coupon.duration === "string" ? coupon.duration : null,
    };
  });
}

export async function setPromotionCodeActive(actor: Actor, id: string, active: boolean) {
  assertAdmin(actor, "billing.manage");
  await assertStripe().promotionCodes.update(id, { active });
  await audit({ actor, action: active ? "promotion_code.activated" : "promotion_code.deactivated", entityType: "promotion_code", entityId: id });
}

// -----------------------------------------------------------------------------
// Mode de paiement de démonstration (développement uniquement)
// -----------------------------------------------------------------------------

export async function devCompleteSubscription(actor: Actor, planId: string) {
  assertDevBilling();
  const customerId = assertCustomer(actor);
  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) throw new DomainError("PLAN", "Offre indisponible.");
  if (await getActiveSubscription(customerId)) throw new DomainError("ALREADY_SUBSCRIBED", "Abonnement déjà actif.");
  const now = new Date();
  const end = addMonths(now, 1);
  const externalId = `dev_sub_${randomCode(14)}`;
  await withEffects(async (tx, fx) => {
    await syncSubscription(tx, fx, { customerId, planId, provider: "dev", externalId, status: "ACTIVE", periodStart: now, periodEnd: end, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null });
    await onInvoicePaid(tx, fx, {
      externalId: `dev_in_${randomCode(14)}`,
      customerId,
      subscriptionExternalId: externalId,
      number: `DEMO-${randomCode(6)}`,
      status: "paid",
      billingReason: "subscription_create",
      amountDueCents: plan.priceCents,
      amountPaidCents: plan.priceCents,
      currency: plan.currency,
      hostedUrl: null,
      pdfUrl: null,
      periodStart: now,
      periodEnd: end,
      issuedAt: now,
      planId,
      paymentIntentId: null,
      provider: "dev",
    });
  });
}

export async function devCompleteCreditPack(actor: Actor, packId: string) {
  assertDevBilling();
  const customerId = assertCustomer(actor);
  const pack = await db.creditPack.findUnique({ where: { id: packId } });
  if (!pack || !pack.isActive) throw new DomainError("PACK", "Recharge indisponible.");
  await withEffects((tx, fx) =>
    onCreditPackPaid(tx, fx, {
      customerId,
      packId: pack.id,
      credits: pack.credits,
      amountCents: pack.priceCents,
      currency: pack.currency,
      externalId: `dev_cs_${randomCode(14)}`,
      paymentIntentId: null,
      provider: "dev",
      description: `Recharge ${pack.name} (${pack.credits} crédits)`,
    }),
  );
}

/** Simule le renouvellement mensuel (nouvelle période + allocation de crédits). */
export async function devSimulateRenewal(customerId: string) {
  assertDevBilling();
  const sub = await getActiveSubscription(customerId);
  if (!sub || sub.provider !== "dev") throw new DomainError("NO_DEV_SUB", "Aucun abonnement de démonstration actif.");
  const start = sub.currentPeriodEnd ?? new Date();
  const end = addMonths(start, 1);
  await withEffects(async (tx, fx) => {
    await syncSubscription(tx, fx, { customerId, planId: sub.planId, provider: "dev", externalId: sub.externalId, status: "ACTIVE", periodStart: start, periodEnd: end, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, canceledAt: sub.canceledAt, endedAt: null });
    await onInvoicePaid(tx, fx, {
      externalId: `dev_in_${randomCode(14)}`,
      customerId,
      subscriptionExternalId: sub.externalId,
      number: `DEMO-${randomCode(6)}`,
      status: "paid",
      billingReason: "subscription_cycle",
      amountDueCents: sub.plan.priceCents,
      amountPaidCents: sub.plan.priceCents,
      currency: sub.plan.currency,
      hostedUrl: null,
      pdfUrl: null,
      periodStart: start,
      periodEnd: end,
      issuedAt: new Date(),
      planId: sub.planId,
      paymentIntentId: null,
      provider: "dev",
    });
  });
}

export async function devSimulatePaymentFailure(customerId: string) {
  assertDevBilling();
  const sub = await getActiveSubscription(customerId);
  if (!sub || sub.provider !== "dev") throw new DomainError("NO_DEV_SUB", "Aucun abonnement de démonstration actif.");
  await withEffects(async (tx, fx) => {
    await syncSubscription(tx, fx, { customerId, planId: sub.planId, provider: "dev", externalId: sub.externalId, status: "PAST_DUE", periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, canceledAt: null, endedAt: null });
    await onInvoicePaymentFailed(tx, fx, {
      externalId: `dev_in_${randomCode(14)}`,
      customerId,
      subscriptionExternalId: sub.externalId,
      number: `DEMO-${randomCode(6)}`,
      status: "open",
      billingReason: "subscription_cycle",
      amountDueCents: sub.plan.priceCents,
      amountPaidCents: 0,
      currency: sub.plan.currency,
      hostedUrl: null,
      pdfUrl: null,
      periodStart: sub.currentPeriodEnd,
      periodEnd: sub.currentPeriodEnd ? addMonths(sub.currentPeriodEnd, 1) : null,
      issuedAt: new Date(),
      planId: sub.planId,
      paymentIntentId: null,
      provider: "dev",
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

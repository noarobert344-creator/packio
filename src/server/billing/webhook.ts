import type { BillingInterval } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { isUniqueViolation } from "@/server/errors";
import { withEffects } from "@/server/services/notifications";
import {
  onCreditPackPaid,
  onInvoicePaid,
  onInvoicePaymentFailed,
  onPaymentRefunded,
  syncSubscription,
  type InvoiceSnapshot,
} from "@/server/services/billing";
import { asObj, currencyOf, idOf, mapMembershipStatus, metadataOf, toCents, toDate } from "./whop";

/**
 * Traitement des webhooks Whop (la signature est vérifiée en amont par la
 * route). Chaque événement est journalisé dans webhook_events : un événement
 * déjà traité est ignoré, un événement en échec est retraité lorsque Whop le
 * renvoie (jusqu'à ~12 tentatives sur 71 h).
 *
 * Événements gérés :
 *  - payment.succeeded  → abonnement (premier paiement / renouvellement) ou recharge
 *  - payment.failed     → échec de paiement d'abonnement
 *  - membership.activated / membership.updated → statut, période, résiliation programmée
 *  - refund.created / refund.updated → montant remboursé (relu sur le paiement)
 */

export type WebhookEvent = { id: string; type: string; data: unknown };
export type WebhookDeps = {
  retrieveMembership: (id: string) => Promise<unknown>;
  retrievePayment: (id: string) => Promise<unknown>;
};
export type WebhookOutcome = "processed" | "ignored" | "duplicate";

export class RetryLaterError extends Error {}

const STALE_PROCESSING_MS = 2 * 60 * 1000;

export async function handleWhopEvent(event: WebhookEvent, deps: WebhookDeps): Promise<WebhookOutcome> {
  let record = await db.webhookEvent.findUnique({ where: { id: event.id } });
  if (record && (record.status === "PROCESSED" || record.status === "IGNORED")) return "duplicate";
  if (record && record.status === "PROCESSING" && Date.now() - record.receivedAt.getTime() < STALE_PROCESSING_MS) {
    throw new RetryLaterError("Événement déjà en cours de traitement");
  }
  if (!record) {
    try {
      record = await db.webhookEvent.create({ data: { id: event.id, provider: "whop", type: event.type, status: "PROCESSING" } });
    } catch (err) {
      if (isUniqueViolation(err)) throw new RetryLaterError("Traitement concurrent");
      throw err;
    }
  } else {
    await db.webhookEvent.update({ where: { id: event.id }, data: { status: "PROCESSING", attempts: { increment: 1 }, receivedAt: new Date(), error: null } });
  }

  try {
    const handled = await dispatch(event, deps);
    await db.webhookEvent.update({ where: { id: event.id }, data: { status: handled ? "PROCESSED" : "IGNORED", processedAt: new Date() } });
    return handled ? "processed" : "ignored";
  } catch (err) {
    await db.webhookEvent.update({
      where: { id: event.id },
      data: { status: "FAILED", error: String(err instanceof Error ? err.message : err).slice(0, 1000) },
    });
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Résolution du contexte Packio (client, type d'achat, offre)
// -----------------------------------------------------------------------------

type Context = {
  customerId: string | null;
  kind: "subscription" | "credit_pack" | null;
  meta: Record<string, string>;
  membershipId: string | null;
  membership: Record<string, unknown> | null;
};

async function customerExists(id: string | undefined) {
  if (!id) return null;
  const c = await db.customerProfile.findUnique({ where: { id }, select: { id: true } });
  return c?.id ?? null;
}

async function resolveContext(obj: unknown, deps: WebhookDeps, opts: { isMembership?: boolean; fetchMembership?: boolean } = {}): Promise<Context> {
  const o = asObj(obj);
  const membershipId = opts.isMembership ? idOf(o) : (idOf(o.membership_id) ?? idOf(o.membership));
  let meta = metadataOf(o);
  let membership: Record<string, unknown> | null = opts.isMembership ? o : null;
  if (!opts.isMembership && membershipId && (opts.fetchMembership || !meta.kind || !meta.packio_customer_id)) {
    membership = asObj(await deps.retrieveMembership(membershipId));
    meta = { ...metadataOf(membership), ...meta };
  }
  const existing = membershipId ? await db.subscription.findUnique({ where: { externalId: membershipId }, select: { customerId: true } }) : null;
  let customerId = (await customerExists(meta.packio_customer_id)) ?? existing?.customerId ?? null;
  const userId = idOf(o.user) ?? (typeof o.user_id === "string" ? o.user_id : null) ?? (membership ? (idOf(membership.user) ?? (membership.user_id as string | null) ?? null) : null);
  if (!customerId && userId) {
    customerId = (await db.customerProfile.findUnique({ where: { billingCustomerId: userId }, select: { id: true } }))?.id ?? null;
  }
  if (customerId && userId) {
    await db.customerProfile.updateMany({ where: { id: customerId, billingCustomerId: null }, data: { billingCustomerId: userId } }).catch(() => undefined);
  }
  const kind = meta.kind === "subscription" || meta.kind === "credit_pack" ? meta.kind : existing ? "subscription" : null;
  return { customerId, kind, meta, membershipId, membership };
}

async function resolvePlanId(ctx: Context, variantId: string | null): Promise<string | null> {
  if (ctx.membershipId) {
    const sub = await db.subscription.findUnique({ where: { externalId: ctx.membershipId }, select: { planId: true } });
    if (sub) return sub.planId;
  }
  if (ctx.meta.plan_id) {
    const plan = await db.plan.findUnique({ where: { id: ctx.meta.plan_id }, select: { id: true } });
    if (plan) return plan.id;
  }
  if (variantId) {
    const plan = await db.plan.findFirst({ where: { OR: [{ whopPlanId: variantId }, { whopAnnualPlanId: variantId }] }, select: { id: true } });
    if (plan) return plan.id;
  }
  return null;
}

/**
 * Périodicité d'une nouvelle adhésion : métadonnées Packio, plan Whop annuel
 * configuré, ou à défaut durée de la période (plus de 60 jours = annuelle).
 */
async function resolveInterval(ctx: Context, membership: Record<string, unknown>): Promise<BillingInterval> {
  if (ctx.meta.billing_interval === "yearly") return "YEARLY";
  if (ctx.meta.billing_interval === "monthly") return "MONTHLY";
  const variantId = variantIdOf(membership);
  if (variantId && (await db.plan.findUnique({ where: { whopAnnualPlanId: variantId }, select: { id: true } }))) return "YEARLY";
  const start = toDate(membership.current_period_start) ?? toDate(membership.renewal_period_start);
  const end = toDate(membership.current_period_end) ?? toDate(membership.renewal_period_end);
  return start && end && end.getTime() - start.getTime() > 60 * 86_400_000 ? "YEARLY" : "MONTHLY";
}

function variantIdOf(o: Record<string, unknown>) {
  return idOf(o.variant_id) ?? idOf(o.plan_id) ?? idOf(o.variant) ?? idOf(o.plan);
}

async function syncMembership(membership: Record<string, unknown>, ctx: Context) {
  if (!ctx.customerId || !ctx.membershipId) throw new Error(`Abonnement ${ctx.membershipId ?? "?"} : client Packio introuvable`);
  const planId = await resolvePlanId(ctx, variantIdOf(membership));
  if (!planId) throw new Error(`Abonnement ${ctx.membershipId} : offre Packio introuvable`);
  const status = mapMembershipStatus(membership.status);
  const billingInterval = await resolveInterval(ctx, membership);
  await withEffects((tx, fx) =>
    syncSubscription(tx, fx, {
      customerId: ctx.customerId!,
      planId,
      billingInterval,
      provider: "whop",
      externalId: ctx.membershipId!,
      status,
      periodStart: toDate(membership.current_period_start) ?? toDate(membership.renewal_period_start),
      periodEnd: toDate(membership.current_period_end) ?? toDate(membership.renewal_period_end),
      cancelAtPeriodEnd: membership.cancel_at_period_end === true,
      canceledAt: toDate(membership.canceled_at),
      endedAt: status === "CANCELED" ? (toDate(membership.expires_at) ?? toDate(membership.canceled_at) ?? new Date()) : null,
    }),
  );
}

async function invoiceSnapshot(payment: Record<string, unknown>, ctx: Context, billingReason: string, planId: string | null): Promise<InvoiceSnapshot> {
  const membership = ctx.membership ?? {};
  const total = payment.total ?? payment.final_amount ?? payment.amount_charged ?? payment.subtotal;
  const amount = toCents(total);
  return {
    externalId: idOf(payment)!,
    customerId: ctx.customerId!,
    subscriptionExternalId: ctx.membershipId,
    number: idOf(payment),
    status: billingReason === "failed" ? "open" : "paid",
    billingReason: billingReason === "failed" ? null : billingReason,
    amountDueCents: amount,
    amountPaidCents: billingReason === "failed" ? 0 : amount,
    currency: currencyOf(total, typeof payment.currency === "string" ? payment.currency.toLowerCase() : "eur"),
    hostedUrl: null,
    pdfUrl: null,
    periodStart: toDate(membership.current_period_start),
    periodEnd: toDate(membership.current_period_end),
    issuedAt: toDate(payment.paid_at) ?? toDate(payment.created_at) ?? new Date(),
    planId,
    membershipId: ctx.membershipId,
    provider: "whop",
  };
}

// -----------------------------------------------------------------------------
// Aiguillage
// -----------------------------------------------------------------------------

async function dispatch(event: WebhookEvent, deps: WebhookDeps): Promise<boolean> {
  const data = asObj(event.data);
  switch (event.type) {
    case "payment.succeeded":
      return paymentSucceeded(data, deps);
    case "payment.failed":
      return paymentFailed(data, deps);
    case "membership.activated":
    case "membership.updated":
    case "membership.deactivated": {
      const ctx = await resolveContext(data, deps, { isMembership: true });
      if (ctx.kind !== "subscription") return false;
      await syncMembership(data, ctx);
      return true;
    }
    case "refund.created":
    case "refund.updated": {
      const paymentId = idOf(data.payment_id) ?? idOf(data.payment);
      if (!paymentId) return false;
      const payment = asObj(await deps.retrievePayment(paymentId));
      const result = await db.$transaction((tx) => onPaymentRefunded(tx, { externalId: paymentId, amountRefundedCents: toCents(payment.refunded_amount) }));
      return !!result;
    }
    default:
      return false;
  }
}

async function paymentSucceeded(payment: Record<string, unknown>, deps: WebhookDeps): Promise<boolean> {
  const paymentId = idOf(payment);
  if (!paymentId) return false;
  const ctx = await resolveContext(payment, deps, { fetchMembership: true });
  if (!ctx.kind) return false;
  if (!ctx.customerId) throw new Error(`Paiement ${paymentId} : client Packio introuvable`);

  if (ctx.kind === "credit_pack") {
    const credits = Number(ctx.meta.credits);
    if (!Number.isInteger(credits) || credits <= 0) throw new Error(`Paiement ${paymentId} : métadonnées de recharge invalides`);
    const pack = ctx.meta.pack_id ? await db.creditPack.findUnique({ where: { id: ctx.meta.pack_id }, select: { id: true, name: true } }) : null;
    const total = payment.total ?? payment.final_amount ?? payment.amount_charged;
    await withEffects((tx, fx) =>
      onCreditPackPaid(tx, fx, {
        customerId: ctx.customerId!,
        packId: pack?.id ?? null,
        credits,
        amountCents: toCents(total),
        currency: currencyOf(total),
        externalId: paymentId,
        membershipId: ctx.membershipId,
        provider: "whop",
        description: `Recharge de ${credits} crédits`,
      }),
    );
    return true;
  }

  // Abonnement : synchronisation puis allocation (premier paiement ou renouvellement).
  if (ctx.membership && ctx.membershipId) await syncMembership(ctx.membership, ctx);
  const previous = ctx.membershipId
    ? await db.payment.count({ where: { membershipId: ctx.membershipId, kind: "SUBSCRIPTION", status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] }, NOT: { externalId: paymentId } } })
    : 0;
  const planId = await resolvePlanId(ctx, variantIdOf(payment));
  const snap = await invoiceSnapshot(payment, ctx, previous === 0 ? "subscription_create" : "subscription_cycle", planId);
  await withEffects((tx, fx) => onInvoicePaid(tx, fx, snap));
  return true;
}

async function paymentFailed(payment: Record<string, unknown>, deps: WebhookDeps): Promise<boolean> {
  const paymentId = idOf(payment);
  if (!paymentId) return false;
  const ctx = await resolveContext(payment, deps, { fetchMembership: true });
  if (ctx.kind !== "subscription" || !ctx.customerId) return false;
  const planId = await resolvePlanId(ctx, variantIdOf(payment));
  const snap = await invoiceSnapshot(payment, ctx, "failed", planId);
  const failureMessage = typeof payment.failure_message === "string" ? payment.failure_message : null;
  await withEffects((tx, fx) => onInvoicePaymentFailed(tx, fx, { ...snap, failureMessage }));
  if (ctx.membership) await syncMembership(ctx.membership, ctx).catch(() => undefined);
  return true;
}

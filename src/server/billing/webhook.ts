import { db } from "@/server/db";
import { isUniqueViolation } from "@/server/errors";
import { withEffects } from "@/server/services/notifications";
import {
  onCreditPackPaid,
  onInvoicePaid,
  onInvoicePaymentFailed,
  onPaymentRefunded,
  recordInvoice,
  syncSubscription,
  type InvoiceSnapshot,
} from "@/server/services/billing";
import {
  asObj,
  idOf,
  invoiceLine,
  invoicePaymentIntentId,
  invoiceSubscriptionId,
  mapSubscriptionStatus,
  metadataOf,
  subscriptionPeriod,
  subscriptionPriceId,
  toDate,
} from "./stripe";

/**
 * Traitement des webhooks Stripe (la signature est vérifiée en amont par la
 * route). Chaque événement est journalisé dans stripe_events : un événement
 * déjà traité est ignoré, un événement en échec est retraité lors du renvoi
 * automatique de Stripe.
 */

export type WebhookEvent = { id: string; type: string; data: { object: unknown } };
export type WebhookDeps = { retrieveSubscription: (id: string) => Promise<unknown> };
export type WebhookOutcome = "processed" | "ignored" | "duplicate";

export class RetryLaterError extends Error {}

const STALE_PROCESSING_MS = 2 * 60 * 1000;

export async function handleStripeEvent(event: WebhookEvent, deps: WebhookDeps): Promise<WebhookOutcome> {
  let record = await db.stripeEvent.findUnique({ where: { id: event.id } });
  if (record && (record.status === "PROCESSED" || record.status === "IGNORED")) return "duplicate";
  if (record && record.status === "PROCESSING" && Date.now() - record.receivedAt.getTime() < STALE_PROCESSING_MS) {
    throw new RetryLaterError("Événement déjà en cours de traitement");
  }
  if (!record) {
    try {
      record = await db.stripeEvent.create({ data: { id: event.id, type: event.type, status: "PROCESSING" } });
    } catch (err) {
      if (isUniqueViolation(err)) throw new RetryLaterError("Traitement concurrent");
      throw err;
    }
  } else {
    record = await db.stripeEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSING", attempts: { increment: 1 }, receivedAt: new Date(), error: null },
    });
  }

  try {
    const handled = await dispatch(event, deps);
    await db.stripeEvent.update({
      where: { id: event.id },
      data: { status: handled ? "PROCESSED" : "IGNORED", processedAt: new Date() },
    });
    return handled ? "processed" : "ignored";
  } catch (err) {
    await db.stripeEvent.update({
      where: { id: event.id },
      data: { status: "FAILED", error: String(err instanceof Error ? err.message : err).slice(0, 1000) },
    });
    throw err;
  }
}

async function resolveCustomerId(obj: unknown): Promise<string | null> {
  const meta = metadataOf(obj);
  if (meta.packio_customer_id) {
    const c = await db.customerProfile.findUnique({ where: { id: meta.packio_customer_id }, select: { id: true } });
    if (c) return c.id;
  }
  const stripeCustomer = idOf(asObj(obj).customer);
  if (stripeCustomer) {
    const c = await db.customerProfile.findUnique({ where: { stripeCustomerId: stripeCustomer }, select: { id: true } });
    if (c) return c.id;
  }
  const ref = asObj(obj).client_reference_id;
  if (typeof ref === "string") {
    const c = await db.customerProfile.findUnique({ where: { id: ref }, select: { id: true } });
    if (c) return c.id;
  }
  return null;
}

async function resolvePlanId(priceId: string | null, meta: Record<string, string>): Promise<string | null> {
  if (priceId) {
    const plan = await db.plan.findUnique({ where: { stripePriceId: priceId }, select: { id: true } });
    if (plan) return plan.id;
  }
  if (meta.plan_id) {
    const plan = await db.plan.findUnique({ where: { id: meta.plan_id }, select: { id: true } });
    if (plan) return plan.id;
  }
  return null;
}

async function syncStripeSubscription(subObj: unknown) {
  const sub = asObj(subObj);
  const externalId = idOf(sub);
  if (!externalId) return false;
  const customerId = await resolveCustomerId(sub);
  const meta = metadataOf(sub);
  const planId = await resolvePlanId(subscriptionPriceId(sub), meta);
  if (!customerId || !planId) {
    throw new Error(`Abonnement ${externalId} : client ou offre introuvable (client=${customerId}, offre=${planId})`);
  }
  const period = subscriptionPeriod(sub);
  const status = mapSubscriptionStatus(sub.status);
  await withEffects((tx, fx) =>
    syncSubscription(tx, fx, {
      customerId,
      planId,
      provider: "stripe",
      externalId,
      status,
      periodStart: period.start,
      periodEnd: period.end,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end || (!!sub.cancel_at && status !== "CANCELED"),
      canceledAt: toDate(sub.canceled_at),
      endedAt: toDate(sub.ended_at),
    }),
  );
  return true;
}

async function invoiceSnapshot(invObj: unknown): Promise<InvoiceSnapshot | null> {
  const inv = asObj(invObj);
  const externalId = idOf(inv);
  const customerId = await resolveCustomerId(inv);
  if (!externalId || !customerId) return null;
  const line = invoiceLine(inv);
  const meta = { ...metadataOf(asObj(asObj(inv.parent).subscription_details)), ...metadataOf(inv) };
  return {
    externalId,
    customerId,
    subscriptionExternalId: invoiceSubscriptionId(inv),
    number: typeof inv.number === "string" ? inv.number : null,
    status: String(inv.status ?? "open"),
    billingReason: typeof inv.billing_reason === "string" ? inv.billing_reason : null,
    amountDueCents: Number(inv.amount_due ?? 0),
    amountPaidCents: Number(inv.amount_paid ?? 0),
    currency: String(inv.currency ?? "eur"),
    hostedUrl: typeof inv.hosted_invoice_url === "string" ? inv.hosted_invoice_url : null,
    pdfUrl: typeof inv.invoice_pdf === "string" ? inv.invoice_pdf : null,
    periodStart: line.start ?? toDate(inv.period_start),
    periodEnd: line.end ?? toDate(inv.period_end),
    issuedAt: toDate(inv.created) ?? new Date(),
    planId: await resolvePlanId(line.priceId, meta),
    paymentIntentId: invoicePaymentIntentId(inv),
    provider: "stripe",
  };
}

async function dispatch(event: WebhookEvent, deps: WebhookDeps): Promise<boolean> {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = asObj(obj);
      if (session.mode === "subscription") {
        const subId = idOf(session.subscription);
        if (!subId) return false;
        await syncStripeSubscription(await deps.retrieveSubscription(subId));
        return true;
      }
      const meta = metadataOf(session);
      if (session.mode === "payment" && meta.kind === "credit_pack") {
        if (session.payment_status !== "paid") return false;
        const customerId = await resolveCustomerId(session);
        if (!customerId) throw new Error(`Session ${String(session.id)} : client introuvable`);
        const credits = Number(meta.credits);
        if (!Number.isInteger(credits) || credits <= 0) throw new Error("Métadonnées de recharge invalides");
        await withEffects((tx, fx) =>
          onCreditPackPaid(tx, fx, {
            customerId,
            packId: meta.pack_id || null,
            credits,
            amountCents: Number(session.amount_total ?? 0),
            currency: String(session.currency ?? "eur"),
            externalId: String(session.id),
            paymentIntentId: idOf(session.payment_intent),
            provider: "stripe",
            description: meta.pack_id ? `Recharge de ${credits} crédits` : `Achat de ${credits} crédits supplémentaires`,
          }),
        );
        return true;
      }
      return false;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      return syncStripeSubscription(obj);
    case "invoice.paid": {
      const snap = await invoiceSnapshot(obj);
      if (!snap) return false;
      if (snap.subscriptionExternalId) {
        const known = await db.subscription.findUnique({ where: { externalId: snap.subscriptionExternalId }, select: { id: true } });
        if (!known) await syncStripeSubscription(await deps.retrieveSubscription(snap.subscriptionExternalId));
      }
      await withEffects((tx, fx) => onInvoicePaid(tx, fx, snap));
      return true;
    }
    case "invoice.payment_failed": {
      const snap = await invoiceSnapshot(obj);
      if (!snap) return false;
      const lastError = asObj(asObj(obj).last_finalization_error);
      await withEffects((tx, fx) =>
        onInvoicePaymentFailed(tx, fx, { ...snap, failureMessage: typeof lastError.message === "string" ? lastError.message : null }),
      );
      return true;
    }
    case "invoice.finalized":
    case "invoice.updated":
    case "invoice.voided":
    case "invoice.marked_uncollectible": {
      const snap = await invoiceSnapshot(obj);
      if (!snap) return false;
      await db.$transaction((tx) => recordInvoice(tx, snap));
      return true;
    }
    case "charge.refunded": {
      const charge = asObj(obj);
      const result = await db.$transaction((tx) =>
        onPaymentRefunded(tx, { paymentIntentId: idOf(charge.payment_intent), amountRefundedCents: Number(charge.amount_refunded ?? 0) }),
      );
      return !!result;
    }
    default:
      return false;
  }
}

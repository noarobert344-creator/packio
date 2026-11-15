import Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";
import { processStripeWebhook } from "@/server/billing/webhook-route";
import { requestShipment } from "@/server/services/shipments";
import { createAdmin, createCustomer, db, resetDb, wallet } from "../helpers";

const SECRET = "whsec_test_packio";
const now = Math.floor(Date.now() / 1000);
const month = 30 * 86400;

function signedRequest(event: object, secret = SECRET) {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": header, "content-type": "application/json" } });
}

function stripeSubscription(opts: { id: string; customer: string; priceId: string; status?: string; start?: number; cancelAtPeriodEnd?: boolean }) {
  const start = opts.start ?? now;
  return {
    id: opts.id,
    object: "subscription",
    customer: opts.customer,
    status: opts.status ?? "active",
    cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
    canceled_at: null,
    ended_at: null,
    metadata: {},
    items: { data: [{ id: "si_1", price: { id: opts.priceId }, current_period_start: start, current_period_end: start + month }] },
  };
}

function invoice(opts: { id: string; customer: string; sub: string; priceId: string; reason: string; amount: number; start?: number }) {
  const start = opts.start ?? now;
  return {
    id: opts.id,
    object: "invoice",
    customer: opts.customer,
    status: "paid",
    billing_reason: opts.reason,
    amount_due: opts.amount,
    amount_paid: opts.amount,
    currency: "eur",
    number: `F-${opts.id}`,
    hosted_invoice_url: "https://invoice.stripe.com/i/test",
    invoice_pdf: "https://pay.stripe.com/invoice/test/pdf",
    created: start,
    parent: { type: "subscription_details", subscription_details: { subscription: opts.sub, metadata: {} } },
    lines: { data: [{ type: "subscription", period: { start, end: start + month }, pricing: { type: "price_details", price_details: { price: opts.priceId } } }] },
  };
}

describe("Webhooks Stripe", () => {
  let customerId: string;
  let userId: string;
  const stripeCustomer = "cus_TEST123";
  let starterPrice: string;
  let proPrice: string;
  let subs: Record<string, unknown>;
  const deps = { retrieveSubscription: async (id: string) => subs[id] };

  beforeEach(async () => {
    await resetDb();
    await createAdmin();
    starterPrice = "price_starter_test";
    proPrice = "price_pro_test";
    await db.plan.update({ where: { code: "STARTER" }, data: { stripePriceId: starterPrice } });
    await db.plan.update({ where: { code: "PRO" }, data: { stripePriceId: proPrice } });
    const c = await createCustomer({ subscribe: false });
    customerId = c.customerId;
    userId = c.user.id;
    await db.customerProfile.update({ where: { id: customerId }, data: { stripeCustomerId: stripeCustomer } });
    subs = { sub_1: stripeSubscription({ id: "sub_1", customer: stripeCustomer, priceId: starterPrice }) };
  });

  it("rejette une signature invalide ou absente", async () => {
    const bad = await processStripeWebhook(signedRequest({ id: "evt_x", type: "invoice.paid", data: { object: {} } }, "whsec_wrong"), deps);
    expect(bad.status).toBe(400);
    const missing = await processStripeWebhook(new Request("http://localhost", { method: "POST", body: "{}" }), deps);
    expect(missing.status).toBe(400);
  });

  it("checkout.session.completed active l'abonnement et ouvre la demande d'attribution", async () => {
    const res = await processStripeWebhook(
      signedRequest({ id: "evt_cs", type: "checkout.session.completed", data: { object: { id: "cs_1", mode: "subscription", customer: stripeCustomer, subscription: "sub_1", metadata: { packio_customer_id: customerId } } } }),
      deps,
    );
    expect(res.status).toBe(200);
    const customer = await db.customerProfile.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.status).toBe("ACTIVE");
    expect(customer.assignmentState).toBe("PENDING");
    expect(await db.notification.count({ where: { userId, type: "SUBSCRIPTION_ACTIVATED" } })).toBe(1);
  });

  it("invoice.paid crédite une seule fois, même si l'événement est rejoué ou dupliqué", async () => {
    const inv = invoice({ id: "in_1", customer: stripeCustomer, sub: "sub_1", priceId: starterPrice, reason: "subscription_create", amount: 2990 });
    const r1 = await processStripeWebhook(signedRequest({ id: "evt_inv", type: "invoice.paid", data: { object: inv } }), deps);
    const r2 = await processStripeWebhook(signedRequest({ id: "evt_inv", type: "invoice.paid", data: { object: inv } }), deps);
    const r3 = await processStripeWebhook(signedRequest({ id: "evt_inv_dup", type: "invoice.paid", data: { object: inv } }), deps);
    expect([r1.status, r2.status, r3.status]).toEqual([200, 200, 200]);
    expect((await r2.json()).outcome).toBe("duplicate");
    expect((await wallet(customerId)).monthlyBalance).toBe(20);
    expect(await db.creditTransaction.count({ where: { type: "MONTHLY_GRANT" } })).toBe(1);
    const payment = await db.payment.findUniqueOrThrow({ where: { externalId: "in_1" } });
    expect(payment.status).toBe("SUCCEEDED");
    expect(await db.invoice.count({ where: { customerId } })).toBe(1);
    // L'abonnement inconnu a été récupéré puis synchronisé avant l'allocation.
    expect((await db.subscription.findUniqueOrThrow({ where: { externalId: "sub_1" } })).status).toBe("ACTIVE");
  });

  it("renouvellement mensuel : nouvelle allocation et notification", async () => {
    await processStripeWebhook(signedRequest({ id: "e1", type: "invoice.paid", data: { object: invoice({ id: "in_1", customer: stripeCustomer, sub: "sub_1", priceId: starterPrice, reason: "subscription_create", amount: 2990 }) } }), deps);
    await processStripeWebhook(
      signedRequest({ id: "e2", type: "invoice.paid", data: { object: invoice({ id: "in_2", customer: stripeCustomer, sub: "sub_1", priceId: starterPrice, reason: "subscription_cycle", amount: 2990, start: now + month }) } }),
      deps,
    );
    expect((await wallet(customerId)).monthlyBalance).toBe(20); // politique EXPIRE par défaut
    expect(await db.notification.count({ where: { userId, type: "SUBSCRIPTION_RENEWED" } })).toBe(1);
  });

  it("changement d'offre à la hausse : la différence de crédits est accordée", async () => {
    await processStripeWebhook(signedRequest({ id: "e1", type: "invoice.paid", data: { object: invoice({ id: "in_1", customer: stripeCustomer, sub: "sub_1", priceId: starterPrice, reason: "subscription_create", amount: 2990 }) } }), deps);
    await processStripeWebhook(
      signedRequest({ id: "e2", type: "customer.subscription.updated", data: { object: stripeSubscription({ id: "sub_1", customer: stripeCustomer, priceId: proPrice }) } }),
      deps,
    );
    expect((await wallet(customerId)).monthlyBalance).toBe(20 + 35);
    const sub = await db.subscription.findUniqueOrThrow({ where: { externalId: "sub_1" }, include: { plan: true } });
    expect(sub.plan.code).toBe("PRO");
  });

  it("échec de paiement : impayé, notifications et blocage des nouvelles expéditions", async () => {
    await processStripeWebhook(signedRequest({ id: "e1", type: "invoice.paid", data: { object: invoice({ id: "in_1", customer: stripeCustomer, sub: "sub_1", priceId: starterPrice, reason: "subscription_create", amount: 2990 }) } }), deps);
    const failed = { ...invoice({ id: "in_2", customer: stripeCustomer, sub: "sub_1", priceId: starterPrice, reason: "subscription_cycle", amount: 2990 }), status: "open", amount_paid: 0 };
    await processStripeWebhook(signedRequest({ id: "e2", type: "invoice.payment_failed", data: { object: failed } }), deps);
    await processStripeWebhook(
      signedRequest({ id: "e3", type: "customer.subscription.updated", data: { object: stripeSubscription({ id: "sub_1", customer: stripeCustomer, priceId: starterPrice, status: "past_due" }) } }),
      deps,
    );
    expect((await db.payment.findUniqueOrThrow({ where: { externalId: "in_2" } })).status).toBe("FAILED");
    expect((await db.customerProfile.findUniqueOrThrow({ where: { id: customerId } })).status).toBe("PAST_DUE");
    expect(await db.notification.count({ where: { userId, type: "PAYMENT_FAILED" } })).toBe(1);
    const actor = { userId, role: "CUSTOMER" as const, email: "", firstName: "C", lastName: "C", permissions: [], customerId, preparerId: null, isDemo: false };
    await expect(requestShipment(actor, { items: [{ itemId: "x", quantity: 1 }], recipientName: "a", addressLine1: "b", postalCode: "c", city: "d", country: "FR", labelMode: "PREPARER_PROVIDED" })).rejects.toThrow(/paiement/);
  });

  it("recharge de crédits (Checkout paiement) : crédits achetés une seule fois", async () => {
    await processStripeWebhook(signedRequest({ id: "e1", type: "invoice.paid", data: { object: invoice({ id: "in_1", customer: stripeCustomer, sub: "sub_1", priceId: starterPrice, reason: "subscription_create", amount: 2990 }) } }), deps);
    const pack = await db.creditPack.findFirstOrThrow({ where: { credits: 10 } });
    const session = { id: "cs_pack", mode: "payment", payment_status: "paid", customer: stripeCustomer, amount_total: 1990, currency: "eur", payment_intent: "pi_pack", metadata: { kind: "credit_pack", pack_id: pack.id, credits: "10", packio_customer_id: customerId } };
    await processStripeWebhook(signedRequest({ id: "e2", type: "checkout.session.completed", data: { object: session } }), deps);
    await processStripeWebhook(signedRequest({ id: "e3", type: "checkout.session.completed", data: { object: session } }), deps);
    expect((await wallet(customerId)).purchasedBalance).toBe(10);

    await processStripeWebhook(signedRequest({ id: "e4", type: "charge.refunded", data: { object: { id: "ch_1", payment_intent: "pi_pack", amount_refunded: 1990 } } }), deps);
    expect((await db.payment.findUniqueOrThrow({ where: { externalId: "cs_pack" } })).status).toBe("REFUNDED");
  });

  it("un événement non rattachable échoue (code 500) pour être renvoyé par Stripe, puis réussit au rejeu", async () => {
    subs.sub_2 = stripeSubscription({ id: "sub_2", customer: "cus_UNKNOWN", priceId: starterPrice });
    const evt = { id: "evt_orphan", type: "customer.subscription.created", data: { object: subs.sub_2 } };
    const res = await processStripeWebhook(signedRequest(evt), deps);
    expect(res.status).toBe(500);
    expect((await db.stripeEvent.findUniqueOrThrow({ where: { id: "evt_orphan" } })).status).toBe("FAILED");
    await db.customerProfile.update({ where: { id: customerId }, data: { stripeCustomerId: "cus_UNKNOWN" } });
    const retry = await processStripeWebhook(signedRequest(evt), deps);
    expect(retry.status).toBe(200);
    const record = await db.stripeEvent.findUniqueOrThrow({ where: { id: "evt_orphan" } });
    expect(record.status).toBe("PROCESSED");
    expect(record.attempts).toBe(2);
  });

  it("ignore proprement les types d'événements non gérés", async () => {
    const res = await processStripeWebhook(signedRequest({ id: "evt_misc", type: "product.created", data: { object: {} } }), deps);
    expect((await res.json()).outcome).toBe("ignored");
  });
});

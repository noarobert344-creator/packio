import { Webhook } from "standardwebhooks";
import { beforeEach, describe, expect, it } from "vitest";
import { processWhopWebhook } from "@/server/billing/webhook-route";
import { signWhopWebhook, verifyWhopSignature } from "@/server/billing/whop";
import { requestShipment } from "@/server/services/shipments";
import { createAdmin, createCustomer, db, resetDb, wallet } from "../helpers";

const SECRET = "ws_test_packio_secret";
const DAY = 86_400_000;
let seq = 0;

/** Requête de webhook signée comme le fait Whop (bibliothèque Standard Webhooks officielle). */
function whopRequest(type: string, data: unknown, opts?: { secret?: string; eventId?: string; timestamp?: Date }) {
  const id = opts?.eventId ?? `msg_${Date.now()}_${seq++}`;
  const payload = JSON.stringify({ id, type, api_version: "v1", timestamp: new Date().toISOString(), data });
  const at = opts?.timestamp ?? new Date();
  // La bibliothèque attend le secret encodé en base64 : on encode le secret complet,
  // exactement comme le SDK @whop/sdk (Whop signe avec les octets du secret tel quel).
  const signature = new Webhook(Buffer.from(opts?.secret ?? SECRET, "utf8").toString("base64")).sign(id, at, payload);
  return new Request("http://localhost/api/webhooks/whop", {
    method: "POST",
    body: payload,
    headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(Math.floor(at.getTime() / 1000)), "webhook-signature": signature },
  });
}

describe("Webhooks Whop", () => {
  let customerId: string;
  let userId: string;
  let starterId: string;
  let proId: string;
  let memberships: Record<string, Record<string, unknown>>;
  let payments: Record<string, Record<string, unknown>>;
  const deps = {
    retrieveMembership: async (id: string) => memberships[id],
    retrievePayment: async (id: string) => payments[id],
  };

  function membership(overrides: Record<string, unknown> = {}) {
    const start = new Date();
    return {
      id: "mem_1",
      status: "active",
      user_id: "user_whop_1",
      variant_id: "plan_auto_starter",
      cancel_at_period_end: false,
      current_period_start: start.toISOString(),
      current_period_end: new Date(start.getTime() + 30 * DAY).toISOString(),
      metadata: { kind: "subscription", packio_customer_id: customerId, plan_id: starterId },
      ...overrides,
    };
  }

  function payment(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      status: "paid",
      substatus: "succeeded",
      total: { amount: "29.90", currency: "eur", decimals: 2 },
      currency: "eur",
      membership_id: "mem_1",
      variant_id: "plan_auto_starter",
      user: { id: "user_whop_1", username: "alice" },
      metadata: {},
      paid_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    await resetDb();
    await createAdmin();
    starterId = (await db.plan.findUniqueOrThrow({ where: { code: "STARTER" } })).id;
    proId = (await db.plan.findUniqueOrThrow({ where: { code: "PRO" } })).id;
    const c = await createCustomer({ subscribe: false });
    customerId = c.customerId;
    userId = c.user.id;
    memberships = { mem_1: membership() };
    payments = {};
  });

  it("vérifie la signature : compatible avec Standard Webhooks, rejette secret, horodatage et en-têtes invalides", async () => {
    const payload = JSON.stringify({ id: "x", type: "payment.succeeded", data: {} });
    const headers = new Headers(signWhopWebhook(payload, SECRET, "msg_check"));
    expect(verifyWhopSignature(payload, headers, SECRET)).toBe(true);
    expect(verifyWhopSignature(payload + " ", headers, SECRET)).toBe(false);
    expect(verifyWhopSignature(payload, headers, "ws_autre_secret")).toBe(false);

    const bad = await processWhopWebhook(whopRequest("payment.succeeded", {}, { secret: "ws_mauvais" }), deps);
    expect(bad.status).toBe(400);
    const old = await processWhopWebhook(whopRequest("payment.succeeded", {}, { timestamp: new Date(Date.now() - 10 * 60_000) }), deps);
    expect(old.status).toBe(400);
    const missing = await processWhopWebhook(new Request("http://localhost", { method: "POST", body: "{}" }), deps);
    expect(missing.status).toBe(400);
  });

  it("membership.activated : abonnement actif, demande d'attribution ouverte, utilisateur Whop rattaché", async () => {
    const res = await processWhopWebhook(whopRequest("membership.activated", memberships.mem_1), deps);
    expect(res.status).toBe(200);
    const customer = await db.customerProfile.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.status).toBe("ACTIVE");
    expect(customer.assignmentState).toBe("PENDING");
    expect(customer.billingCustomerId).toBe("user_whop_1");
    expect((await db.subscription.findUniqueOrThrow({ where: { externalId: "mem_1" } })).provider).toBe("whop");
    expect(await db.notification.count({ where: { userId, type: "SUBSCRIPTION_ACTIVATED" } })).toBe(1);
  });

  it("payment.succeeded : premier paiement crédité une seule fois (rejeu et doublon), métadonnées lues sur l'abonnement", async () => {
    const p = payment("pay_1");
    const r1 = await processWhopWebhook(whopRequest("payment.succeeded", p, { eventId: "msg_p1" }), deps);
    const r2 = await processWhopWebhook(whopRequest("payment.succeeded", p, { eventId: "msg_p1" }), deps);
    const r3 = await processWhopWebhook(whopRequest("payment.succeeded", p, { eventId: "msg_p1_bis" }), deps);
    expect([r1.status, r2.status, r3.status]).toEqual([200, 200, 200]);
    expect((await r2.json()).outcome).toBe("duplicate");
    const w = await wallet(customerId);
    expect(w.monthlyBalance).toBe(20);
    expect(await db.creditTransaction.count({ where: { type: "MONTHLY_GRANT" } })).toBe(1);
    const pay = await db.payment.findUniqueOrThrow({ where: { externalId: "pay_1" } });
    expect(pay).toMatchObject({ status: "SUCCEEDED", amountCents: 2990, membershipId: "mem_1", provider: "whop" });
    expect((await db.subscription.findUniqueOrThrow({ where: { externalId: "mem_1" } })).status).toBe("ACTIVE");
  });

  it("renouvellement : nouveau paiement, nouvelle allocation, changement d'offre transmis à Whop appliqué", async () => {
    await processWhopWebhook(whopRequest("payment.succeeded", payment("pay_1")), deps);
    const sub = await db.subscription.findUniqueOrThrow({ where: { externalId: "mem_1" } });
    await db.subscription.update({ where: { id: sub.id }, data: { pendingPlanId: proId, pendingSyncedAt: new Date() } });
    memberships.mem_1 = membership({ current_period_start: new Date(Date.now() + 30 * DAY).toISOString(), current_period_end: new Date(Date.now() + 60 * DAY).toISOString() });
    await processWhopWebhook(whopRequest("payment.succeeded", payment("pay_2", { total: { amount: "69.90", currency: "eur" } })), deps);
    const after = await db.subscription.findUniqueOrThrow({ where: { externalId: "mem_1" }, include: { plan: true } });
    expect(after.plan.code).toBe("PRO");
    expect(after.pendingPlanId).toBeNull();
    expect((await wallet(customerId)).monthlyBalance).toBe(55); // politique EXPIRE : 20 expirent, 55 accordés
    expect(await db.notification.count({ where: { userId, type: "SUBSCRIPTION_RENEWED" } })).toBe(1);
  });

  it("renouvellement : un changement programmé non transmis à Whop n'est pas appliqué et les admins sont alertés", async () => {
    await processWhopWebhook(whopRequest("payment.succeeded", payment("pay_1")), deps);
    const sub = await db.subscription.findUniqueOrThrow({ where: { externalId: "mem_1" } });
    await db.subscription.update({ where: { id: sub.id }, data: { pendingPlanId: proId } });
    memberships.mem_1 = membership({ current_period_start: new Date(Date.now() + 30 * DAY).toISOString(), current_period_end: new Date(Date.now() + 60 * DAY).toISOString() });
    await processWhopWebhook(whopRequest("payment.succeeded", payment("pay_2")), deps);
    const after = await db.subscription.findUniqueOrThrow({ where: { externalId: "mem_1" }, include: { plan: true } });
    expect(after.plan.code).toBe("STARTER");
    expect(after.pendingPlanId).toBe(proId);
    expect(await db.notification.count({ where: { title: "Changement d'offre non transmis à Whop" } })).toBe(1);
  });

  it("échec de paiement : paiement en échec, impayé, notification et blocage des expéditions", async () => {
    await processWhopWebhook(whopRequest("payment.succeeded", payment("pay_1")), deps);
    memberships.mem_1 = membership({ status: "past_due" });
    await processWhopWebhook(whopRequest("payment.failed", payment("pay_2", { status: "open", substatus: "failed", failure_message: "Carte refusée" })), deps);
    await processWhopWebhook(whopRequest("membership.updated", memberships.mem_1), deps);
    expect((await db.payment.findUniqueOrThrow({ where: { externalId: "pay_2" } })).status).toBe("FAILED");
    expect((await db.customerProfile.findUniqueOrThrow({ where: { id: customerId } })).status).toBe("PAST_DUE");
    expect(await db.notification.count({ where: { userId, type: "PAYMENT_FAILED" } })).toBe(1);
    const actor = { userId, role: "CUSTOMER" as const, email: "", firstName: "C", lastName: "C", permissions: [], customerId, preparerId: null, isDemo: false };
    await expect(
      requestShipment(actor, { items: [{ itemId: "x", quantity: 1 }], recipientName: "a", addressLine1: "b", postalCode: "c", city: "d", country: "FR", labelMode: "PREPARER_PROVIDED" }),
    ).rejects.toThrow(/paiement/);
  });

  it("résiliation programmée puis fin de l'abonnement", async () => {
    await processWhopWebhook(whopRequest("payment.succeeded", payment("pay_1")), deps);
    await processWhopWebhook(whopRequest("membership.updated", membership({ cancel_at_period_end: true })), deps);
    expect((await db.subscription.findUniqueOrThrow({ where: { externalId: "mem_1" } })).cancelAtPeriodEnd).toBe(true);
    await processWhopWebhook(whopRequest("membership.updated", membership({ status: "canceled", cancel_at_period_end: true, canceled_at: new Date().toISOString() })), deps);
    expect((await db.customerProfile.findUniqueOrThrow({ where: { id: customerId } })).status).toBe("CANCELED");
  });

  it("achat de 30 crédits supplémentaires : crédité une seule fois, puis remboursement synchronisé", async () => {
    await processWhopWebhook(whopRequest("payment.succeeded", payment("pay_1")), deps);
    const pack = await db.creditPack.findFirstOrThrow({ where: { credits: 30 } });
    memberships.mem_pack = { id: "mem_pack", status: "completed", metadata: { kind: "credit_pack", packio_customer_id: customerId, pack_id: pack.id, credits: "30" } };
    const p = payment("pay_pack", { membership_id: "mem_pack", total: { amount: "54.90", currency: "eur" } });
    await processWhopWebhook(whopRequest("payment.succeeded", p), deps);
    await processWhopWebhook(whopRequest("payment.succeeded", p), deps);
    expect((await wallet(customerId)).purchasedBalance).toBe(30);
    const pay = await db.payment.findUniqueOrThrow({ where: { externalId: "pay_pack" } });
    expect(pay).toMatchObject({ kind: "CREDIT_PACK", creditsGranted: 30, amountCents: 5490, creditPackId: pack.id });
    // L'événement d'abonnement « completed » d'un achat unique n'altère pas l'abonnement mensuel.
    await processWhopWebhook(whopRequest("membership.updated", memberships.mem_pack), deps);
    expect((await db.customerProfile.findUniqueOrThrow({ where: { id: customerId } })).status).toBe("ACTIVE");

    payments.pay_pack = { ...p, refunded_amount: { amount: "54.90", currency: "eur" } };
    await processWhopWebhook(whopRequest("refund.created", { id: "rf_1", payment_id: "pay_pack" }), deps);
    expect((await db.payment.findUniqueOrThrow({ where: { externalId: "pay_pack" } })).status).toBe("REFUNDED");
  });

  it("un événement non rattachable échoue (500) pour être renvoyé par Whop, puis réussit au rejeu", async () => {
    memberships.mem_x = { id: "mem_x", status: "active", user_id: "user_inconnu", metadata: { kind: "subscription", plan_id: starterId } };
    const evt = { eventId: "msg_orphan" };
    const res = await processWhopWebhook(whopRequest("membership.activated", memberships.mem_x, evt), deps);
    expect(res.status).toBe(500);
    expect((await db.webhookEvent.findUniqueOrThrow({ where: { id: "msg_orphan" } })).status).toBe("FAILED");
    await db.customerProfile.update({ where: { id: customerId }, data: { billingCustomerId: "user_inconnu" } });
    const retry = await processWhopWebhook(whopRequest("membership.activated", memberships.mem_x, evt), deps);
    expect(retry.status).toBe(200);
    const record = await db.webhookEvent.findUniqueOrThrow({ where: { id: "msg_orphan" } });
    expect(record).toMatchObject({ status: "PROCESSED", attempts: 2, provider: "whop" });
  });

  it("formule annuelle : périodicité lue dans les métadonnées, crédits du mois et calendrier", async () => {
    memberships.mem_1 = membership({
      current_period_end: new Date(Date.now() + 365 * DAY).toISOString(),
      metadata: { kind: "subscription", packio_customer_id: customerId, plan_id: starterId, billing_interval: "yearly" },
    });
    await processWhopWebhook(whopRequest("payment.succeeded", payment("pay_y1", { total: { amount: "299.00", currency: "eur" } })), deps);
    const sub = await db.subscription.findUniqueOrThrow({ where: { externalId: "mem_1" } });
    expect(sub.billingInterval).toBe("YEARLY");
    expect(sub.creditMonthsGranted).toBe(1);
    expect(sub.nextCreditGrantAt).not.toBeNull();
    expect((await wallet(customerId)).monthlyBalance).toBe(20);
    expect((await db.payment.findUniqueOrThrow({ where: { externalId: "pay_y1" } })).amountCents).toBe(29900);
  });

  it("formule annuelle sans métadonnée de périodicité : déduite de la durée de la période", async () => {
    memberships.mem_1 = membership({ current_period_end: new Date(Date.now() + 365 * DAY).toISOString() });
    await processWhopWebhook(whopRequest("membership.activated", memberships.mem_1), deps);
    expect((await db.subscription.findUniqueOrThrow({ where: { externalId: "mem_1" } })).billingInterval).toBe("YEARLY");
  });

  it("changement d'offre immédiat : la nouvelle adhésion remplace l'ancienne (arrêt demandé à Whop, alerte si impossible)", async () => {
    await processWhopWebhook(whopRequest("payment.succeeded", payment("pay_1")), deps);
    memberships.mem_2 = membership({
      id: "mem_2",
      variant_id: "plan_auto_pro",
      metadata: { kind: "subscription", packio_customer_id: customerId, plan_id: proId, billing_interval: "monthly", replaces: "mem_1" },
    });
    await processWhopWebhook(whopRequest("payment.succeeded", payment("pay_2", { membership_id: "mem_2", total: { amount: "69.90", currency: "eur" } })), deps);
    const old = await db.subscription.findUniqueOrThrow({ where: { externalId: "mem_1" } });
    expect(old.supersededAt).not.toBeNull();
    expect(old.cancelAtPeriodEnd).toBe(true);
    const customer = await db.customerProfile.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.status).toBe("ACTIVE");
    expect((await wallet(customerId)).monthlyBalance).toBe(75);
    // Sans clé API dans les tests, l'arrêt chez Whop échoue : les admins sont alertés.
    expect(await db.notification.count({ where: { title: "Ancienne adhésion Whop à arrêter" } })).toBe(1);
    // L'avis de Whop sur l'ancienne adhésion ne déclenche pas d'avis de résiliation.
    memberships.mem_1 = membership({ cancel_at_period_end: true });
    await processWhopWebhook(whopRequest("membership.updated", memberships.mem_1), deps);
    expect(await db.notification.count({ where: { userId, title: "Résiliation programmée" } })).toBe(0);
  });

  it("ignore proprement les événements non gérés", async () => {
    const res = await processWhopWebhook(whopRequest("payment.created", { id: "pay_z" }), deps);
    expect((await res.json()).outcome).toBe("ignored");
  });
});

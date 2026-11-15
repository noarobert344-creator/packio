import Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";
import { devCompleteCustomCredits, quoteCustomCredits } from "@/server/billing";
import { processStripeWebhook } from "@/server/billing/webhook-route";
import { saveSetting } from "@/server/services/settings";
import { createAdmin, createCustomer, db, resetDb, wallet } from "../helpers";

function signed(event: object) {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_packio" });
  return new Request("http://localhost/api/webhooks/stripe", { method: "POST", body: payload, headers: { "stripe-signature": header } });
}

describe("Achat de crédits supplémentaires en quantité libre", () => {
  beforeEach(async () => {
    await resetDb();
    await createAdmin();
  });

  it("calcule le prix côté serveur et respecte les bornes configurées", async () => {
    await expect(quoteCustomCredits(12)).resolves.toMatchObject({ credits: 12, unitPriceCents: 199, totalCents: 2388 });
    await expect(quoteCustomCredits(4)).rejects.toThrow(/entre 5 et 500/);
    await expect(quoteCustomCredits(501)).rejects.toThrow(/entre 5 et 500/);
    await expect(quoteCustomCredits(7.5)).rejects.toThrow();
    await saveSetting("creditPurchase", { customEnabled: true, unitPriceCents: 150, minCredits: 1, maxCredits: 50 }, null);
    await expect(quoteCustomCredits(10)).resolves.toMatchObject({ totalCents: 1500 });
    await saveSetting("creditPurchase", { customEnabled: false, unitPriceCents: 150, minCredits: 1, maxCredits: 50 }, null);
    await expect(quoteCustomCredits(10)).rejects.toThrow(/pas disponible/);
  });

  it("ajoute les crédits achetés au portefeuille avec paiement et registre", async () => {
    const { actor, customerId } = await createCustomer({ plan: "STARTER" });
    await devCompleteCustomCredits(actor, 13);
    const w = await wallet(customerId);
    expect(w.monthlyBalance).toBe(20);
    expect(w.purchasedBalance).toBe(13);
    const payment = await db.payment.findFirstOrThrow({ where: { customerId, kind: "CREDIT_PACK" } });
    expect(payment).toMatchObject({ amountCents: 13 * 199, creditsGranted: 13, creditPackId: null, status: "SUCCEEDED" });
    expect(await db.creditTransaction.count({ where: { type: "PURCHASE", wallet: { customerId } } })).toBe(1);
  });

  it("refuse l'achat sans abonnement actif", async () => {
    const { actor } = await createCustomer({ subscribe: false });
    await expect(devCompleteCustomCredits(actor, 10)).rejects.toThrow(/abonnement actif/);
  });

  it("webhook Stripe : achat en quantité libre crédité une seule fois", async () => {
    const { customerId } = await createCustomer({ plan: "STARTER" });
    await db.customerProfile.update({ where: { id: customerId }, data: { stripeCustomerId: "cus_custom" } });
    const session = {
      id: "cs_custom_1",
      mode: "payment",
      payment_status: "paid",
      customer: "cus_custom",
      amount_total: 25 * 199,
      currency: "eur",
      payment_intent: "pi_custom_1",
      metadata: { kind: "credit_pack", pack_id: "", credits: "25", packio_customer_id: customerId },
    };
    const deps = { retrieveSubscription: async () => null };
    await processStripeWebhook(signed({ id: "evt_c1", type: "checkout.session.completed", data: { object: session } }), deps);
    await processStripeWebhook(signed({ id: "evt_c2", type: "checkout.session.completed", data: { object: session } }), deps);
    expect((await wallet(customerId)).purchasedBalance).toBe(25);
    const payment = await db.payment.findUniqueOrThrow({ where: { externalId: "cs_custom_1" } });
    expect(payment.description).toBe("Achat de 25 crédits supplémentaires");
  });
});

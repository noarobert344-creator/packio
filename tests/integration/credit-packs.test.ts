import { beforeEach, describe, expect, it } from "vitest";
import { changePlan, devCompleteCreditPack, devSimulateRenewal, startCreditPackCheckout } from "@/server/billing";
import { saveCreditPack } from "@/server/services/catalog";
import { CREDIT_PACK_SIZES } from "@/lib/credit-packs";
import { createAdmin, createCustomer, db, resetDb, wallet } from "../helpers";

describe("Crédits supplémentaires (10, 30, 50 ou 100) et changement d'offre", () => {
  beforeEach(resetDb);

  it("propose exactement 10, 30, 50 et 100 crédits", async () => {
    const packs = await db.creditPack.findMany({ where: { isActive: true }, orderBy: { credits: "asc" } });
    expect(packs.map((p) => p.credits)).toEqual([...CREDIT_PACK_SIZES]);
  });

  it("achat d'une recharge : crédits, paiement et registre", async () => {
    await createAdmin();
    const { actor, customerId } = await createCustomer({ plan: "STARTER" });
    const pack50 = await db.creditPack.findFirstOrThrow({ where: { credits: 50 } });
    expect((await startCreditPackCheckout(actor, pack50.id)).url).toBe(`/paiement-demo?type=credits&pack=${pack50.id}`);
    await devCompleteCreditPack(actor, pack50.id);
    const w = await wallet(customerId);
    expect([w.monthlyBalance, w.purchasedBalance]).toEqual([20, 50]);
    const payment = await db.payment.findFirstOrThrow({ where: { customerId, kind: "CREDIT_PACK" } });
    expect(payment).toMatchObject({ creditsGranted: 50, amountCents: pack50.priceCents, creditPackId: pack50.id, status: "SUCCEEDED" });
  });

  it("refuse les quantités hors 10/30/50/100 et les recharges sans abonnement", async () => {
    const admin = await createAdmin();
    await expect(saveCreditPack(admin, { name: "60 crédits", credits: 60, priceCents: 9990, isActive: true, sortOrder: 5 })).rejects.toThrow(/10, 30, 50 ou 100/);
    await expect(saveCreditPack(admin, { name: "Doublon", credits: 30, priceCents: 1000, isActive: true, sortOrder: 5 })).rejects.toThrow(/existe déjà/);
    const odd = await db.creditPack.create({ data: { name: "Ancienne", credits: 60, priceCents: 9990 } });
    const { actor } = await createCustomer({ subscribe: false });
    const pack10 = await db.creditPack.findFirstOrThrow({ where: { credits: 10 } });
    await expect(startCreditPackCheckout(actor, pack10.id)).rejects.toThrow(/abonnement actif/);
    const subscribed = await createCustomer({ plan: "STARTER" });
    await expect(startCreditPackCheckout(subscribed.actor, odd.id)).rejects.toThrow(/pas disponible/);
  });

  it("changement d'offre programmé : appliqué au renouvellement avec ses crédits, annulable", async () => {
    await createAdmin();
    const { actor, customerId } = await createCustomer({ plan: "STARTER" });
    const pro = await db.plan.findUniqueOrThrow({ where: { code: "PRO" } });
    const starter = await db.plan.findUniqueOrThrow({ where: { code: "STARTER" } });

    await changePlan(actor, pro.id);
    let sub = await db.subscription.findFirstOrThrow({ where: { customerId } });
    expect(sub.planId).toBe(starter.id);
    expect(sub.pendingPlanId).toBe(pro.id);
    expect((await wallet(customerId)).monthlyBalance).toBe(20); // rien n'est accordé avant le renouvellement

    await changePlan(actor, starter.id); // annulation du changement
    expect((await db.subscription.findFirstOrThrow({ where: { customerId } })).pendingPlanId).toBeNull();

    await changePlan(actor, pro.id);
    await devSimulateRenewal(customerId);
    sub = await db.subscription.findFirstOrThrow({ where: { customerId } });
    expect(sub.planId).toBe(pro.id);
    expect(sub.pendingPlanId).toBeNull();
    expect((await wallet(customerId)).monthlyBalance).toBe(55);
    const lastPayment = await db.payment.findFirstOrThrow({ where: { customerId, kind: "SUBSCRIPTION" }, orderBy: { createdAt: "desc" } });
    expect(lastPayment.amountCents).toBe(pro.priceCents);
  });
});

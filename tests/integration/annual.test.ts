import { addDays, addMonths } from "date-fns";
import { beforeEach, describe, expect, it } from "vitest";
import { changePlan, devCompleteSubscription, devSimulateRenewal, startSubscriptionCheckout } from "@/server/billing";
import { grantDueAnnualCredits } from "@/server/services/billing";
import { getActiveSubscription } from "@/server/services/customers";
import { listSubscriptions } from "@/server/queries/admin-ops";
import { createAdmin, createCustomer, db, ledgerInvariant, resetDb, wallet } from "../helpers";

const plan = (code: "STARTER" | "PRO" | "BUSINESS") => db.plan.findUniqueOrThrow({ where: { code } });
const subOf = (customerId: string) => db.subscription.findFirstOrThrow({ where: { customerId, supersededAt: null } });

describe("Formule annuelle", () => {
  beforeEach(async () => {
    await resetDb();
    await createAdmin();
  });

  it("prix annuels par défaut : 11 mois facturés, 1 mois offert", async () => {
    const plans = await db.plan.findMany({ orderBy: { sortOrder: "asc" } });
    expect(plans.map((p) => [p.code, p.annualPriceCents])).toEqual([
      ["STARTER", 42900],
      ["PRO", 86900],
      ["BUSINESS", 174900],
    ]);
  });

  it("souscription annuelle : paiement unique, crédits du premier mois et calendrier mensuel", async () => {
    const { customerId } = await createCustomer({ plan: "STARTER", interval: "YEARLY" });
    const sub = await subOf(customerId);
    expect(sub.billingInterval).toBe("YEARLY");
    expect(sub.creditMonthsGranted).toBe(1);
    expect(sub.nextCreditGrantAt?.getTime()).toBe(addMonths(sub.creditAnchorAt!, 1).getTime());
    expect(sub.currentPeriodEnd!.getTime() - sub.currentPeriodStart!.getTime()).toBeGreaterThan(360 * 86_400_000);
    const payment = await db.payment.findFirstOrThrow({ where: { customerId, kind: "SUBSCRIPTION" } });
    expect(payment.amountCents).toBe(42900);
    expect((await wallet(customerId)).monthlyBalance).toBe(20);
  });

  it("verse les crédits chaque mois, douze fois par an, sans doublon ni dépassement de la période", async () => {
    const { customerId } = await createCustomer({ plan: "STARTER", interval: "YEARLY" });
    const anchor = (await subOf(customerId)).creditAnchorAt!;

    // Aucune distribution avant la date prévue.
    expect((await grantDueAnnualCredits(addDays(anchor, 20))).annualGrants).toBe(0);

    // Mois 2, rejoué : une seule distribution (politique EXPIRE : le solde du mois 1 expire).
    expect((await grantDueAnnualCredits(addMonths(anchor, 1))).annualGrants).toBe(1);
    expect((await grantDueAnnualCredits(addMonths(anchor, 1))).annualGrants).toBe(0);
    expect((await wallet(customerId)).monthlyBalance).toBe(20);

    // Rattrapage : trois mois manqués sont versés en une exécution.
    expect((await grantDueAnnualCredits(addDays(addMonths(anchor, 4), 1))).annualGrants).toBe(3);
    expect((await subOf(customerId)).creditMonthsGranted).toBe(5);

    // Fin d'année : 12 distributions au total, rien au-delà.
    expect((await grantDueAnnualCredits(addMonths(anchor, 11))).annualGrants).toBe(7);
    const sub = await subOf(customerId);
    expect(sub.creditMonthsGranted).toBe(12);
    expect(sub.nextCreditGrantAt).toBeNull();
    expect((await grantDueAnnualCredits(addMonths(anchor, 13))).annualGrants).toBe(0);
    expect(await db.creditTransaction.count({ where: { type: "MONTHLY_GRANT" } })).toBe(12);
    const inv = await ledgerInvariant(customerId);
    expect(inv.available).toBe(inv.ledgerAvailable);
  });

  it("renouvellement annuel : nouveau paiement annuel et nouveau calendrier", async () => {
    const { customerId } = await createCustomer({ plan: "PRO", interval: "YEARLY" });
    const before = await subOf(customerId);
    await devSimulateRenewal(customerId);
    const after = await subOf(customerId);
    expect(after.currentPeriodStart?.getTime()).toBe(before.currentPeriodEnd?.getTime());
    expect(after.creditAnchorAt?.getTime()).toBe(before.currentPeriodEnd?.getTime());
    expect(after.creditMonthsGranted).toBe(1);
    const last = await db.payment.findFirstOrThrow({ where: { customerId, kind: "SUBSCRIPTION" }, orderBy: { createdAt: "desc" } });
    expect(last.amountCents).toBe(86900);
  });

  it("refuse la formule annuelle quand elle n'est pas proposée pour l'offre", async () => {
    const starter = await plan("STARTER");
    await db.plan.update({ where: { id: starter.id }, data: { annualPriceCents: null } });
    const { actor } = await createCustomer({ subscribe: false });
    await expect(startSubscriptionCheckout(actor, starter.id, "YEARLY")).rejects.toThrow(/annuelle n'est pas proposée/);
    expect((await startSubscriptionCheckout(actor, starter.id, "MONTHLY")).url).toContain("periodicite=mensuel");
  });

  it("montée en gamme immédiate : nouveau paiement, ancienne offre non renouvelée, crédits conservés", async () => {
    const { actor, customerId } = await createCustomer({ plan: "STARTER" });
    const pro = await plan("PRO");
    const res = await changePlan(actor, pro.id, "MONTHLY");
    expect(res).toEqual({ mode: "checkout", url: `/paiement-demo?type=changement&offre=${pro.id}&periodicite=mensuel` });
    await devCompleteSubscription(actor, pro.id, "MONTHLY", { change: true });

    const subs = await db.subscription.findMany({ where: { customerId }, include: { plan: true }, orderBy: { createdAt: "asc" } });
    expect(subs.map((s) => [s.plan.code, !!s.supersededAt, s.cancelAtPeriodEnd])).toEqual([
      ["STARTER", true, true],
      ["PRO", false, false],
    ]);
    expect((await getActiveSubscription(customerId))?.plan.code).toBe("PRO");
    expect((await wallet(customerId)).monthlyBalance).toBe(70); // 20 Starter conservés + 50 Pro
    expect((await listSubscriptions({ page: 1 })).kpis.mrrCents).toBe(7900);

    // Fin de période de l'ancienne offre : pas d'avis de résiliation, le client reste actif.
    await devSimulateRenewal(customerId);
    expect((await db.subscription.findFirstOrThrow({ where: { id: subs[0].id } })).status).toBe("CANCELED");
    expect((await db.customerProfile.findUniqueOrThrow({ where: { id: customerId } })).status).toBe("ACTIVE");
    expect(await db.notification.count({ where: { userId: actor.userId, title: "Abonnement résilié" } })).toBe(0);
  });

  it("passage du mensuel à l'annuel : paiement immédiat de l'année", async () => {
    const { actor, customerId } = await createCustomer({ plan: "PRO" });
    const pro = await plan("PRO");
    const res = await changePlan(actor, pro.id, "YEARLY");
    expect(res.mode).toBe("checkout");
    await devCompleteSubscription(actor, pro.id, "YEARLY", { change: true });
    const primary = await getActiveSubscription(customerId);
    expect(primary?.billingInterval).toBe("YEARLY");
    const last = await db.payment.findFirstOrThrow({ where: { customerId, kind: "SUBSCRIPTION" }, orderBy: { createdAt: "desc" } });
    expect(last.amountCents).toBe(86900);
    expect((await listSubscriptions({ page: 1 })).kpis).toMatchObject({ mrrCents: 7242, yearly: 1 });

    // Démonstration : la fin de l'année clôt aussi l'ancienne offre mensuelle, puis le client choisit le mensuel.
    const starter = await plan("STARTER");
    await changePlan(actor, starter.id, "MONTHLY");
    await devSimulateRenewal(customerId);
    expect(await db.subscription.count({ where: { customerId, status: { not: "CANCELED" } } })).toBe(0);
    expect(await getActiveSubscription(customerId)).toBeNull();
  });

  it("montée en gamme annuelle : l'ancienne formule continue de verser les mois déjà payés", async () => {
    const { actor, customerId } = await createCustomer({ plan: "STARTER", interval: "YEARLY" });
    const business = await plan("BUSINESS");
    await devCompleteSubscription(actor, business.id, "YEARLY", { change: true });
    const old = await db.subscription.findFirstOrThrow({ where: { customerId, supersededAt: { not: null } } });
    expect(old.nextCreditGrantAt).not.toBeNull();
    expect((await wallet(customerId)).monthlyBalance).toBe(110); // 20 + 90

    // Mois suivant : chaque formule verse ses crédits, sans faire expirer ceux de l'autre.
    expect((await grantDueAnnualCredits(addDays(new Date(), 32))).annualGrants).toBe(2);
    expect((await wallet(customerId)).monthlyBalance).toBe(110);
  });

  it("baisse d'offre programmée au renouvellement, annulable avant l'échéance", async () => {
    const { actor, customerId } = await createCustomer({ plan: "PRO" });
    const [starter, pro] = [await plan("STARTER"), await plan("PRO")];
    expect(await changePlan(actor, starter.id)).toMatchObject({ mode: "scheduled" });
    expect((await subOf(customerId)).pendingPlanId).toBe(starter.id);
    expect(await changePlan(actor, pro.id)).toEqual({ mode: "canceled" });
    expect((await subOf(customerId)).pendingPlanId).toBeNull();
    await expect(changePlan(actor, pro.id)).rejects.toThrow(/déjà sur cette offre/);

    await changePlan(actor, starter.id);
    await devSimulateRenewal(customerId);
    const sub = await db.subscription.findFirstOrThrow({ where: { customerId }, include: { plan: true } });
    expect(sub.plan.code).toBe("STARTER");
    expect((await wallet(customerId)).monthlyBalance).toBe(20);
    const last = await db.payment.findFirstOrThrow({ where: { customerId, kind: "SUBSCRIPTION" }, orderBy: { createdAt: "desc" } });
    expect(last.amountCents).toBe(3900);
  });

  it("passage de l'annuel au mensuel : à l'échéance, puis activation du mensuel en un clic", async () => {
    const { actor, customerId } = await createCustomer({ plan: "PRO", interval: "YEARLY" });
    const [starter, pro] = [await plan("STARTER"), await plan("PRO")];

    // Programmé puis annulé : le renouvellement annuel est réactivé.
    expect((await changePlan(actor, starter.id, "MONTHLY")).mode).toBe("scheduled");
    let sub = await subOf(customerId);
    expect([sub.cancelAtPeriodEnd, sub.pendingPlanId, sub.pendingBillingInterval]).toEqual([true, starter.id, "MONTHLY"]);
    expect(await changePlan(actor, pro.id, "YEARLY")).toEqual({ mode: "canceled" });
    sub = await subOf(customerId);
    expect([sub.cancelAtPeriodEnd, sub.pendingPlanId, sub.pendingBillingInterval]).toEqual([false, null, null]);

    // Programmé jusqu'à l'échéance.
    await changePlan(actor, starter.id, "MONTHLY");
    await devSimulateRenewal(customerId);
    expect((await db.subscription.findFirstOrThrow({ where: { customerId } })).status).toBe("CANCELED");
    expect(await db.notification.count({ where: { userId: actor.userId, title: "Activez votre formule mensuelle" } })).toBe(1);
    expect((await startSubscriptionCheckout(actor, starter.id, "MONTHLY")).url).toBe(`/paiement-demo?type=abonnement&offre=${starter.id}&periodicite=mensuel`);
    await devCompleteSubscription(actor, starter.id, "MONTHLY");
    expect((await getActiveSubscription(customerId))?.plan.code).toBe("STARTER");
  });
});

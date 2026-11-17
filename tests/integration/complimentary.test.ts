import { addMonths } from "date-fns";
import { beforeEach, describe, expect, it } from "vitest";
import {
  activateComplimentarySubscription,
  endExpiredComplimentarySubscriptions,
} from "@/server/services/complimentary";
import { createAdmin, createCustomer, db, resetDb, wallet } from "../helpers";

describe("Abonnement offert par l'administration", () => {
  beforeEach(resetDb);

  it("active un inscrit sans paiement, verse les crédits, s'arrête seul à la date de fin", async () => {
    const admin = await createAdmin();
    const client = await createCustomer({ subscribe: false });
    expect(
      await db.customerProfile.findUniqueOrThrow({
        where: { id: client.customerId },
      }),
    ).toMatchObject({ status: "PENDING_PAYMENT" });
    const pro = await db.plan.findUniqueOrThrow({ where: { code: "PRO" } });

    await expect(
      activateComplimentarySubscription(admin, {
        customerId: client.customerId,
        planId: pro.id,
        months: 2,
        reason: "Test",
      }),
    ).rejects.toMatchObject({ code: "MONTHS" });
    const { until } = await activateComplimentarySubscription(admin, {
      customerId: client.customerId,
      planId: pro.id,
      months: 3,
      reason: "Paiement reçu en direct",
    });

    const customer = await db.customerProfile.findUniqueOrThrow({
      where: { id: client.customerId },
      include: { subscriptions: true },
    });
    expect(customer.status).toBe("ACTIVE");
    expect(customer.assignmentState).not.toBe("NOT_REQUESTED");
    expect(customer.subscriptions[0]).toMatchObject({
      status: "ACTIVE",
      provider: "dev",
      creditMonthsGranted: 1,
    });
    expect(customer.subscriptions[0].externalId.startsWith("offert_")).toBe(
      true,
    );
    const w = await wallet(client.customerId);
    expect(w.monthlyBalance + w.purchasedBalance).toBe(pro.monthlyCredits);
    expect(
      await db.payment.count({ where: { customerId: client.customerId } }),
    ).toBe(0);
    await expect(
      activateComplimentarySubscription(admin, {
        customerId: client.customerId,
        planId: pro.id,
        months: 1,
        reason: "Encore",
      }),
    ).rejects.toMatchObject({
      code: "ALREADY_SUBSCRIBED",
    });

    // Avant la fin : rien ne change ; après : l'abonnement s'arrête.
    expect(
      (await endExpiredComplimentarySubscriptions(new Date()))
        .complimentaryEnded,
    ).toBe(0);
    expect(
      (await endExpiredComplimentarySubscriptions(addMonths(until, 0)))
        .complimentaryEnded,
    ).toBe(1);
    expect(
      await db.customerProfile.findUniqueOrThrow({
        where: { id: client.customerId },
      }),
    ).toMatchObject({ status: "CANCELED" });
  });

  it("réservé aux administrateurs autorisés à gérer la facturation", async () => {
    const client = await createCustomer({ subscribe: false });
    const pro = await db.plan.findUniqueOrThrow({ where: { code: "PRO" } });
    await expect(
      activateComplimentarySubscription(client.actor, {
        customerId: client.customerId,
        planId: pro.id,
        months: 1,
        reason: "Moi-même",
      }),
    ).rejects.toThrow();
    const support = await createAdmin("support").catch(() => null);
    if (support) {
      await expect(
        activateComplimentarySubscription(support, {
          customerId: client.customerId,
          planId: pro.id,
          months: 1,
          reason: "Test",
        }),
      ).rejects.toThrow();
    }
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { assignPreparer } from "@/server/services/assignments";
import { createSupplierOrder, markPickedUp, receiveOrder, stockOrder } from "@/server/services/orders";
import { enableAdminPreparerProfile, saveLocation } from "@/server/services/preparers";
import { syncFromExtension } from "@/server/services/marketplace";
import { launchReset, LAUNCH_SETTING_KEY, OWNER_CREDITS } from "@/server/services/launch";
import { actorFor, createAdmin, createCustomer, createPreparerWithLocation, db, resetDb, wallet } from "../helpers";

const WHOP = { BILLING_MODE: "whop", WHOP_API_KEY: "apik_test", WHOP_ACCOUNT_ID: "biz_test", WHOP_WEBHOOK_SECRET: "ws_test" };

async function makeDemo(userId: string, name: string) {
  await db.user.update({ where: { id: userId }, data: { isDemo: true, email: `${name}@demo.packio.local` } });
}

describe("Lancement réel : données de test effacées, comptes réels gardés", () => {
  beforeEach(resetDb);

  it("efface la démo et les tests, garde les réglages, prépare les espaces du propriétaire, une seule fois", async () => {
    // Propriétaire (super administrateur activé) avec son espace préparateur et un point validé.
    const owner = await createAdmin();
    await db.user.update({ where: { id: owner.userId }, data: { email: "fondateur@test.local", passwordHash: "x" } });
    const ownerPrep = await enableAdminPreparerProfile(owner);
    await saveLocation(owner, {
      preparerId: ownerPrep.id,
      type: "POST_OFFICE",
      label: "Poste restante",
      relayName: "Bureau de poste Lille Centre",
      addressLine1: "8 place de la République",
      postalCode: "59000",
      city: "Lille",
      country: "FR",
      recipientName: "Fondateur",
      isPrimary: true,
      validate: true,
    });

    // Monde de démonstration : préparatrice, cliente, commande, stock, vente.
    const demoAdmin = await createAdmin();
    await makeDemo(demoAdmin.userId, "admin");
    const demoPrep = await createPreparerWithLocation(demoAdmin);
    await makeDemo(demoPrep.preparer.userId, "camille");
    const demoClient = await createCustomer({ plan: "PRO" });
    await makeDemo(demoClient.user.id, "lea");
    await assignPreparer(demoAdmin, { customerId: demoClient.customerId, preparerId: demoPrep.preparer.id });
    const zen = await db.supplier.findUniqueOrThrow({ where: { code: "ZENMARKET" } });
    const order = await createSupplierOrder(demoClient.actor, { supplierId: zen.id, locationId: demoPrep.location.id, description: "Veste", quantity: 1 });
    await markPickedUp(demoPrep.actor, { orderId: order.id });
    await receiveOrder(demoPrep.actor, { orderId: order.id, quantityReceived: 1, conditionOk: true });
    await stockOrder(demoPrep.actor, { orderId: order.id, items: [{ name: "Veste", quantity: 1 }] });
    await syncFromExtension(demoClient.customerId, { platform: "VINTED", account: { externalUserId: "d1" }, sales: [{ externalOrderId: "S1", title: "Veste", soldAt: new Date().toISOString() }] });

    // Vrai client inscrit pendant la démo (paiement simulé), attribué à la préparatrice de démo, avec une commande.
    const real = await createCustomer({ plan: "STARTER" });
    await assignPreparer(demoAdmin, { customerId: real.customerId, preparerId: demoPrep.preparer.id });
    await createSupplierOrder(real.actor, { supplierId: zen.id, locationId: demoPrep.location.id, description: "Sac", quantity: 1 });
    const planCount = await db.plan.count();

    // Garde-fous : rien n'est effacé.
    await expect(launchReset({ ownerEmail: "fondateur@test.local", env: { ...WHOP, BILLING_MODE: "dev" } })).rejects.toMatchObject({ code: "LAUNCH_BILLING" });
    await expect(launchReset({ ownerEmail: "fondateur@test.local", env: { ...WHOP, WHOP_WEBHOOK_SECRET: "" } })).rejects.toMatchObject({ code: "LAUNCH_WHOP" });
    await expect(launchReset({ ownerEmail: "inconnu@test.local", env: WHOP })).rejects.toMatchObject({ code: "LAUNCH_OWNER" });
    expect(await db.supplierOrder.count()).toBe(2);

    const report = await launchReset({ ownerEmail: "fondateur@test.local", env: WHOP });
    expect(report).toMatchObject({ alreadyDone: false, demoUsersDeleted: 3 });
    expect(await db.user.count({ where: { email: { endsWith: "@demo.packio.local" } } })).toBe(0);
    for (const table of [db.supplierOrder, db.outboundShipment, db.inventoryItem, db.marketplaceSale, db.payment] as const) {
      expect(await (table as unknown as { count: () => Promise<number> }).count()).toBe(0);
    }
    // Seule écriture de crédits restante : ceux offerts au propriétaire.
    expect(await db.creditTransaction.count()).toBe(1);
    // Les registres en ajout seul sont de nouveau protégés.
    await expect(db.$executeRawUnsafe(`DELETE FROM "credit_transactions"`)).rejects.toThrow(/ajout seul/);
    await expect(db.$executeRawUnsafe(`DELETE FROM "audit_logs"`)).rejects.toThrow(/ajout seul/);
    // Réglages gardés.
    expect(await db.plan.count()).toBe(planCount);

    // Vrai client gardé, remis en attente de paiement.
    expect(await db.customerProfile.findUniqueOrThrow({ where: { id: real.customerId } })).toMatchObject({ status: "PENDING_PAYMENT", currentPreparerId: null, assignmentState: "NOT_REQUESTED" });
    expect(await wallet(real.customerId)).toMatchObject({ monthlyBalance: 0, purchasedBalance: 0, reservedBalance: 0 });

    // Espaces du propriétaire : préparateur gardé (avec son point), client actif, crédits offerts, attribué à lui-même.
    expect(report.owner).toMatchObject({ preparerId: ownerPrep.id, credits: OWNER_CREDITS, assigned: true });
    const ownerClient = await db.customerProfile.findUniqueOrThrow({ where: { id: report.owner!.customerId }, include: { subscriptions: true } });
    expect(ownerClient).toMatchObject({ status: "ACTIVE", currentPreparerId: ownerPrep.id, assignmentState: "ASSIGNED" });
    expect(ownerClient.subscriptions).toHaveLength(1);
    expect(ownerClient.subscriptions[0]).toMatchObject({ status: "ACTIVE", provider: "dev" });
    expect(await wallet(ownerClient.id)).toMatchObject({ purchasedBalance: OWNER_CREDITS });
    expect(await db.preparerLocation.count({ where: { preparerId: ownerPrep.id } })).toBe(1);
    const ownerActor = await actorFor(owner.userId);
    expect(ownerActor.otherSpaces).toEqual(["PREPARER", "CUSTOMER"]);

    // Une seule fois : le second passage ne touche à rien.
    expect(await db.appSetting.findUnique({ where: { key: LAUNCH_SETTING_KEY } })).not.toBeNull();
    await createSupplierOrder(await actorFor(ownerActor.userId).then((a) => ({ ...a, role: "CUSTOMER" as const, customerId: ownerClient.id })), {
      supplierId: zen.id,
      locationId: (await db.preparerLocation.findFirstOrThrow({ where: { preparerId: ownerPrep.id } })).id,
      description: "Vraie commande",
      quantity: 1,
    }).catch(() => null);
    const before = await db.supplierOrder.count();
    expect(await launchReset({ ownerEmail: "fondateur@test.local", env: WHOP })).toMatchObject({ alreadyDone: true });
    expect(await db.supplierOrder.count()).toBe(before);
  });

  it("refusé dès qu'un vrai paiement Whop existe", async () => {
    const owner = await createAdmin();
    await db.user.update({ where: { id: owner.userId }, data: { email: "fondateur@test.local", passwordHash: "x" } });
    const real = await createCustomer({ plan: "STARTER" });
    await db.payment.updateMany({ where: { customerId: real.customerId }, data: { provider: "whop" } });
    expect(await db.payment.count({ where: { provider: "whop" } })).toBeGreaterThan(0);
    await expect(launchReset({ ownerEmail: "fondateur@test.local", env: WHOP })).rejects.toMatchObject({ code: "LAUNCH_REAL_DATA" });
    expect(await db.customerProfile.findUniqueOrThrow({ where: { id: real.customerId } })).toMatchObject({ status: "ACTIVE" });
  });
});

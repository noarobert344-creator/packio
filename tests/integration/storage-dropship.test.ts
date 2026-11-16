import { addDays, addHours } from "date-fns";
import { beforeEach, describe, expect, it } from "vitest";
import { assignPreparer } from "@/server/services/assignments";
import { createSupplierOrder, markPickedUp, receiveOrder, stockOrder } from "@/server/services/orders";
import { classifyShipment, confirmDropOff, confirmLabel, disputeClassification, markReady, requestShipment, retryAwaitingCredits, runShipmentSlaCheck, startPreparation } from "@/server/services/shipments";
import { getSetting } from "@/server/services/settings";
import { updateSettings } from "@/server/services/catalog";
import { adminAdjustCredits } from "@/server/services/credits";
import { getStorageOverview, purchaseStorageSlots, runStorageBilling } from "@/server/services/storage";
import { updateItemDetails } from "@/server/services/inventory";
import { buildZip } from "@/server/lib/zip";
import { saveCreditPack, savePlan } from "@/server/services/catalog";
import type { Actor } from "@/server/auth/actor";
import { createAdmin, createCustomer, createPreparerWithLocation, db, ledgerInvariant, resetDb, wallet } from "../helpers";

const address = { recipientName: "Marie Durand", addressLine1: "5 avenue Jean Jaurès", postalCode: "75019", city: "Paris", country: "FR" };

async function setup(plan: "STARTER" | "PRO" = "STARTER") {
  const admin = await createAdmin();
  const prep = await createPreparerWithLocation(admin);
  const client = await createCustomer({ plan });
  await assignPreparer(admin, { customerId: client.customerId, preparerId: prep.preparer.id });
  return { admin, prep, client };
}

/** Commande vers le stock : ZenMarket ; dropshipping : AliExpress. */
async function supplierId(code: "ZENMARKET" | "ALIEXPRESS" | "VINTED" = "ZENMARKET") {
  return (await db.supplier.findUniqueOrThrow({ where: { code } })).id;
}

async function stocked(customer: Actor, preparer: Actor, locationId: string, qty: number, opts?: { accept?: boolean }) {
  const order = await createSupplierOrder(customer, { supplierId: await supplierId(), locationId, description: "Article", quantity: qty, acceptStorageCharge: opts?.accept });
  await markPickedUp(preparer, { orderId: order.id });
  await receiveOrder(preparer, { orderId: order.id, quantityReceived: qty, conditionOk: true });
  const { items } = await stockOrder(preparer, { orderId: order.id, items: [{ name: "Veste en jean", quantity: qty }] });
  return { order, item: items[0] };
}

async function labelFile(owner: Actor) {
  return db.file.create({
    data: { storageKey: `test/${Date.now()}-${Math.random()}.pdf`, filename: "bordereau-vinted.pdf", mimeType: "application/pdf", sizeBytes: 10, sha256: "x", purpose: "SHIPPING_LABEL", uploadedById: owner.userId },
  });
}

async function drain(admin: Actor, customerId: string) {
  const w = await wallet(customerId);
  const balance = w.monthlyBalance + w.purchasedBalance;
  if (balance > 0) {
    await adminAdjustCredits(admin, { customerId, direction: "DEBIT", amount: balance, bucket: "MONTHLY", reason: "Mise à zéro pour le test", requestId: `drain-${Date.now()}` });
  }
}

describe("Stockage, retours, dropshipping et délai de 48 h", () => {
  beforeEach(resetDb);

  it("offres : 49 €, 95 €, 179 € (1,90 € minimum le crédit) ; 20, 40, 80 crédits ; 5, 10, 20 places ; recharges réévaluées", async () => {
    const plans = await db.plan.findMany({ orderBy: { sortOrder: "asc" } });
    expect(plans.map((p) => [p.code, p.priceCents, p.monthlyCredits, p.storageLimit, p.annualPriceCents])).toEqual([
      ["STARTER", 4900, 20, 5, 53900],
      ["PRO", 9500, 40, 10, 104500],
      ["BUSINESS", 17900, 80, 20, 196900],
    ]);
    const packs = await db.creditPack.findMany({ where: { isActive: true }, orderBy: { credits: "asc" } });
    expect(packs.map((p) => [p.credits, p.priceCents])).toEqual([
      [10, 2990],
      [30, 8490],
      [50, 13490],
      [100, 24900],
    ]);
    // Un crédit de recharge ne coûte jamais moins qu'un crédit inclus dans une offre.
    const minPlanCredit = Math.max(...plans.map((p) => p.priceCents / p.monthlyCredits));
    for (const pk of packs) expect(pk.priceCents / pk.credits).toBeGreaterThanOrEqual(minPlanCredit);
  });

  it("refuse un prix inférieur à 1,90 € le crédit (offre mensuelle et recharge)", async () => {
    const admin = await createAdmin();
    const pro = await db.plan.findUniqueOrThrow({ where: { code: "PRO" } });
    const base = { id: pro.id, code: pro.code, name: pro.name, monthlyCredits: 50, features: pro.features, highlighted: true, isActive: true, sortOrder: 2, annualPriceCents: null };
    await expect(savePlan(admin, { ...base, priceCents: 9400 })).rejects.toMatchObject({ code: "CREDIT_PRICE" });
    await expect(savePlan(admin, { ...base, priceCents: 9500 })).resolves.toBeTruthy();
    const pack = await db.creditPack.findFirstOrThrow({ where: { credits: 100 } });
    await expect(saveCreditPack(admin, { id: pack.id, name: pack.name, credits: 100, priceCents: 18900, isActive: true, sortOrder: 4 })).rejects.toMatchObject({ code: "CREDIT_PRICE" });
    await expect(saveCreditPack(admin, { id: pack.id, name: pack.name, credits: 100, priceCents: 19000, isActive: true, sortOrder: 4 })).resolves.toBeTruthy();
  });

  it("commande au-delà des places : crédits demandés avec accord, 3 places par crédit pour 30 jours", async () => {
    const { prep, client } = await setup();
    await stocked(client.actor, prep.actor, prep.location.id, 3);
    const sid = await supplierId();
    const order = { supplierId: sid, locationId: prep.location.id, description: "Lot de cintres", quantity: 4 };

    await expect(createSupplierOrder(client.actor, order)).rejects.toMatchObject({ code: "STORAGE_CREDITS_REQUIRED" });
    const created = await createSupplierOrder(client.actor, { ...order, acceptStorageCharge: true });
    expect(created.storageCreditsCharged).toBe(1);
    const overview = await getStorageOverview(client.customerId);
    expect([overview.included, overview.extra, overview.capacity, overview.used, overview.incoming]).toEqual([5, 3, 8, 3, 4]);
    expect(overview.purchases[0].expiresAt.getTime() - overview.purchases[0].startsAt.getTime()).toBe(30 * 86_400_000);
    expect(await db.creditTransaction.count({ where: { type: "STORAGE_FEE" } })).toBe(1);
    expect((await wallet(client.customerId)).monthlyBalance).toBe(19);

    // Dans la capacité : aucun débit.
    await createSupplierOrder(client.actor, { ...order, quantity: 1 });
    expect(await db.creditTransaction.count({ where: { type: "STORAGE_FEE" } })).toBe(1);
  });

  it("refuse la commande hors places si le solde est insuffisant", async () => {
    const { admin, prep, client } = await setup();
    await stocked(client.actor, prep.actor, prep.location.id, 5);
    await drain(admin, client.customerId);
    await expect(
      createSupplierOrder(client.actor, { supplierId: await supplierId(), locationId: prep.location.id, description: "Article", quantity: 1, acceptStorageCharge: true }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
  });

  it("achat de places depuis Mon stock : 1 crédit = 3 places, idempotent", async () => {
    const { client } = await setup();
    const a = await purchaseStorageSlots(client.actor, { credits: 2, requestId: "req-123456" });
    const b = await purchaseStorageSlots(client.actor, { credits: 2, requestId: "req-123456" });
    expect(a?.slots).toBe(6);
    expect(b).toBeNull();
    expect((await getStorageOverview(client.customerId)).capacity).toBe(11);
    expect((await wallet(client.customerId)).monthlyBalance).toBe(18);
  });

  it("2 semaines incluses, rappel, puis 1 crédit par article et par période de 2 semaines (sans double prélèvement)", async () => {
    const { prep, client } = await setup();
    const { item } = await stocked(client.actor, prep.actor, prep.location.id, 3);
    const paidUntil = (await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).storagePaidUntil!;
    expect(Math.round((paidUntil.getTime() - Date.now()) / 86_400_000)).toBe(14);

    // Une unité réservée pour une expédition n'est pas facturée.
    await requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 1 }], ...address, labelMode: "PREPARER_PROVIDED" });

    const reminder = await runStorageBilling(addDays(paidUntil, -1));
    expect(reminder.reminded).toBe(1);
    expect((await runStorageBilling(addDays(paidUntil, -1))).reminded).toBe(0);
    expect(await db.notification.count({ where: { userId: client.user.id, type: "STORAGE_REMINDER" } })).toBe(1);

    const run = await runStorageBilling(addHours(paidUntil, 1));
    expect(run.charged).toBe(1);
    expect((await runStorageBilling(addHours(paidUntil, 2))).charged).toBe(0);
    const after = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.storagePaidUntil!.getTime()).toBe(addDays(paidUntil, 14).getTime());
    const fees = await db.creditTransaction.findMany({ where: { type: "STORAGE_FEE" } });
    expect(fees.map((f) => f.amount)).toEqual([-2]);
    const inv = await ledgerInvariant(client.customerId);
    expect(inv.available).toBe(inv.ledgerAvailable);
  });

  it("dépassement faute de crédits : alerte, puis prélèvement dès la recharge", async () => {
    const { admin, prep, client } = await setup();
    const { item } = await stocked(client.actor, prep.actor, prep.location.id, 2);
    const paidUntil = (await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).storagePaidUntil!;
    await drain(admin, client.customerId);

    expect((await runStorageBilling(addHours(paidUntil, 1))).overdue).toBe(1);
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).storageOverdueSince).not.toBeNull();
    expect(await db.notification.count({ where: { userId: client.user.id, type: "STORAGE_OVERDUE" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: admin.userId, type: "STORAGE_OVERDUE" } })).toBe(1);
    // Pas de nouvelle alerte tant que la situation dure.
    await runStorageBilling(addHours(paidUntil, 2));
    expect(await db.notification.count({ where: { userId: client.user.id, type: "STORAGE_OVERDUE" } })).toBe(1);

    // L'ajout de crédits relance automatiquement les prélèvements en attente.
    await adminAdjustCredits(admin, { customerId: client.customerId, direction: "CREDIT", amount: 5, bucket: "PURCHASED", reason: "Recharge de test", requestId: "topup" });
    expect((await retryAwaitingCredits(client.customerId)).storageCharged).toBe(0); // déjà prélevé
    const after = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.storageOverdueSince).toBeNull();
    expect(after.storagePaidUntil!.getTime()).toBeGreaterThan(Date.now());
    expect((await wallet(client.customerId)).purchasedBalance).toBe(3);
  });

  it("retour à domicile : bordereau prépayé du client obligatoire, 1 crédit fixe réservé à la demande, sans classification, débité au dépôt", async () => {
    const { prep, client } = await setup();
    const { item } = await stocked(client.actor, prep.actor, prep.location.id, 2);
    expect((await getSetting("shipping")).returnCredits).toBe(1);
    await expect(
      requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 2 }], ...address, labelMode: "PREPARER_PROVIDED", kind: "RETURN_TO_CUSTOMER" }),
    ).rejects.toMatchObject({ code: "RETURN_LABEL" });

    const before = Date.now();
    const w0 = await wallet(client.customerId);
    const label = await labelFile(client.actor);
    const s = await requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 2 }], ...address, labelMode: "CUSTOMER_PROVIDED", labelFileId: label.id, kind: "RETURN_TO_CUSTOMER" });
    expect(s).toMatchObject({ kind: "RETURN_TO_CUSTOMER", status: "CLASSIFIED", creditCost: 1, creditState: "RESERVED", sizeCategory: null });
    expect(Math.round((s.dueAt!.getTime() - before) / 3_600_000)).toBe(48);
    expect((await wallet(client.customerId)).reservedBalance).toBe(w0.reservedBalance + 1);
    expect(await db.notification.count({ where: { userId: prep.actor.userId, title: "Retour d'articles au client" } })).toBe(1);

    // Coût fixe : ni classification, ni contestation.
    await expect(classifyShipment(prep.actor, { shipmentId: s.id, size: "LARGE" })).rejects.toMatchObject({ code: "RETURN_FIXED" });
    await expect(disputeClassification(client.actor, { shipmentId: s.id, reason: "Je conteste la taille du colis" })).rejects.toMatchObject({ code: "RETURN_FIXED" });

    await startPreparation(prep.actor, { shipmentId: s.id });
    await markReady(prep.actor, { shipmentId: s.id });
    await confirmLabel(prep.actor, { shipmentId: s.id });
    await confirmDropOff(prep.actor, { shipmentId: s.id, carrier: "COLISSIMO", trackingNumber: "6A99999999999" });
    const w1 = await wallet(client.customerId);
    expect(w1.monthlyBalance + w1.purchasedBalance).toBe(w0.monthlyBalance + w0.purchasedBalance - 1);
    expect(w1.reservedBalance).toBe(w0.reservedBalance);
    const inv = await ledgerInvariant(client.customerId);
    expect(inv.available).toBe(inv.ledgerAvailable);
    expect(inv.reserved).toBe(inv.ledgerReserved);
  });

  it("retour à domicile sans crédit disponible : en attente, puis repris après recharge ; coût réglable par l'administration", async () => {
    const { admin, prep, client } = await setup();
    const { item } = await stocked(client.actor, prep.actor, prep.location.id, 1);
    await drain(admin, client.customerId);
    const s = await requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 1 }], ...address, labelMode: "CUSTOMER_PROVIDED", labelFileId: (await labelFile(client.actor)).id, kind: "RETURN_TO_CUSTOMER" });
    expect(s).toMatchObject({ status: "AWAITING_CREDITS", creditCost: 1, creditState: "INSUFFICIENT" });
    await adminAdjustCredits(admin, { customerId: client.customerId, direction: "CREDIT", amount: 1, bucket: "PURCHASED", reason: "Recharge de test", requestId: "topup-retour" });
    await retryAwaitingCredits(client.customerId);
    expect(await db.outboundShipment.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ status: "CLASSIFIED", creditState: "RESERVED" });

    await updateSettings(admin, "shipping", { slaHours: 48, returnCredits: 0 });
    const { item: other } = await stocked(client.actor, prep.actor, prep.location.id, 1);
    const free = await requestShipment(client.actor, { items: [{ itemId: other.id, quantity: 1 }], ...address, labelMode: "CUSTOMER_PROVIDED", labelFileId: (await labelFile(client.actor)).id, kind: "RETURN_TO_CUSTOMER" });
    expect(free).toMatchObject({ status: "CLASSIFIED", creditCost: 0, creditState: "NONE" });
  });

  it("dropshipping : sans place de stock, expédition express créée à la réception avec le bordereau", async () => {
    const { prep, client } = await setup();
    await stocked(client.actor, prep.actor, prep.location.id, 5); // stock plein
    const sid = await supplierId("ALIEXPRESS");
    await expect(
      createSupplierOrder(client.actor, { supplierId: sid, locationId: prep.location.id, description: "Sac vendu", quantity: 1, mode: "DROPSHIP" }),
    ).rejects.toMatchObject({ code: "DROPSHIP_RECIPIENT" });

    const label = await labelFile(client.actor);
    const order = await createSupplierOrder(client.actor, {
      supplierId: sid,
      locationId: prep.location.id,
      description: "Sac vendu sur Vinted",
      quantity: 1,
      mode: "DROPSHIP",
      salePlatform: "VINTED",
      saleReference: "VT-778899",
      labelFileId: label.id,
    });
    expect(order.mode).toBe("DROPSHIP");
    expect(order.storageCreditsCharged).toBe(0);

    await markPickedUp(prep.actor, { orderId: order.id });
    await receiveOrder(prep.actor, { orderId: order.id, quantityReceived: 1, conditionOk: true });
    const { items, shipment } = await stockOrder(prep.actor, { orderId: order.id, items: [{ name: "Sac", quantity: 1 }] });
    expect(items[0].dropship).toBe(true);
    expect(items[0].storagePaidUntil).toBeNull();
    expect(shipment).toMatchObject({ kind: "DROPSHIP", labelMode: "CUSTOMER_PROVIDED", status: "AWAITING_CLASSIFICATION" });
    expect((await db.file.findUniqueOrThrow({ where: { id: label.id } })).shipmentId).toBe(shipment!.id);
    const it = await db.inventoryItem.findUniqueOrThrow({ where: { id: items[0].id } });
    expect([it.quantityAvailable, it.quantityReserved]).toEqual([0, 1]);
    expect((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).dropshipShipmentId).toBe(shipment!.id);
    // Les articles en dropshipping n'occupent pas de place.
    expect((await getStorageOverview(client.customerId)).used).toBe(5);
    // AliExpress n'est proposé qu'en dropshipping.
    await expect(
      createSupplierOrder(client.actor, { supplierId: sid, locationId: prep.location.id, description: "Pour le stock", quantity: 1, acceptStorageCharge: true }),
    ).rejects.toMatchObject({ code: "SUPPLIER_MODE" });
  });

  it("délai de 48 h : alerte unique en cas de retard ; l'attente de crédits suspend le délai", async () => {
    const { admin, prep, client } = await setup();
    const { item } = await stocked(client.actor, prep.actor, prep.location.id, 2);
    const s = await requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 1 }], ...address, labelMode: "PREPARER_PROVIDED" });
    const late = addHours(s.dueAt!, 1);
    expect((await runShipmentSlaCheck(late)).late).toBe(1);
    expect((await runShipmentSlaCheck(late)).late).toBe(0);
    expect(await db.notification.count({ where: { userId: prep.actor.userId, type: "SHIPMENT_LATE" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: admin.userId, type: "SHIPMENT_LATE" } })).toBe(1);

    // Expédition en attente de crédits : pas d'alerte, puis nouveau délai à la reprise.
    const s2 = await requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 1 }], ...address, labelMode: "PREPARER_PROVIDED" });
    await drain(admin, client.customerId);
    await classifyShipment(prep.actor, { shipmentId: s2.id, size: "SMALL" });
    expect((await db.outboundShipment.findUniqueOrThrow({ where: { id: s2.id } })).status).toBe("AWAITING_CREDITS");
    expect((await runShipmentSlaCheck(addHours(s2.dueAt!, 5))).late).toBe(0);
    await adminAdjustCredits(admin, { customerId: client.customerId, direction: "CREDIT", amount: 3, bucket: "PURCHASED", reason: "Recharge de test", requestId: "topup-2" });
    await retryAwaitingCredits(client.customerId);
    const resumed = await db.outboundShipment.findUniqueOrThrow({ where: { id: s2.id } });
    expect(resumed.status).toBe("CLASSIFIED");
    expect(resumed.dueAt!.getTime()).toBeGreaterThan(s2.dueAt!.getTime());
  });

  it("photos produit : le client est prévenu ; archive ZIP valide", async () => {
    const { prep, client } = await setup();
    const { item } = await stocked(client.actor, prep.actor, prep.location.id, 1);
    const photo = await db.file.create({
      data: { storageKey: `test/${item.id}.jpg`, filename: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 3, sha256: "y", purpose: "PRODUCT_PHOTO", uploadedById: prep.actor.userId },
    });
    await updateItemDetails(prep.actor, { itemId: item.id, photoIds: [photo.id] });
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).photosUpdatedAt).not.toBeNull();
    expect(await db.notification.count({ where: { userId: client.user.id, type: "PRODUCT_PHOTOS" } })).toBe(1);

    const zip = buildZip([
      { name: "PK-1-01.jpg", data: Buffer.from("abc") },
      { name: "PK-1-02.jpg", data: Buffer.from("defg") },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50);
    expect(zip.readUInt16LE(end + 10)).toBe(2);
  });
});

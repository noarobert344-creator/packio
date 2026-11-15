import { beforeEach, describe, expect, it } from "vitest";
import { assignPreparer } from "@/server/services/assignments";
import { createSupplierOrder, customerUpdateOrder, markPickedUp, receiveOrder, stockOrder } from "@/server/services/orders";
import {
  adminReclassify,
  cancelShipment,
  classifyShipment,
  confirmDropOff,
  confirmLabel,
  disputeClassification,
  markReady,
  requestShipment,
  startPreparation,
  updateTransit,
} from "@/server/services/shipments";
import { adminAdjustCredits } from "@/server/services/credits";
import { DomainError, ForbiddenError } from "@/server/errors";
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

async function stockedItem(customer: Actor, preparer: Actor, locationId: string, qty = 3) {
  const supplier = await db.supplier.findUniqueOrThrow({ where: { code: "ALIEXPRESS" } });
  const order = await createSupplierOrder(customer, { supplierId: supplier.id, locationId, description: "Coques de téléphone", quantity: qty, trackingNumber: "LP00123456789CN" });
  await markPickedUp(preparer, { orderId: order.id });
  await receiveOrder(preparer, { orderId: order.id, quantityReceived: qty, conditionOk: true });
  const { items } = await stockOrder(preparer, { orderId: order.id, items: [{ name: "Coque iPhone", quantity: qty, storageLocation: "A-12" }] });
  return { order, item: items[0] };
}

async function toLabelReady(preparer: Actor, shipmentId: string) {
  await startPreparation(preparer, { shipmentId });
  await markReady(preparer, { shipmentId });
  const label = await db.file.findFirst({ where: { shipmentId, purpose: "SHIPPING_LABEL" } });
  if (!label) {
    const f = await db.file.create({
      data: { storageKey: `test/${shipmentId}.pdf`, filename: "etiquette.pdf", mimeType: "application/pdf", sizeBytes: 10, sha256: "x", purpose: "SHIPPING_LABEL", uploadedById: preparer.userId },
    });
    await confirmLabel(preparer, { shipmentId, labelFileId: f.id });
  } else {
    await confirmLabel(preparer, { shipmentId });
  }
}

describe("Parcours commande → stock → expédition → crédits", () => {
  beforeEach(resetDb);

  it("parcours complet : réception, stock, classification, réservation puis débit au dépôt", async () => {
    const { prep, client } = await setup();
    const { order, item } = await stockedItem(client.actor, prep.actor, prep.location.id);
    expect((await db.supplierOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("IN_STOCK");
    const events = await db.supplierOrderEvent.findMany({ where: { supplierOrderId: order.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.status)).toEqual(["REGISTERED", "IN_TRANSIT", "PICKED_UP", "RECEIVED", "IN_STOCK"]);

    const shipment = await requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 2 }], ...address, labelMode: "PREPARER_PROVIDED" });
    expect(shipment.status).toBe("AWAITING_CLASSIFICATION");
    let it = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect([it.quantityAvailable, it.quantityReserved]).toEqual([1, 2]);

    const classified = await classifyShipment(prep.actor, { shipmentId: shipment.id, size: "MEDIUM", weightGrams: 800 });
    expect(classified.status).toBe("CLASSIFIED");
    expect(classified.creditCost).toBe(2);
    expect(classified.creditState).toBe("RESERVED");
    expect((await wallet(client.customerId)).reservedBalance).toBe(2);
    expect(await db.notification.count({ where: { userId: client.user.id, type: "PARCEL_CLASSIFIED" } })).toBe(1);

    await toLabelReady(prep.actor, shipment.id);
    const { shipment: dropped } = await confirmDropOff(prep.actor, { shipmentId: shipment.id, carrier: "COLISSIMO", trackingNumber: "6A12345678901" });
    expect(dropped.status).toBe("DROPPED_OFF");
    expect(dropped.creditState).toBe("CAPTURED");
    expect(dropped.trackingUrl).toContain("laposte.fr");
    const w = await wallet(client.customerId);
    expect([w.monthlyBalance, w.reservedBalance, w.consumedTotal]).toEqual([18, 0, 2]);
    it = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect([it.quantityAvailable, it.quantityReserved, it.quantityShipped]).toEqual([1, 0, 2]);

    await updateTransit(prep.actor, { shipmentId: shipment.id, status: "IN_TRANSIT" });
    await updateTransit(prep.actor, { shipmentId: shipment.id, status: "DELIVERED" });
    const inv = await ledgerInvariant(client.customerId);
    expect(inv.available).toBe(inv.ledgerAvailable);
    expect(inv.reserved).toBe(inv.ledgerReserved);
  });

  it("aucun double débit si le dépôt est confirmé plusieurs fois (y compris en parallèle)", async () => {
    const { prep, client } = await setup();
    const { item } = await stockedItem(client.actor, prep.actor, prep.location.id);
    const s = await requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 1 }], ...address, labelMode: "PREPARER_PROVIDED" });
    await classifyShipment(prep.actor, { shipmentId: s.id, size: "LARGE" });
    await toLabelReady(prep.actor, s.id);
    const input = { shipmentId: s.id, carrier: "MONDIAL_RELAY", trackingNumber: "12345678" };
    const results = await Promise.all([confirmDropOff(prep.actor, input), confirmDropOff(prep.actor, input), confirmDropOff(prep.actor, input)]);
    expect(results.filter((r) => !r.alreadyConfirmed)).toHaveLength(1);
    const w = await wallet(client.customerId);
    expect(w.consumedTotal).toBe(3);
    expect(await db.creditTransaction.count({ where: { type: "CAPTURE", shipmentId: s.id } })).toBe(1);
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantityShipped).toBe(1);
  });

  it("solde insuffisant : attente de crédits puis reprise automatique après recharge", async () => {
    const { admin, prep, client } = await setup();
    const { item } = await stockedItem(client.actor, prep.actor, prep.location.id, 3);
    await adminAdjustCredits(admin, { customerId: client.customerId, direction: "DEBIT", amount: 19, bucket: "MONTHLY", reason: "Mise en situation de test", requestId: "t1" });
    const s = await requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 1 }], ...address, labelMode: "PREPARER_PROVIDED" });
    const classified = await classifyShipment(prep.actor, { shipmentId: s.id, size: "LARGE" });
    expect(classified.status).toBe("AWAITING_CREDITS");
    expect(classified.creditState).toBe("INSUFFICIENT");
    expect(await db.notification.count({ where: { userId: client.user.id, type: "CREDITS_INSUFFICIENT" } })).toBe(1);
    await expect(startPreparation(prep.actor, { shipmentId: s.id })).rejects.toBeInstanceOf(DomainError);

    await adminAdjustCredits(admin, { customerId: client.customerId, direction: "CREDIT", amount: 5, bucket: "PURCHASED", reason: "Recharge de test", requestId: "t2" });
    const resumed = await db.outboundShipment.findUniqueOrThrow({ where: { id: s.id } });
    expect(resumed.status).toBe("CLASSIFIED");
    expect(resumed.creditState).toBe("RESERVED");
    expect((await wallet(client.customerId)).reservedBalance).toBe(3);
  });

  it("reclassification avant préparation : ajuste la réservation", async () => {
    const { prep, client } = await setup();
    const { item } = await stockedItem(client.actor, prep.actor, prep.location.id);
    const s = await requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 1 }], ...address, labelMode: "PREPARER_PROVIDED" });
    await classifyShipment(prep.actor, { shipmentId: s.id, size: "LARGE" });
    await classifyShipment(prep.actor, { shipmentId: s.id, size: "SMALL" });
    const w = await wallet(client.customerId);
    expect([w.monthlyBalance, w.reservedBalance]).toEqual([19, 1]);
    const history = await db.shipmentClassification.findMany({ where: { shipmentId: s.id } });
    expect(history).toHaveLength(2);
    expect(history.filter((h) => h.supersededAt === null)).toHaveLength(1);
  });

  it("annulation avant préparation : crédits et stock libérés ; refusée au client ensuite", async () => {
    const { prep, client } = await setup();
    const { item } = await stockedItem(client.actor, prep.actor, prep.location.id);
    const s1 = await requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 2 }], ...address, labelMode: "PREPARER_PROVIDED" });
    await classifyShipment(prep.actor, { shipmentId: s1.id, size: "MEDIUM" });
    const { releasedCredits } = await cancelShipment(client.actor, { shipmentId: s1.id, reason: "Vendu ailleurs" });
    expect(releasedCredits).toBe(2);
    const w = await wallet(client.customerId);
    expect([w.monthlyBalance, w.reservedBalance]).toEqual([20, 0]);
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantityAvailable).toBe(3);

    const s2 = await requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 1 }], ...address, labelMode: "PREPARER_PROVIDED" });
    await classifyShipment(prep.actor, { shipmentId: s2.id, size: "SMALL" });
    await startPreparation(prep.actor, { shipmentId: s2.id });
    await expect(cancelShipment(client.actor, { shipmentId: s2.id, reason: "Trop tard" })).rejects.toThrow(/Annuler/);
  });

  it("le stock disponible ne peut pas être sur-réservé", async () => {
    const { prep, client } = await setup();
    const { item } = await stockedItem(client.actor, prep.actor, prep.location.id, 2);
    await requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 2 }], ...address, labelMode: "PREPARER_PROVIDED" });
    await expect(requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 1 }], ...address, labelMode: "PREPARER_PROVIDED" })).rejects.toThrow(/Stock insuffisant/);
  });

  it("la classification est réservée au préparateur de l'expédition et respecte les règles de taille", async () => {
    const { admin, prep, client } = await setup();
    const other = await createPreparerWithLocation(admin);
    const { item } = await stockedItem(client.actor, prep.actor, prep.location.id);
    const s = await requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 1 }], ...address, labelMode: "PREPARER_PROVIDED" });
    await expect(classifyShipment(other.actor, { shipmentId: s.id, size: "SMALL" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(classifyShipment(client.actor, { shipmentId: s.id, size: "SMALL" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(classifyShipment(prep.actor, { shipmentId: s.id, size: "SMALL", weightGrams: 4000 })).rejects.toThrow(/dépasse/);
  });

  it("contestation puis correction à la baisse après débit : différence restituée", async () => {
    const { admin, prep, client } = await setup();
    const { item } = await stockedItem(client.actor, prep.actor, prep.location.id);
    const s = await requestShipment(client.actor, { items: [{ itemId: item.id, quantity: 1 }], ...address, labelMode: "PREPARER_PROVIDED" });
    await classifyShipment(prep.actor, { shipmentId: s.id, size: "LARGE" });
    await toLabelReady(prep.actor, s.id);
    await confirmDropOff(prep.actor, { shipmentId: s.id, carrier: "COLISSIMO", trackingNumber: "6A99999999999" });
    const incident = await disputeClassification(client.actor, { shipmentId: s.id, reason: "Il s'agissait d'une seule coque, colis petit." });
    expect(incident.type).toBe("CLASSIFICATION_DISPUTE");
    await adminReclassify(admin, { shipmentId: s.id, size: "SMALL", reason: "Photos de préparation vérifiées" });
    const w = await wallet(client.customerId);
    expect(w.consumedTotal).toBe(3);
    expect(w.monthlyBalance + w.purchasedBalance).toBe(17 + 2);
  });

  it("refuse une commande vers un point de réception incompatible avec le fournisseur", async () => {
    const admin = await createAdmin();
    const prep = await createPreparerWithLocation(admin, { locationType: "LOCKER" });
    const client = await createCustomer();
    await assignPreparer(admin, { customerId: client.customerId, preparerId: prep.preparer.id });
    const aliexpress = await db.supplier.findUniqueOrThrow({ where: { code: "ALIEXPRESS" } });
    const vinted = await db.supplier.findUniqueOrThrow({ where: { code: "VINTED" } });
    await expect(
      createSupplierOrder(client.actor, { supplierId: aliexpress.id, locationId: prep.location.id, description: "Lampe", quantity: 1 }),
    ).rejects.toThrow(/ne livre pas/);
    const ok = await createSupplierOrder(client.actor, { supplierId: vinted.id, locationId: prep.location.id, description: "Veste en jean", quantity: 1 });
    await customerUpdateOrder(client.actor, { orderId: ok.id, status: "AT_LOCKER", pickupCode: "483920" });
    expect((await db.supplierOrder.findUniqueOrThrow({ where: { id: ok.id } })).pickupCode).toBe("483920");
    expect(await db.notification.count({ where: { userId: prep.preparer.userId, type: "PARCEL_AT_LOCKER" } })).toBe(1);
  });

  it("bloque les nouvelles opérations sans préparateur attribué", async () => {
    await createAdmin();
    const client = await createCustomer();
    const vinted = await db.supplier.findUniqueOrThrow({ where: { code: "VINTED" } });
    await expect(createSupplierOrder(client.actor, { supplierId: vinted.id, locationId: "x", description: "Test", quantity: 1 })).rejects.toThrow(/préparateur/);
  });
});

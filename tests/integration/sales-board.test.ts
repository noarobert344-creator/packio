import { beforeEach, describe, expect, it } from "vitest";
import { assignPreparer } from "@/server/services/assignments";
import { createSupplierOrder, markPickedUp, receiveOrder, stockOrder } from "@/server/services/orders";
import { updateItemDetails } from "@/server/services/inventory";
import { listForSale, listLabelBoard } from "@/server/queries/sales-board";
import { navBadges } from "@/server/badges";
import { getReceptionInfo } from "@/server/services/orders";
import { saveLocation } from "@/server/services/preparers";
import type { Actor } from "@/server/auth/actor";
import { createAdmin, createCustomer, createPreparerWithLocation, db, resetDb } from "../helpers";

async function setup() {
  const admin = await createAdmin();
  const prep = await createPreparerWithLocation(admin);
  const other = await createPreparerWithLocation(admin);
  const client = await createCustomer({ plan: "STARTER" });
  await assignPreparer(admin, { customerId: client.customerId, preparerId: prep.preparer.id });
  return { admin, prep, other, client };
}

async function receive(customer: Actor, preparer: Actor, locationId: string, input: { code: "ZENMARKET" | "SHEIN"; dropship?: boolean; labelFileId?: string }) {
  const supplier = await db.supplier.findUniqueOrThrow({ where: { code: input.code } });
  const order = await createSupplierOrder(customer, {
    supplierId: supplier.id,
    locationId,
    description: input.dropship ? "Robe vendue sur Vinted" : "Veste",
    quantity: 1,
    ...(input.dropship ? { mode: "DROPSHIP" as const, salePlatform: "VINTED" as const, saleReference: "VT-1", labelFileId: input.labelFileId } : {}),
  });
  await markPickedUp(preparer, { orderId: order.id });
  await receiveOrder(preparer, { orderId: order.id, quantityReceived: 1, conditionOk: true });
  return stockOrder(preparer, { orderId: order.id, items: [{ name: input.dropship ? "Robe" : "Veste en jean", quantity: 1 }] });
}

describe("Bordereaux et À vendre", () => {
  beforeEach(resetDb);

  it("le bordereau arrive avec l'article, visible du client et de sa préparatrice uniquement", async () => {
    const { prep, other, client } = await setup();
    const label = await db.file.create({
      data: { storageKey: `test/${Date.now()}.pdf`, filename: "bordereau-vinted.pdf", mimeType: "application/pdf", sizeBytes: 10, sha256: "x", purpose: "SHIPPING_LABEL", uploadedById: client.actor.userId },
    });
    const { shipment } = await receive(client.actor, prep.actor, prep.location.id, { code: "SHEIN", dropship: true, labelFileId: label.id });

    const board = await listLabelBoard({ preparerId: prep.preparer.id });
    expect(board.openCount).toBe(1);
    expect(board.shipments[0]).toMatchObject({ id: shipment!.id, kind: "DROPSHIP" });
    expect(board.shipments[0].files.map((f) => f.id)).toEqual([label.id]);
    expect(board.shipments[0].items[0].inventoryItem.name).toBe("Robe");
    expect(board.shipments[0].dropshipOrder?.saleReference).toBe("VT-1");

    expect((await listLabelBoard({ customerId: client.customerId })).openCount).toBe(1);
    expect((await listLabelBoard({ preparerId: other.preparer.id })).openCount).toBe(0);
    expect((await navBadges(prep.actor)).bordereaux).toBe(1);
  });

  it("À vendre : article à photographier, puis publié avec ses photos pour le client", async () => {
    const { prep, other, client } = await setup();
    const { items } = await receive(client.actor, prep.actor, prep.location.id, { code: "ZENMARKET" });
    let board = await listForSale({ preparerId: prep.preparer.id });
    expect(board.toShoot.map((i) => i.id)).toEqual([items[0].id]);
    expect(board.ready).toHaveLength(0);
    expect((await navBadges(prep.actor)).photos).toBe(1);

    const photo = await db.file.create({
      data: { storageKey: `test/${items[0].id}.jpg`, filename: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 3, sha256: "y", purpose: "PRODUCT_PHOTO", uploadedById: prep.actor.userId },
    });
    await updateItemDetails(prep.actor, { itemId: items[0].id, photoIds: [photo.id] });

    board = await listForSale({ preparerId: prep.preparer.id });
    expect(board.toShoot).toHaveLength(0);
    expect(board.ready[0].files.map((f) => f.id)).toEqual([photo.id]);
    const forClient = await listForSale({ customerId: client.customerId });
    expect(forClient.ready.map((i) => i.id)).toEqual([items[0].id]);
    expect((await listForSale({ preparerId: other.preparer.id })).ready).toHaveLength(0);
    expect((await navBadges(prep.actor)).photos).toBe(0);
  });

  it("Vinted : le numéro du préparateur est donné au client (numéro du point, sinon celui du préparateur)", async () => {
    const { admin, prep, client } = await setup();
    await db.user.update({ where: { id: prep.actor.userId }, data: { phone: "+33 6 11 22 33 44" } });
    let info = await getReceptionInfo(client.customerId);
    expect(info.locations[0].recipientPhone).toBe("+33 6 11 22 33 44");
    await saveLocation(admin, {
      preparerId: prep.preparer.id,
      locationId: prep.location.id,
      type: "BUSINESS_ADDRESS",
      label: "Adresse professionnelle",
      addressLine1: "10 rue de la République",
      postalCode: "69002",
      city: "Lyon",
      country: "FR",
      recipientName: "Paul P.",
      recipientPhone: "+33 7 55 66 77 88",
      isPrimary: true,
      validate: true,
    });
    info = await getReceptionInfo(client.customerId);
    expect(info.locations[0].recipientPhone).toBe("+33 7 55 66 77 88");
    const vinted = info.suppliers.find((s) => s.code === "VINTED");
    expect(vinted?.compatibilityNotes).toMatch(/numéro de téléphone/);
  });
});

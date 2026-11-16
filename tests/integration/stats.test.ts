import { beforeEach, describe, expect, it } from "vitest";
import { assignPreparer } from "@/server/services/assignments";
import { createSupplierOrder, markPickedUp, receiveOrder, stockOrder } from "@/server/services/orders";
import { confirmDropOff, confirmLabel, markReady, requestShipment, startPreparation } from "@/server/services/shipments";
import { getAccountingSeries, getCustomerStats, getPreparerActivity, monthKey } from "@/server/queries/stats";
import { createAdmin, createCustomer, createPreparerWithLocation, db, resetDb } from "../helpers";

describe("Statistiques et comptabilité", () => {
  beforeEach(resetDb);

  it("client, préparateur et plateforme : colis, crédits consommés et encaissements cohérents avec le registre", async () => {
    const admin = await createAdmin();
    const prep = await createPreparerWithLocation(admin);
    const client = await createCustomer({ plan: "PRO" });
    await assignPreparer(admin, { customerId: client.customerId, preparerId: prep.preparer.id });

    const supplier = await db.supplier.findUniqueOrThrow({ where: { code: "ZENMARKET" } });
    const order = await createSupplierOrder(client.actor, { supplierId: supplier.id, locationId: prep.location.id, description: "Pull", quantity: 1 });
    await markPickedUp(prep.actor, { orderId: order.id });
    await receiveOrder(prep.actor, { orderId: order.id, quantityReceived: 1, conditionOk: true });
    const { items } = await stockOrder(prep.actor, { orderId: order.id, items: [{ name: "Pull", quantity: 1 }] });
    const label = await db.file.create({
      data: { storageKey: `test/${Date.now()}.pdf`, filename: "retour.pdf", mimeType: "application/pdf", sizeBytes: 10, sha256: "x", purpose: "SHIPPING_LABEL", uploadedById: client.actor.userId },
    });
    const ret = await requestShipment(client.actor, {
      items: [{ itemId: items[0].id, quantity: 1 }],
      recipientName: "Moi",
      addressLine1: "1 rue du Test",
      postalCode: "75001",
      city: "Paris",
      country: "FR",
      labelMode: "CUSTOMER_PROVIDED",
      labelFileId: label.id,
      kind: "RETURN_TO_CUSTOMER",
    });
    await startPreparation(prep.actor, { shipmentId: ret.id });
    await markReady(prep.actor, { shipmentId: ret.id });
    await confirmLabel(prep.actor, { shipmentId: ret.id });
    await confirmDropOff(prep.actor, { shipmentId: ret.id, carrier: "COLISSIMO", trackingNumber: "6A00000000001" });

    const month = monthKey(new Date());
    const paid = await db.payment.aggregate({ where: { customerId: client.customerId }, _sum: { amountCents: true, refundedCents: true }, _count: true });
    const spent = (paid._sum.amountCents ?? 0) - (paid._sum.refundedCents ?? 0);

    const customer = await getCustomerStats(client.customerId);
    expect(customer.rows).toHaveLength(6);
    expect(customer.rows.at(-1)).toMatchObject({ month, returns: 1, shippedStock: 0, creditsUsed: 1 });
    expect(customer.totals).toMatchObject({ creditsUsed: 1, spentCents: spent });

    const preparer = await getPreparerActivity(prep.preparer.id);
    expect(preparer.activeClients).toBe(1);
    expect(preparer.rows.at(-1)).toMatchObject({ month, receivedStock: 1, returns: 1, credits: 1 });
    expect(preparer.totals).toMatchObject({ received: 1, shipped: 1, dropship: 0, credits: 1 });

    const platform = await getAccountingSeries();
    expect(platform.at(-1)).toMatchObject({ month, payments: paid._count, netCents: spent, creditsConsumed: 1 });
  });
});

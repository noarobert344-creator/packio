import { beforeEach, describe, expect, it } from "vitest";
import { assignPreparer } from "@/server/services/assignments";
import { createSupplierOrder, markPickedUp, receiveOrder, stockOrder } from "@/server/services/orders";
import { classifyShipment } from "@/server/services/shipments";
import { createManualSale, keepCancelledSaleItems, listMarketplaceOverview, matchSaleToItems, syncFromExtension } from "@/server/services/marketplace";
import { addBusinessDays, exactStockMatch, saleStateFrom, suggestStockItem } from "@/lib/match-title";
import type { Actor } from "@/server/auth/actor";
import { createAdmin, createCustomer, createPreparerWithLocation, db, resetDb, addRelayPoint } from "../helpers";

async function setup() {
  const admin = await createAdmin();
  const prep = await createPreparerWithLocation(admin);
  const relay = await addRelayPoint(admin, prep.preparer.id);
  const client = await createCustomer({ plan: "PRO" });
  await assignPreparer(admin, { customerId: client.customerId, preparerId: prep.preparer.id });
  return { admin, prep, relay, client };
}

async function stock(customer: Actor, preparer: Actor, locationId: string, items: { name: string; quantity: number }[]) {
  const supplier = await db.supplier.findUniqueOrThrow({ where: { code: "ZENMARKET" } });
  const qty = items.reduce((s, i) => s + i.quantity, 0);
  const order = await createSupplierOrder(customer, { supplierId: supplier.id, locationId, description: "Arrivage", quantity: qty });
  await markPickedUp(preparer, { orderId: order.id });
  await receiveOrder(preparer, { orderId: order.id, quantityReceived: qty, conditionOk: true });
  return (await stockOrder(preparer, { orderId: order.id, items })).items;
}

const sync = (customerId: string, sales: unknown[], account = { externalUserId: "u-1", username: "boutique_lea" }) =>
  syncFromExtension(customerId, { platform: "VINTED", account, sales });

describe("Synchronisation des ventes : annulations, colis partis, lots, stock", () => {
  beforeEach(resetDb);

  it("rapprochement par le nom, sans code ; états des plateformes", () => {
    const items = [
      { id: "a", name: "Pull en laine beige — M" },
      { id: "b", name: "Sac à main cuir noir" },
      { id: "c", name: "Jean droit" },
      { id: "d", name: "Jean droit" },
    ];
    expect(exactStockMatch("Pull en laine beige", "M", items)?.id).toBe("a");
    expect(exactStockMatch("SAC À MAIN cuir noir !", null, items)?.id).toBe("b");
    expect(exactStockMatch("Jean droit", null, items)).toBeNull();
    expect(suggestStockItem("Superbe sac à main cuir noir vintage", null, items)?.id).toBe("b");
    expect(suggestStockItem("Jean droit", null, items)).toBeNull();
    expect(saleStateFrom("Transaction annulée")).toBe("cancelled");
    expect(saleStateFrom("shipped")).toBe("shipped");
    expect(saleStateFrom("Commande terminée")).toBe("shipped");
    expect(saleStateFrom("payment_successful")).toBe("active");
    // Vendredi 13 novembre 2026 + 5 jours ouvrés = vendredi 20 novembre.
    expect(addBusinessDays(new Date("2026-11-13T10:00:00Z"), 5).toISOString().slice(0, 10)).toBe("2026-11-20");
  });

  it("détails de la vente, compte d'origine, prise automatique sur le stock et date limite reprise par l'expédition", async () => {
    const { prep, client } = await setup();
    const [pull] = await stock(client.actor, prep.actor, prep.location.id, [{ name: "Pull en laine beige", quantity: 1 }]);
    const shipBy = new Date(Date.now() + 20 * 3_600_000);
    const res = await sync(client.customerId, [
      { externalOrderId: "V-1", title: "Pull en laine beige", size: "M", soldAt: new Date().toISOString(), shipBy: shipBy.toISOString(), photoUrl: "https://images.vinted.net/p.jpg" },
      { externalOrderId: "V-2", title: "Robe midi", size: { weird: true }, soldAt: new Date().toISOString(), shipBy: "pas une date" },
    ]);
    expect(res).toMatchObject({ newSales: 2, shipmentsCreated: 1 });
    const v1 = await db.marketplaceSale.findFirstOrThrow({ where: { externalOrderId: "V-1" }, include: { account: true, shipment: true } });
    expect(v1).toMatchObject({ status: "SHIPMENT_CREATED", size: "M", inventoryItemId: pull.id, shipByEstimated: false, photoUrl: "https://images.vinted.net/p.jpg" });
    expect(v1.account?.username).toBe("boutique_lea");
    // L'échéance du préparateur est la plus proche : date limite Vinted (20 h) plutôt que 48 h.
    expect(Math.abs(v1.shipment!.dueAt!.getTime() - shipBy.getTime())).toBeLessThan(1000);
    expect(v1.shipment!.instructions).toContain("compte boutique_lea");
    // Formats inattendus ignorés sans bloquer ; date limite Vinted estimée (5 jours ouvrés).
    const v2 = await db.marketplaceSale.findFirstOrThrow({ where: { externalOrderId: "V-2" } });
    expect(v2).toMatchObject({ status: "NEW", size: null, shipByEstimated: true });
    expect(v2.shipBy).not.toBeNull();
  });

  it("vente annulée : expédition bloquée avant le dépôt, article remis en stock, client et préparateur prévenus", async () => {
    const { prep, client } = await setup();
    const [veste] = await stock(client.actor, prep.actor, prep.location.id, [{ name: "Veste en jean", quantity: 1 }]);
    const sold = { externalOrderId: "V-10", title: "Veste en jean", soldAt: new Date().toISOString() };
    await sync(client.customerId, [sold]);
    const sale = await db.marketplaceSale.findFirstOrThrow({ where: { externalOrderId: "V-10" } });
    expect(sale.status).toBe("SHIPMENT_CREATED");
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: veste.id } })).quantityReserved).toBe(1);

    const res = await sync(client.customerId, [{ ...sold, status: "Transaction annulée" }]);
    expect(res.cancelled).toBe(1);
    expect(await db.marketplaceSale.findUniqueOrThrow({ where: { id: sale.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await db.outboundShipment.findUniqueOrThrow({ where: { id: sale.shipmentId! } })).toMatchObject({ status: "CANCELLED" });
    expect(await db.inventoryItem.findUniqueOrThrow({ where: { id: veste.id } })).toMatchObject({ quantityAvailable: 1, quantityReserved: 0 });
    expect((await db.notification.findFirstOrThrow({ where: { userId: prep.preparer.userId, title: "Ne pas expédier : vente annulée" } })).link).toContain(sale.shipmentId!);
    expect((await db.notification.findFirstOrThrow({ where: { userId: client.user.id, type: "MARKETPLACE_SALE_CANCELLED" } })).body).toContain("bloquée avant le dépôt");
    // Idempotent : une seconde synchronisation ne refait rien.
    expect((await sync(client.customerId, [{ ...sold, status: "Transaction annulée" }])).cancelled).toBe(0);
    expect((await listMarketplaceOverview(client.customerId, { salesFilter: "annulees" })).saleCounts).toMatchObject({ annulees: 1, packio: 0 });
    // Ventes déjà annulées ou parties quand Packio les découvre : rangées sans alerte.
    const quiet = await sync(client.customerId, [
      { externalOrderId: "OLD-1", title: "Ancienne", soldAt: "2026-01-02T10:00:00Z", status: "cancelled" },
      { externalOrderId: "OLD-2", title: "Ancienne 2", soldAt: "2026-01-03T10:00:00Z", status: "completed" },
    ]);
    expect(quiet.newSales).toBe(0);
    expect(await db.marketplaceSale.findFirstOrThrow({ where: { externalOrderId: "OLD-2" } })).toMatchObject({ status: "SHIPPED_ELSEWHERE" });
  });

  it("dropshipping annulé : rien n'est expédié à la réception, le client garde l'article en stock", async () => {
    const { prep, relay, client } = await setup();
    await sync(client.customerId, [{ externalOrderId: "DS-9", title: "Lampe", soldAt: new Date().toISOString() }]);
    const sale = await db.marketplaceSale.findFirstOrThrow({ where: { externalOrderId: "DS-9" } });
    const aliexpress = await db.supplier.findUniqueOrThrow({ where: { code: "ALIEXPRESS" } });
    const order = await createSupplierOrder(client.actor, {
      supplierId: aliexpress.id,
      locationId: relay.id,
      quantity: 1,
      mode: "DROPSHIP",
      description: "Lampe",
      marketplaceSaleId: sale.id,
      buyerName: "Acheteur",
      buyerAddressLine1: "1 rue A",
      buyerPostalCode: "75001",
      buyerCity: "Paris",
    });
    await sync(client.customerId, [{ externalOrderId: "DS-9", title: "Lampe", soldAt: new Date().toISOString(), status: "cancelled" }]);
    expect((await db.notification.findFirstOrThrow({ where: { userId: client.user.id, type: "MARKETPLACE_SALE_CANCELLED" } })).body).toContain("annulez-la chez le fournisseur");
    await markPickedUp(prep.actor, { orderId: order.id });
    await receiveOrder(prep.actor, { orderId: order.id, quantityReceived: 1, conditionOk: true });
    const { shipment, items } = await stockOrder(prep.actor, { orderId: order.id, items: [{ name: "Lampe", quantity: 1 }] });
    expect(shipment).toBeNull();
    expect(items[0].dropship).toBe(true);
    const card = (await listMarketplaceOverview(client.customerId, { salesFilter: "annulees" })).sales[0];
    expect(card.dropshipOrder?.inventoryItems.map((i) => i.id)).toEqual([items[0].id]);
    expect(await keepCancelledSaleItems(client.actor, sale.id)).toEqual({ kept: 1 });
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: items[0].id } })).dropship).toBe(false);
  });

  it("colis indiqué parti par Vinted : dépôt confirmé tout seul (crédits débités) ; vente jamais traitée → expédiée hors Packio", async () => {
    const { prep, client } = await setup();
    await stock(client.actor, prep.actor, prep.location.id, [{ name: "Chemise blanche", quantity: 1 }]);
    const sold = { externalOrderId: "V-20", title: "Chemise blanche", soldAt: new Date().toISOString() };
    await sync(client.customerId, [sold, { externalOrderId: "V-21", title: "Inconnue", soldAt: new Date().toISOString() }]);
    const sale = await db.marketplaceSale.findFirstOrThrow({ where: { externalOrderId: "V-20" } });
    await classifyShipment(prep.actor, { shipmentId: sale.shipmentId!, size: "SMALL" });
    const res = await sync(client.customerId, [
      { ...sold, status: "shipped" },
      { externalOrderId: "V-21", title: "Inconnue", soldAt: new Date().toISOString(), status: "shipped" },
    ]);
    expect(res.shipped).toBe(2);
    const shipment = await db.outboundShipment.findUniqueOrThrow({ where: { id: sale.shipmentId! } });
    expect(shipment).toMatchObject({ status: "DROPPED_OFF", creditState: "CAPTURED" });
    expect(await db.marketplaceSale.findFirstOrThrow({ where: { externalOrderId: "V-21" } })).toMatchObject({ status: "SHIPPED_ELSEWHERE" });
    expect((await sync(client.customerId, [{ ...sold, status: "shipped" }])).shipped).toBe(0);
  });

  it("vente en lot : un article du stock par ligne, un seul carton et un seul bordereau", async () => {
    const { prep, client } = await setup();
    const [robe, sac] = await stock(client.actor, prep.actor, prep.location.id, [
      { name: "Robe fleurie", quantity: 1 },
      { name: "Sac rouge", quantity: 1 },
    ]);
    await sync(client.customerId, [
      {
        externalOrderId: "LOT-1",
        title: "Lot de 2 articles",
        soldAt: new Date().toISOString(),
        items: [
          { externalItemId: "i1", title: "Robe fleurie", size: "S" },
          { externalItemId: "i2", title: "Ceinture" },
        ],
      },
    ]);
    const sale = await db.marketplaceSale.findFirstOrThrow({ where: { externalOrderId: "LOT-1" }, include: { lines: { orderBy: { position: "asc" } } } });
    // Une ligne reconnue (Robe), l'autre non : le client complète.
    expect(sale.status).toBe("NEW");
    expect(sale.lines.map((l) => l.inventoryItemId)).toEqual([robe.id, null]);
    await expect(matchSaleToItems(client.actor, { saleId: sale.id, itemIds: [robe.id] })).rejects.toMatchObject({ code: "ITEMS" });
    await matchSaleToItems(client.actor, { saleId: sale.id, itemIds: [robe.id, sac.id] });
    const done = await db.marketplaceSale.findUniqueOrThrow({ where: { id: sale.id }, include: { shipment: { include: { items: true } } } });
    expect(done.status).toBe("SHIPMENT_CREATED");
    expect(done.shipment!.items.map((i) => i.inventoryItemId).sort()).toEqual([robe.id, sac.id].sort());
    expect(done.shipment!.instructions).toContain("lot de 2 articles");
  });

  it("vente ajoutée à la main, avec son bordereau ; même nom qu'un article du stock → expédiée", async () => {
    const { prep, client } = await setup();
    await stock(client.actor, prep.actor, prep.location.id, [{ name: "Casquette bleue", quantity: 1 }]);
    const label = await db.file.create({
      data: { storageKey: "x/label.pdf", filename: "label.pdf", mimeType: "application/pdf", sizeBytes: 10, sha256: "0".repeat(64), purpose: "SHIPPING_LABEL", uploadedById: client.user.id, customerId: client.customerId },
    });
    const sale = await createManualSale(client.actor, { platform: "OTHER", title: "Casquette bleue", labelFileId: label.id });
    expect(sale).toMatchObject({ manual: true, status: "SHIPMENT_CREATED" });
    expect((await db.file.findUniqueOrThrow({ where: { id: label.id } })).shipmentId).toBe(sale.shipmentId);
    const other = await createManualSale(client.actor, { platform: "VINTED", title: "Article inconnu", externalOrderId: "123" });
    expect(other.status).toBe("NEW");
    await expect(createManualSale(client.actor, { platform: "VINTED", title: "Doublon", externalOrderId: "123" })).rejects.toMatchObject({ code: "DUPLICATE" });
    await expect(createManualSale(client.actor, { platform: "VINTED", title: "Bordereau réutilisé", labelFileId: label.id })).rejects.toMatchObject({ code: "LABEL" });
  });
});

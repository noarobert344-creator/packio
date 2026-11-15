import { beforeEach, describe, expect, it } from "vitest";
import { assignPreparer } from "@/server/services/assignments";
import { createSupplierOrder, markPickedUp, receiveOrder, stockOrder } from "@/server/services/orders";
import {
  attachSaleLabel,
  authenticateExtensionToken,
  createExtensionToken,
  ignoreSale,
  linkListingToItem,
  matchSaleToItem,
  revokeExtensionToken,
  syncFromExtension,
} from "@/server/services/marketplace";
import { POST as syncRoute } from "@/app/api/extension/sync/route";
import { GET as statusRoute } from "@/app/api/extension/status/route";
import type { Actor } from "@/server/auth/actor";
import { createAdmin, createCustomer, createPreparerWithLocation, db, resetDb } from "../helpers";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n");

async function setup() {
  const admin = await createAdmin();
  const prep = await createPreparerWithLocation(admin);
  const client = await createCustomer({ plan: "PRO" });
  await assignPreparer(admin, { customerId: client.customerId, preparerId: prep.preparer.id });
  return { admin, prep, client };
}

async function stockedItem(customer: Actor, preparer: Actor, locationId: string, qty = 2) {
  const supplier = await db.supplier.findUniqueOrThrow({ where: { code: "ALIEXPRESS" } });
  const order = await createSupplierOrder(customer, { supplierId: supplier.id, locationId, description: "Vestes en jean", quantity: qty });
  await markPickedUp(preparer, { orderId: order.id });
  await receiveOrder(preparer, { orderId: order.id, quantityReceived: qty, conditionOk: true });
  const { items } = await stockOrder(preparer, { orderId: order.id, items: [{ name: "Veste en jean Levi's", quantity: qty, storageLocation: "B-02" }] });
  return items[0];
}

function request(path: string, init: { token?: string; body?: unknown; method?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.origin) headers.origin = init.origin;
  return new Request(`http://localhost${path}`, { method: init.method ?? "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

describe("Comptes liés Vinted / Vestiaire et extension", () => {
  beforeEach(resetDb);

  it("jetons : authentification valide, refus d'un jeton inconnu, malformé ou révoqué ; 5 jetons actifs au plus", async () => {
    const { actor, customerId } = await createCustomer({ plan: "STARTER" });
    const { id, token } = await createExtensionToken(actor, "Chrome bureau");
    expect(token).toMatch(/^pkx_[A-Za-z0-9_-]{40}$/);
    expect(await authenticateExtensionToken(token)).toBe(customerId);
    expect(await authenticateExtensionToken(`pkx_${"a".repeat(40)}`)).toBeNull();
    expect(await authenticateExtensionToken("n'importe quoi")).toBeNull();
    const stored = await db.extensionToken.findUniqueOrThrow({ where: { id } });
    expect(stored.tokenHash).not.toContain(token.slice(4));
    expect(stored.lastUsedAt).not.toBeNull();

    await revokeExtensionToken(actor, id);
    expect(await authenticateExtensionToken(token)).toBeNull();
    expect(await db.auditLog.count({ where: { action: { in: ["extension.token_created", "extension.token_revoked"] } } })).toBe(2);

    for (let i = 0; i < 5; i++) await createExtensionToken(actor, `Jeton ${i}`);
    await expect(createExtensionToken(actor, "Sixième")).rejects.toThrow(/5 jetons actifs/);
  });

  it("synchronisation idempotente, rattachement automatique par SKU et expédition créée pour une vente", async () => {
    const { prep, client } = await setup();
    const item = await stockedItem(client.actor, prep.actor, prep.location.id, 2);
    const payload = {
      platform: "VINTED",
      account: { externalUserId: 123456, username: "chloe_vintage" },
      listings: [
        { externalId: "9001", title: "Veste en jean Levi's taille M", description: `Très bon état. Réf. ${item.sku.toLowerCase()}`, priceCents: 3500, status: "active" },
        { externalId: "9002", title: "Robe d'été", priceCents: 1500 },
      ],
      sales: [{ externalOrderId: "T-777", externalItemId: 9001, title: "Veste en jean Levi's taille M", priceCents: 3500, buyerName: "marie_d", soldAt: new Date().toISOString() }],
    };

    const first = await syncFromExtension(client.customerId, payload);
    expect(first).toEqual({ listings: 2, linkedListings: 1, newSales: 1, shipmentsCreated: 1 });
    const second = await syncFromExtension(client.customerId, payload);
    expect(second).toMatchObject({ newSales: 0, shipmentsCreated: 0, linkedListings: 0 });

    expect(await db.marketplaceAccount.count({ where: { customerId: client.customerId } })).toBe(1);
    expect(await db.marketplaceListing.count({ where: { customerId: client.customerId } })).toBe(2);
    const listing = await db.marketplaceListing.findFirstOrThrow({ where: { externalId: "9001" } });
    expect(listing).toMatchObject({ inventoryItemId: item.id, status: "sold" });

    const sale = await db.marketplaceSale.findFirstOrThrow({ where: { externalOrderId: "T-777" }, include: { shipment: { include: { items: true } } } });
    expect(sale.status).toBe("SHIPMENT_CREATED");
    expect(sale.shipment).toMatchObject({ kind: "SALE", labelMode: "PREPARER_PROVIDED", recipientName: "marie_d", status: "AWAITING_CLASSIFICATION", preparerId: prep.preparer.id });
    expect(sale.shipment!.items).toEqual([expect.objectContaining({ inventoryItemId: item.id, quantity: 1 })]);
    const after = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    expect([after.quantityAvailable, after.quantityReserved]).toEqual([1, 1]);
    expect(await db.outboundShipment.count({ where: { customerId: client.customerId } })).toBe(1);
    expect(await db.notification.count({ where: { userId: client.user.id, type: "MARKETPLACE_SALE" } })).toBe(1);
  });

  it("bordereau : rattaché à l'expédition, mode d'étiquette basculé, préparateur prévenu, envoi en double ignoré", async () => {
    const { prep, client } = await setup();
    const item = await stockedItem(client.actor, prep.actor, prep.location.id, 1);
    await syncFromExtension(client.customerId, {
      platform: "VINTED",
      account: { externalUserId: "u1" },
      listings: [{ externalId: "L1", title: `Veste ${item.sku}` }],
      sales: [{ externalOrderId: "T-1", externalItemId: "L1", title: "Veste", soldAt: new Date().toISOString() }],
    });
    const sale = await db.marketplaceSale.findFirstOrThrow({ where: { externalOrderId: "T-1" } });

    const a = await attachSaleLabel(client.customerId, { platform: "VINTED", externalOrderId: "T-1", filename: "bordereau-vinted.pdf", data: PDF });
    expect(a).toMatchObject({ duplicate: false, shipmentId: sale.shipmentId });
    const b = await attachSaleLabel(client.customerId, { platform: "VINTED", externalOrderId: "T-1", filename: "bordereau-vinted.pdf", data: PDF });
    expect(b).toMatchObject({ duplicate: true, fileId: a.fileId });

    const shipment = await db.outboundShipment.findUniqueOrThrow({ where: { id: sale.shipmentId! }, include: { files: true } });
    expect(shipment.labelMode).toBe("CUSTOMER_PROVIDED");
    expect(shipment.files.filter((f) => f.purpose === "SHIPPING_LABEL")).toHaveLength(1);
    expect(await db.notification.count({ where: { userId: prep.actor.userId, title: "Bordereau disponible" } })).toBe(1);

    await expect(attachSaleLabel(client.customerId, { platform: "VINTED", externalOrderId: "T-1", filename: "x.txt", data: Buffer.from("pas un pdf, juste du texte") })).rejects.toThrow(/Format/);
    await expect(attachSaleLabel(client.customerId, { platform: "VINTED", externalOrderId: "INCONNU", filename: "b.pdf", data: PDF })).rejects.toThrow(/Vente inconnue/);
  });

  it("vente non identifiée : association manuelle à un article (expédition avec le bordereau déjà reçu), ou vente ignorée", async () => {
    const { prep, client } = await setup();
    const item = await stockedItem(client.actor, prep.actor, prep.location.id, 2);
    await syncFromExtension(client.customerId, {
      platform: "VESTIAIRE",
      account: { externalUserId: "v-42" },
      sales: [
        { externalOrderId: "V-1", title: "Sac", soldAt: new Date().toISOString() },
        { externalOrderId: "V-2", title: "Foulard", soldAt: new Date().toISOString() },
      ],
    });
    const v1 = await db.marketplaceSale.findFirstOrThrow({ where: { externalOrderId: "V-1" } });
    expect(v1.status).toBe("NEW");
    await attachSaleLabel(client.customerId, { platform: "VESTIAIRE", externalOrderId: "V-1", filename: "label.pdf", data: PDF });
    expect((await db.marketplaceSale.findUniqueOrThrow({ where: { id: v1.id } })).shipmentId).toBeNull();

    const matched = await matchSaleToItem(client.actor, { saleId: v1.id, itemId: item.id });
    expect(matched.status).toBe("SHIPMENT_CREATED");
    const shipment = await db.outboundShipment.findUniqueOrThrow({ where: { id: matched.shipmentId! } });
    expect(shipment.labelMode).toBe("CUSTOMER_PROVIDED");
    await expect(matchSaleToItem(client.actor, { saleId: v1.id, itemId: item.id })).rejects.toThrow(/existe déjà/);

    const v2 = await db.marketplaceSale.findFirstOrThrow({ where: { externalOrderId: "V-2" } });
    expect((await ignoreSale(client.actor, v2.id)).status).toBe("IGNORED");
  });

  it("rattacher une annonce traite les ventes en attente ; sans stock, la vente reste identifiée avec une note", async () => {
    const { prep, client } = await setup();
    const item = await stockedItem(client.actor, prep.actor, prep.location.id, 1);
    await syncFromExtension(client.customerId, {
      platform: "VINTED",
      account: { externalUserId: "u1" },
      listings: [{ externalId: "A" , title: "Veste" }, { externalId: "B", title: "Veste bis" }],
      sales: [
        { externalOrderId: "S-A", externalItemId: "A", title: "Veste", soldAt: new Date().toISOString() },
        { externalOrderId: "S-B", externalItemId: "B", title: "Veste bis", soldAt: new Date().toISOString() },
      ],
    });
    const [la, lb] = await Promise.all([db.marketplaceListing.findFirstOrThrow({ where: { externalId: "A" } }), db.marketplaceListing.findFirstOrThrow({ where: { externalId: "B" } })]);
    expect(await linkListingToItem(client.actor, { listingId: la.id, itemId: item.id })).toEqual({ shipments: 1 });
    // Plus de stock disponible pour la seconde vente.
    expect(await linkListingToItem(client.actor, { listingId: lb.id, itemId: item.id })).toEqual({ shipments: 0 });
    const sb = await db.marketplaceSale.findFirstOrThrow({ where: { externalOrderId: "S-B" } });
    expect(sb.status).toBe("MATCHED");
    expect(sb.notes).toMatch(/plus disponible/);
  });

  it("isolation : un client ne peut ni lire ni modifier les annonces, ventes ou jetons d'un autre", async () => {
    const { prep, client } = await setup();
    const other = await createCustomer({ plan: "STARTER" });
    const item = await stockedItem(client.actor, prep.actor, prep.location.id, 1);
    await syncFromExtension(client.customerId, {
      platform: "VINTED",
      account: { externalUserId: "u1" },
      listings: [{ externalId: "A", title: "Veste" }],
      sales: [{ externalOrderId: "S-A", title: "Veste", soldAt: new Date().toISOString() }],
    });
    const listing = await db.marketplaceListing.findFirstOrThrow({ where: { customerId: client.customerId } });
    const sale = await db.marketplaceSale.findFirstOrThrow({ where: { customerId: client.customerId } });
    const { id: tokenId } = await createExtensionToken(client.actor, "Client 1");

    await expect(linkListingToItem(other.actor, { listingId: listing.id, itemId: null })).rejects.toThrow(/introuvable/);
    await expect(matchSaleToItem(other.actor, { saleId: sale.id, itemId: item.id })).rejects.toThrow(/introuvable/);
    await expect(ignoreSale(other.actor, sale.id)).rejects.toThrow(/introuvable/);
    await expect(revokeExtensionToken(other.actor, tokenId)).rejects.toThrow(/introuvable/);
    // Un client ne peut pas associer sa vente à l'article d'un autre client.
    const otherSale = await syncFromExtension(other.customerId, { platform: "VINTED", account: { externalUserId: "u2" }, sales: [{ externalOrderId: "S-A", title: "Autre", soldAt: new Date().toISOString() }] });
    expect(otherSale.newSales).toBe(1);
    const theirSale = await db.marketplaceSale.findFirstOrThrow({ where: { customerId: other.customerId } });
    await expect(matchSaleToItem(other.actor, { saleId: theirSale.id, itemId: item.id })).rejects.toThrow(/introuvable/);
    // Le bordereau d'une vente n'est rattachable qu'avec le jeton de son propriétaire.
    await expect(attachSaleLabel(other.customerId, { platform: "VINTED", externalOrderId: "INCONNUE", filename: "b.pdf", data: PDF })).rejects.toThrow(/Vente inconnue/);
  });

  it("routes de l'extension : 401 sans jeton valide, 400 si données invalides, 200 et CORS pour une extension", async () => {
    const { actor, customerId } = await createCustomer({ plan: "STARTER" });
    const { token } = await createExtensionToken(actor, "Test");
    const body = { platform: "VINTED", account: { externalUserId: "1" }, listings: [{ externalId: "X", title: "Pull" }] };

    expect((await syncRoute(request("/api/extension/sync", { body }))).status).toBe(401);
    expect((await syncRoute(request("/api/extension/sync", { body, token: `pkx_${"b".repeat(40)}` }))).status).toBe(401);
    expect((await syncRoute(request("/api/extension/sync", { body: { platform: "EBAY" }, token }))).status).toBe(400);

    const ok = await syncRoute(request("/api/extension/sync", { body, token, origin: "chrome-extension://abcdefghijklmnop" }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("chrome-extension://abcdefghijklmnop");
    expect(await ok.json()).toMatchObject({ ok: true, listings: 1 });
    const evil = await syncRoute(request("/api/extension/sync", { body, token, origin: "https://evil.example" }));
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();

    const status = await statusRoute(request("/api/extension/status", { token, method: "GET" }));
    expect(await status.json()).toMatchObject({ ok: true, accounts: [expect.objectContaining({ platform: "VINTED" })] });
    expect(await db.marketplaceListing.count({ where: { customerId } })).toBe(1);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { assignPreparer } from "@/server/services/assignments";
import { createSupplierOrder, markPickedUp, receiveOrder, stockOrder } from "@/server/services/orders";
import {
  attachSaleLabel,
  authenticateExtensionToken,
  createExtensionToken,
  deleteSale,
  linkListingToItem,
  matchSaleToItem,
  revokeExtensionToken,
  syncFromExtension,
} from "@/server/services/marketplace";
import { POST as syncRoute } from "@/app/api/extension/sync/route";
import { DELETE as disconnectRoute, GET as statusRoute } from "@/app/api/extension/status/route";
import { listMarketplaceOverview } from "@/server/services/marketplace";
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
  const supplier = await db.supplier.findUniqueOrThrow({ where: { code: "ZENMARKET" } });
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

  it("vente non identifiée : « Vendu avec Packio » (expédition avec le bordereau déjà reçu), ou « Supprimer »", async () => {
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
    expect((await deleteSale(client.actor, v2.id)).status).toBe("IGNORED");
    // Une vente expédiée par Packio ne se supprime pas tant que l'expédition est active.
    await expect(deleteSale(client.actor, v1.id)).rejects.toThrow(/annulez d'abord/);
  });

  it("« Supprimer » : acheteur et bordereau effacés, vente masquée, ni recréée ni réactivée par la synchronisation", async () => {
    const { client } = await setup();
    const sale = { externalOrderId: "VT-9", title: "Robe vendue en direct", buyerName: "Acheteuse Test", soldAt: new Date().toISOString() };
    await syncFromExtension(client.customerId, { platform: "VINTED", account: { externalUserId: "u9" }, sales: [sale] });
    const row = await db.marketplaceSale.findFirstOrThrow({ where: { customerId: client.customerId, externalOrderId: "VT-9" } });
    const { fileId } = await attachSaleLabel(client.customerId, { platform: "VINTED", externalOrderId: "VT-9", filename: "b.pdf", data: PDF });
    expect((await listMarketplaceOverview(client.customerId, { salesFilter: "a-traiter" })).saleCounts).toMatchObject({ toutes: 1, "a-traiter": 1, packio: 0 });

    await deleteSale(client.actor, row.id);
    const deleted = await db.marketplaceSale.findUniqueOrThrow({ where: { id: row.id } });
    expect(deleted).toMatchObject({ status: "IGNORED", buyerName: null });
    expect((await db.file.findUniqueOrThrow({ where: { id: fileId! } })).deletedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "marketplace.sale_deleted", entityId: client.customerId } })).toBe(1);
    const overview = await listMarketplaceOverview(client.customerId);
    expect(overview.sales).toHaveLength(0);
    expect(overview.saleCounts).toEqual({ toutes: 0, "a-traiter": 0, packio: 0 });

    // Nouvelle synchronisation et nouveau bordereau : rien n'est recréé ni conservé.
    expect((await syncFromExtension(client.customerId, { platform: "VINTED", account: { externalUserId: "u9" }, sales: [sale] })).newSales).toBe(0);
    const label = await attachSaleLabel(client.customerId, { platform: "VINTED", externalOrderId: "VT-9", filename: "b2.pdf", data: Buffer.concat([PDF, Buffer.from(" ")]) });
    expect(label).toMatchObject({ fileId: null, ignored: true });
    expect(await db.file.count({ where: { marketplaceSaleId: row.id, deletedAt: null } })).toBe(0);
    await expect(matchSaleToItem(client.actor, { saleId: row.id, itemId: "inexistant" })).rejects.toThrow(/supprimée/);
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
    await expect(deleteSale(other.actor, sale.id)).rejects.toThrow(/introuvable/);
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

  it("déconnexion par l'extension : seul le jeton présenté est révoqué, une seule fois, et c'est journalisé", async () => {
    const { actor, customerId } = await createCustomer({ plan: "STARTER" });
    const old = await createExtensionToken(actor, "Connexion automatique (navigateur)");
    const fresh = await createExtensionToken(actor, "Connexion automatique (navigateur)");

    const res = await disconnectRoute(request("/api/extension/status", { token: old.token, method: "DELETE", origin: "chrome-extension://abcdefghijklmnop" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revoked: true });
    expect(res.headers.get("access-control-allow-methods")).toContain("DELETE");
    expect(await authenticateExtensionToken(old.token)).toBeNull();
    expect(await authenticateExtensionToken(fresh.token)).toBe(customerId);

    expect(await (await disconnectRoute(request("/api/extension/status", { token: old.token, method: "DELETE" }))).json()).toEqual({ ok: true, revoked: false });
    expect(await (await disconnectRoute(request("/api/extension/status", { method: "DELETE" }))).json()).toEqual({ ok: true, revoked: false });
    expect(await db.auditLog.count({ where: { action: "extension.token_revoked", entityId: customerId } })).toBe(1);
  });
});

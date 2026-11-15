import { beforeEach, describe, expect, it } from "vitest";
import { assignPreparer } from "@/server/services/assignments";
import { addItemManually, getItemForActor } from "@/server/services/inventory";
import { createSupplierOrder, getOrderForActor, markPickedUp } from "@/server/services/orders";
import { getShipmentForActor, requestShipment } from "@/server/services/shipments";
import { getConversationAccess, listConversations, requestSupervisionAccess, sendMessage, getMessages } from "@/server/services/messaging";
import { assertCanReadFile, sniffMime, uploadFile } from "@/server/services/files";
import { setStorageDriverForTests } from "@/server/storage";
import { ForbiddenError } from "@/server/errors";
import { createAdmin, createCustomer, createPreparerWithLocation, db, resetDb } from "../helpers";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001", "hex");

describe("Contrôles d'accès côté serveur", () => {
  beforeEach(async () => {
    await resetDb();
    const memory = new Map<string, Buffer>();
    setStorageDriverForTests({
      put: async (k, d) => void memory.set(k, d),
      get: async (k) => memory.get(k) ?? null,
      delete: async (k) => void memory.delete(k),
      signedUrl: async () => null,
    });
  });

  async function twoClients() {
    const admin = await createAdmin();
    const p1 = await createPreparerWithLocation(admin);
    const p2 = await createPreparerWithLocation(admin);
    const a = await createCustomer();
    const b = await createCustomer();
    const { conversationId } = await assignPreparer(admin, { customerId: a.customerId, preparerId: p1.preparer.id });
    await assignPreparer(admin, { customerId: b.customerId, preparerId: p2.preparer.id });
    return { admin, p1, p2, a, b, conversationId };
  }

  it("un client ne peut consulter ni les commandes, ni le stock, ni les expéditions d'un autre client", async () => {
    const { p1, a, b } = await twoClients();
    const vinted = await db.supplier.findUniqueOrThrow({ where: { code: "VINTED" } });
    const order = await createSupplierOrder(a.actor, { supplierId: vinted.id, locationId: p1.location.id, description: "Sac", quantity: 1 });
    const item = await addItemManually(p1.actor, { customerId: a.customerId, name: "Sac", quantity: 1 });
    const shipment = await requestShipment(a.actor, { items: [{ itemId: item.id, quantity: 1 }], recipientName: "X", addressLine1: "1 rue", postalCode: "75001", city: "Paris", country: "FR", labelMode: "PREPARER_PROVIDED" });

    await expect(getOrderForActor(b.actor, order.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getItemForActor(b.actor, item.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getShipmentForActor(b.actor, shipment.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestShipment(b.actor, { items: [{ itemId: item.id, quantity: 1 }], recipientName: "X", addressLine1: "1 rue", postalCode: "75001", city: "Paris", country: "FR", labelMode: "PREPARER_PROVIDED" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("un préparateur ne voit que ses clients attribués", async () => {
    const { p1, p2, a } = await twoClients();
    const vinted = await db.supplier.findUniqueOrThrow({ where: { code: "VINTED" } });
    const order = await createSupplierOrder(a.actor, { supplierId: vinted.id, locationId: p1.location.id, description: "Robe", quantity: 1 });
    await expect(getOrderForActor(p2.actor, order.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(markPickedUp(p2.actor, { orderId: order.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addItemManually(p2.actor, { customerId: a.customerId, name: "Intrus", quantity: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getOrderForActor(p1.actor, order.id)).id).toBe(order.id);
  });

  it("un administrateur sans permission opérations ne consulte pas les opérations", async () => {
    const { p1, a } = await twoClients();
    const item = await addItemManually(p1.actor, { customerId: a.customerId, name: "Montre", quantity: 1 });
    const limited = await db.role.create({ data: { key: "billing_only", name: "Facturation", permissions: ["billing.read"] } });
    const admin = await createAdmin(limited.key);
    await expect(getItemForActor(admin, item.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("messagerie : accès limité aux participants ; supervision admin encadrée et tracée", async () => {
    const { admin, p1, p2, a, b, conversationId } = await twoClients();
    await sendMessage(a.actor, { conversationId, body: "Bonjour, mon colis arrive demain." });
    await expect(getConversationAccess(b.actor, conversationId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getConversationAccess(p2.actor, conversationId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getMessages(admin, conversationId)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listConversations(b.actor)).map((c) => c.id)).not.toContain(conversationId);

    await expect(requestSupervisionAccess(admin, { conversationId, reason: "court" })).rejects.toThrow(/motif/i);
    await requestSupervisionAccess(admin, { conversationId, reason: "Litige signalé par le client sur un colis abîmé" });
    const access = await getConversationAccess(admin, conversationId);
    expect(access).toMatchObject({ mode: "supervision", canWrite: false });
    expect(await db.auditLog.count({ where: { action: "conversation.supervision_access", entityId: conversationId } })).toBe(1);
    const system = await db.message.findFirst({ where: { conversationId, kind: "SYSTEM", body: { contains: "consulte" } } });
    expect(system).not.toBeNull();
    const unread = (await listConversations(p1.actor)).find((c) => c.id === conversationId)!.unread;
    expect(unread).toBe(1);
  });

  it("fichiers : contrôle du type réel et des droits de lecture", async () => {
    const { p1, a, b } = await twoClients();
    expect(sniffMime(PNG)).toBe("image/png");
    await expect(uploadFile(a.actor, { purpose: "ORDER_PHOTO", filename: "faux.png", data: Buffer.from("<script>alert(1)</script> padding padding") })).rejects.toThrow(/Format/);
    const file = await uploadFile(a.actor, { purpose: "ORDER_PHOTO", filename: "photo.png", data: PNG });
    expect(file.customerId).toBe(a.customerId);
    expect(file.preparerId).toBe(p1.preparer.id);
    await expect(assertCanReadFile(b.actor, file)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assertCanReadFile(p1.actor, file)).resolves.toBeUndefined();
    await expect(uploadFile(p1.actor, { purpose: "RECEPTION_PHOTO", filename: "x.png", data: PNG, customerId: b.customerId })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

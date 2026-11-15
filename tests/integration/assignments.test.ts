import { beforeEach, describe, expect, it } from "vitest";
import { assignPreparer, computeSla, reassignCustomer, runAssignmentSlaCheck, notifyCustomerOfDelay } from "@/server/services/assignments";
import { addItemManually } from "@/server/services/inventory";
import { getConversationAccess } from "@/server/services/messaging";
import { ForbiddenError } from "@/server/errors";
import { actorFor, createAdmin, createCustomer, createPreparerWithLocation, db, resetDb } from "../helpers";

describe("Attribution manuelle des préparateurs", () => {
  beforeEach(resetDb);

  it("après paiement : compte actif, attente d'attribution, échéance 24 h et alerte admin — sans attribution automatique", async () => {
    const admin = await createAdmin();
    await createPreparerWithLocation(admin); // un préparateur disponible existe
    const { customerId } = await createCustomer();
    const customer = await db.customerProfile.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.status).toBe("ACTIVE");
    expect(customer.assignmentState).toBe("PENDING");
    expect(customer.currentPreparerId).toBeNull();
    const hours = (customer.assignmentDueAt!.getTime() - customer.assignmentRequestedAt!.getTime()) / 3_600_000;
    expect(hours).toBe(24);
    expect(await db.preparerAssignment.count()).toBe(0);
    expect(await db.notification.count({ where: { userId: admin.userId, type: "ADMIN_ASSIGNMENT_REQUEST" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: customer.userId, type: "ASSIGNMENT_PENDING" } })).toBe(1);
    expect((await db.creditWallet.findUniqueOrThrow({ where: { customerId } })).monthlyBalance).toBe(20);
  });

  it("alerte immédiatement l'admin si aucun préparateur n'est disponible", async () => {
    const admin = await createAdmin();
    await createCustomer();
    expect(await db.notification.count({ where: { userId: admin.userId, type: "ADMIN_NO_PREPARER" } })).toBe(1);
  });

  it("attribution confirmée : base, notifications, conversation, historique", async () => {
    const admin = await createAdmin();
    const { preparer } = await createPreparerWithLocation(admin);
    const { customerId, user } = await createCustomer();
    const { conversationId } = await assignPreparer(admin, { customerId, preparerId: preparer.id, note: "Proche du client" });

    const customer = await db.customerProfile.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.assignmentState).toBe("ASSIGNED");
    expect(customer.currentPreparerId).toBe(preparer.id);
    const assignment = await db.preparerAssignment.findFirstOrThrow({ where: { customerId } });
    expect(assignment.assignedById).toBe(admin.userId);
    expect(assignment.waitMinutes).not.toBeNull();
    const participants = await db.conversationParticipant.findMany({ where: { conversationId } });
    expect(participants.map((p) => p.userId).sort()).toEqual([user.id, preparer.userId].sort());
    expect(await db.notification.count({ where: { userId: user.id, type: "PREPARER_ASSIGNED" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: preparer.userId, type: "CLIENT_ASSIGNED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "assignment.created", entityId: customerId } })).toBe(1);
  });

  it("réservée aux administrateurs disposant de la permission", async () => {
    const admin = await createAdmin();
    const { preparer, actor: preparerActor } = await createPreparerWithLocation(admin);
    const { customerId, actor: customerActor } = await createCustomer();
    const support = await createAdmin("support");
    await expect(assignPreparer(customerActor, { customerId, preparerId: preparer.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assignPreparer(preparerActor, { customerId, preparerId: preparer.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assignPreparer(support, { customerId, preparerId: preparer.id })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("respecte la capacité et exige un point de réception validé", async () => {
    const admin = await createAdmin();
    const { preparer } = await createPreparerWithLocation(admin, { maxClients: 1 });
    const { preparer: unvalidated } = await createPreparerWithLocation(admin, { validated: false });
    const a = await createCustomer();
    const b = await createCustomer();
    await assignPreparer(admin, { customerId: a.customerId, preparerId: preparer.id });
    await expect(assignPreparer(admin, { customerId: b.customerId, preparerId: preparer.id })).rejects.toThrow(/Capacité/);
    await expect(assignPreparer(admin, { customerId: b.customerId, preparerId: unvalidated.id })).rejects.toThrow(/point de réception/);
  });

  it("empêche deux affectations actives (service et contrainte SQL)", async () => {
    const admin = await createAdmin();
    const { preparer } = await createPreparerWithLocation(admin);
    const { preparer: other } = await createPreparerWithLocation(admin);
    const { customerId } = await createCustomer();
    await assignPreparer(admin, { customerId, preparerId: preparer.id });
    await expect(assignPreparer(admin, { customerId, preparerId: other.id })).rejects.toThrow(/réattribution/);
    await expect(
      db.preparerAssignment.create({ data: { customerId, preparerId: other.id, assignedById: admin.userId, status: "ACTIVE" } }),
    ).rejects.toThrow();
  });

  it("attributions simultanées : un seul succès", async () => {
    const admin = await createAdmin();
    const { preparer } = await createPreparerWithLocation(admin);
    const { preparer: other } = await createPreparerWithLocation(admin);
    const { customerId } = await createCustomer();
    const results = await Promise.allSettled([
      assignPreparer(admin, { customerId, preparerId: preparer.id }),
      assignPreparer(admin, { customerId, preparerId: other.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.preparerAssignment.count({ where: { customerId, status: "ACTIVE" } })).toBe(1);
  });

  it("réattribution : historique conservé, transfert de stock contrôlé, accès de l'ancien préparateur retiré", async () => {
    const admin = await createAdmin();
    const first = await createPreparerWithLocation(admin);
    const second = await createPreparerWithLocation(admin);
    const { customerId, actor: customerActor } = await createCustomer();
    const { conversationId } = await assignPreparer(admin, { customerId, preparerId: first.preparer.id });
    const item = await addItemManually(first.actor, { customerId, name: "Sneakers", quantity: 2 });

    const { transferredItems } = await reassignCustomer(admin, { customerId, preparerId: second.preparer.id, reason: "Déménagement du préparateur", transferStock: true });
    expect(transferredItems).toBe(1);
    expect((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).preparerId).toBe(second.preparer.id);
    const movements = await db.inventoryMovement.findMany({ where: { itemId: item.id }, orderBy: { createdAt: "asc" } });
    expect(movements.map((m) => m.type)).toEqual(["RECEIPT", "TRANSFER_OUT", "TRANSFER_IN"]);
    const history = await db.preparerAssignment.findMany({ where: { customerId }, orderBy: { assignedAt: "asc" } });
    expect(history.map((h) => h.status)).toEqual(["ENDED", "ACTIVE"]);

    await expect(getConversationAccess(first.actor, conversationId)).rejects.toBeInstanceOf(ForbiddenError);
    const clientAccess = await getConversationAccess(customerActor, conversationId);
    expect(clientAccess.canWrite).toBe(false);
  });

  it("suivi du délai : passage en retard, alerte unique et information du client", async () => {
    const admin = await createAdmin();
    const { customerId } = await createCustomer();
    await db.customerProfile.update({ where: { id: customerId }, data: { assignmentDueAt: new Date(Date.now() - 60_000) } });
    const c = await db.customerProfile.findUniqueOrThrow({ where: { id: customerId } });
    expect(computeSla(c).isLate).toBe(true);

    await runAssignmentSlaCheck();
    await runAssignmentSlaCheck();
    const after = await db.customerProfile.findUniqueOrThrow({ where: { id: customerId } });
    expect(after.assignmentState).toBe("LATE");
    expect(await db.notification.count({ where: { userId: admin.userId, type: "ADMIN_ASSIGNMENT_LATE" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: after.userId, type: "ASSIGNMENT_DELAYED" } })).toBe(1);

    await notifyCustomerOfDelay(admin, { customerId, message: "Votre préparateur sera attribué demain matin." });
    expect(await db.notification.count({ where: { userId: after.userId, type: "ASSIGNMENT_DELAYED" } })).toBe(2);
    const customerActor = await actorFor(after.userId);
    expect(customerActor.customerId).toBe(customerId);
  });
});

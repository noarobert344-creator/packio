import { beforeEach, describe, expect, it } from "vitest";
import { assignPreparer } from "@/server/services/assignments";
import { completeOnboarding, createPreparer, enableAdminPreparerProfile } from "@/server/services/preparers";
import { preparerDebitCredits } from "@/server/services/preparer-credits";
import { createSession, loadActorFromToken, setSessionSpace, toActor } from "@/server/auth/session-store";
import { actorFor, createAdmin, createCustomer, createPreparerWithLocation, db, resetDb, wallet } from "../helpers";

describe("Espace préparateur : fiche, crédits des clients, administrateur préparateur", () => {
  beforeEach(resetDb);

  it("questionnaire de bienvenue : téléphone, adresse et lockers facultatifs, à valider par Packio ; une seule fois", async () => {
    const admin = await createAdmin();
    const { preparer } = await createPreparer(admin, {
      firstName: "Inès",
      lastName: "Nouvelle",
      email: "ines.nouvelle@test.local",
      city: "Nantes",
      country: "FR",
      compatibleCarriers: [],
      storageCapacity: 100,
      maxClients: 10,
    });
    expect(preparer.onboardedAt).toBeNull();
    const actor = await actorFor(preparer.userId);
    const base = { phone: "06 12 34 56 78", addressLine1: "4 quai de la Fosse", postalCode: "44000", city: "Nantes" };

    await expect(completeOnboarding(actor, { ...base, phone: "12", lockers: [] })).rejects.toMatchObject({ code: "ONBOARDING" });
    const res = await completeOnboarding(actor, {
      ...base,
      lockers: [{ network: "MONDIAL_RELAY", relayName: "Locker Mondial Relay Commerce", addressLine1: "2 place du Commerce", postalCode: "44000", city: "Nantes" }],
    });
    expect(res.locations).toBe(2);
    const locations = await db.preparerLocation.findMany({ where: { preparerId: preparer.id }, orderBy: { createdAt: "asc" } });
    expect(locations.map((l) => [l.type, l.network, l.validatedAt, l.recipientPhone])).toEqual([
      ["BUSINESS_ADDRESS", null, null, "06 12 34 56 78"],
      ["LOCKER", "MONDIAL_RELAY", null, "06 12 34 56 78"],
    ]);
    expect((await db.user.findUniqueOrThrow({ where: { id: preparer.userId } })).phone).toBe("06 12 34 56 78");
    expect((await db.preparerProfile.findUniqueOrThrow({ where: { id: preparer.id } })).onboardedAt).not.toBeNull();
    expect(await db.notification.count({ where: { userId: admin.userId, type: "ADMIN_PREPARER_ONBOARDED" } })).toBe(1);
    await expect(completeOnboarding(actor, { ...base, lockers: [] })).rejects.toMatchObject({ code: "ALREADY_DONE" });
  });

  it("retrait de crédits par le préparateur : client attribué uniquement, motif envoyé dans la conversation, idempotent, plafonné", async () => {
    const admin = await createAdmin();
    const prep = await createPreparerWithLocation(admin);
    const client = await createCustomer({ plan: "PRO" });
    const other = await createCustomer({ plan: "STARTER" });
    await assignPreparer(admin, { customerId: client.customerId, preparerId: prep.preparer.id });
    const before = await wallet(client.customerId);
    const input = { customerId: client.customerId, amount: 2, reason: "Emballage renforcé pour la vaisselle fragile", requestId: "req-1" };

    await expect(preparerDebitCredits(prep.actor, { ...input, reason: "court" })).rejects.toMatchObject({ code: "REASON" });
    await expect(preparerDebitCredits(prep.actor, { ...input, amount: 21 })).rejects.toMatchObject({ code: "AMOUNT" });
    await expect(preparerDebitCredits(prep.actor, { ...input, customerId: other.customerId })).rejects.toThrow(/introuvable/);
    await expect(preparerDebitCredits(client.actor, input)).rejects.toThrow();

    expect(await preparerDebitCredits(prep.actor, input)).toEqual({ applied: true, debited: 2 });
    expect(await preparerDebitCredits(prep.actor, input)).toMatchObject({ applied: false });
    const after = await wallet(client.customerId);
    expect(after.monthlyBalance + after.purchasedBalance).toBe(before.monthlyBalance + before.purchasedBalance - 2);
    const tx = await db.creditTransaction.findFirstOrThrow({ where: { walletId: after.id, type: "PREPARER_DEBIT" } });
    expect(tx).toMatchObject({ amount: -2, reason: input.reason, actorId: prep.actor.userId });
    const message = await db.message.findFirstOrThrow({ where: { senderId: prep.actor.userId, conversation: { customerId: client.customerId } } });
    expect(message.body).toBe(`Retrait de 2 crédits de votre solde. Motif : ${input.reason}`);
    expect(await db.notification.count({ where: { userId: client.actor.userId, type: "CREDITS_REMOVED_BY_PREPARER" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "credits.preparer_debit", entityId: client.customerId } })).toBe(1);
  });

  it("administrateur préparateur : un compte, deux espaces ; aucune permission d'administration en mode préparateur", async () => {
    const admin = await createAdmin();
    const lone = await createAdmin();
    const profile = await enableAdminPreparerProfile(admin);
    expect(await enableAdminPreparerProfile(admin)).toEqual(profile);

    const user = await db.user.findUniqueOrThrow({ where: { id: admin.userId }, include: { staffRole: true, customerProfile: { select: { id: true } }, preparerProfile: { select: { id: true } } } });
    expect(toActor(user)).toMatchObject({ role: "ADMIN", preparerId: profile.id, otherSpaces: ["PREPARER"] });
    expect(toActor(user, "PREPARER")).toMatchObject({ role: "PREPARER", preparerId: profile.id, permissions: [], otherSpaces: ["ADMIN"] });

    const { token } = await createSession(admin.userId, {});
    const session = await loadActorFromToken(token);
    expect(session!.actor.role).toBe("ADMIN");
    expect(await setSessionSpace(session!.sessionId, admin.userId, "PREPARER")).toBe(true);
    expect((await loadActorFromToken(token))!.actor).toMatchObject({ role: "PREPARER", permissions: [] });
    expect(await setSessionSpace(session!.sessionId, admin.userId, "ADMIN")).toBe(true);
    expect((await loadActorFromToken(token))!.actor.role).toBe("ADMIN");

    // Sans profil préparateur, la bascule est refusée.
    const other = await createSession(lone.userId, {});
    const loneSession = await loadActorFromToken(other.token);
    expect(await setSessionSpace(loneSession!.sessionId, lone.userId, "PREPARER")).toBe(false);
    expect((await loadActorFromToken(other.token))!.actor).toMatchObject({ role: "ADMIN", otherSpaces: [] });
  });
});

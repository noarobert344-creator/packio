import { beforeEach, describe, expect, it } from "vitest";
import { assertCustomer } from "@/server/auth/actor";
import { createSession, loadActorFromToken, setSessionSpace, toActor } from "@/server/auth/session-store";
import { enableAdminCustomerProfile } from "@/server/services/auth";
import { enableAdminPreparerProfile, saveLocation } from "@/server/services/preparers";
import { assignPreparer } from "@/server/services/assignments";
import { devCompleteSubscription } from "@/server/billing";
import { createAdmin, db, resetDb } from "../helpers";

const loadUser = (id: string) =>
  db.user.findUniqueOrThrow({ where: { id }, include: { staffRole: true, customerProfile: { select: { id: true } }, preparerProfile: { select: { id: true } } } });

describe("Administrateur avec un espace client", () => {
  beforeEach(resetDb);

  it("un compte, trois espaces : administration, préparateur et client", async () => {
    const admin = await createAdmin();
    const prep = await enableAdminPreparerProfile(admin);
    const client = await enableAdminCustomerProfile(admin);
    expect(await enableAdminCustomerProfile(admin)).toEqual(client);
    const profile = await db.customerProfile.findUniqueOrThrow({ where: { id: client.id }, include: { wallet: true } });
    expect(profile).toMatchObject({ userId: admin.userId, status: "PENDING_PAYMENT" });
    expect(profile.referenceCode).toMatch(/^PK-/);
    expect(profile.wallet).not.toBeNull();

    const user = await loadUser(admin.userId);
    const asAdmin = toActor(user);
    expect(asAdmin).toMatchObject({ role: "ADMIN", customerId: null, otherSpaces: ["PREPARER", "CUSTOMER"] });
    expect(() => assertCustomer(asAdmin)).toThrow();
    const asClient = toActor(user, "CUSTOMER");
    expect(asClient).toMatchObject({ role: "CUSTOMER", customerId: client.id, permissions: [], otherSpaces: ["ADMIN", "PREPARER"] });

    // Bascule de session vers l'espace client, puis retour.
    const { token } = await createSession(admin.userId, {});
    const session = (await loadActorFromToken(token))!;
    expect(await setSessionSpace(session.sessionId, admin.userId, "CUSTOMER")).toBe(true);
    expect((await loadActorFromToken(token))!.actor).toMatchObject({ role: "CUSTOMER", customerId: client.id, permissions: [] });
    expect(await setSessionSpace(session.sessionId, admin.userId, "ADMIN")).toBe(true);
    expect((await loadActorFromToken(token))!.actor).toMatchObject({ role: "ADMIN", customerId: null });

    await saveLocation(asAdmin, {
      preparerId: prep.id,
      type: "BUSINESS_ADDRESS",
      label: "Mon adresse",
      network: null,
      relayName: null,
      addressLine1: "1 rue de Paris",
      postalCode: "75001",
      city: "Paris",
      country: "FR",
      recipientName: "Admin",
      isPrimary: true,
      validate: true,
    });

    // Abonnement comme un client, puis attribution à son propre espace préparateur.
    const plan = await db.plan.findUniqueOrThrow({ where: { code: "STARTER" } });
    await devCompleteSubscription(asClient, plan.id, "MONTHLY");
    expect(await db.customerProfile.findUniqueOrThrow({ where: { id: client.id } })).toMatchObject({ status: "ACTIVE" });
    await assignPreparer(asAdmin, { customerId: client.id, preparerId: prep.id });
    const conversation = await db.conversation.findFirstOrThrow({ where: { customerId: client.id, preparerId: prep.id }, include: { participants: true } });
    expect(conversation.participants.map((p) => p.userId)).toEqual([admin.userId]);
  });

  it("sans espace client, la bascule est refusée ; un client ou un préparateur ne peut pas en créer un", async () => {
    const admin = await createAdmin();
    const { token } = await createSession(admin.userId, {});
    const session = (await loadActorFromToken(token))!;
    expect(await setSessionSpace(session.sessionId, admin.userId, "CUSTOMER")).toBe(false);
    expect((await loadActorFromToken(token))!.actor).toMatchObject({ role: "ADMIN", otherSpaces: [] });
    await enableAdminPreparerProfile(admin);
    const asPreparer = toActor(await loadUser(admin.userId), "PREPARER");
    await expect(enableAdminCustomerProfile(asPreparer)).rejects.toThrow();
  });
});

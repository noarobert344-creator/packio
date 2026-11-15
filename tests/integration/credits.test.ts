import { beforeEach, describe, expect, it } from "vitest";
import { addDays } from "date-fns";
import { adminAdjustCredits, captureCredits, expireDueCredits, grantCredits, grantMonthlyCycle, releaseCredits, reserveCredits } from "@/server/services/credits";
import { saveSetting } from "@/server/services/settings";
import { DomainError } from "@/server/errors";
import { createAdmin, createCustomer, createPreparerWithLocation, db, ledgerInvariant, resetDb, wallet } from "../helpers";

/** Crée une expédition minimale (clé étrangère des réservations). */
async function bareShipment(customerId: string, preparerId: string) {
  return db.outboundShipment.create({
    data: {
      reference: `EXP-T${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
      customerId,
      preparerId,
      recipientName: "Test",
      addressLine1: "1 rue Test",
      postalCode: "75001",
      city: "Paris",
    },
  });
}

/** Les crédits mensuels sont rattachés à la souscription qui les verse. */
async function subscriptionRef(customerId: string) {
  return (await db.subscription.findFirstOrThrow({ where: { customerId } })).externalId;
}

describe("Registre de crédits", () => {
  let customerId: string;
  let preparerId: string;

  beforeEach(async () => {
    await resetDb();
    const admin = await createAdmin();
    ({ preparer: { id: preparerId } } = await createPreparerWithLocation(admin));
    ({ customerId } = await createCustomer({ plan: "STARTER" }));
  });

  it("initialise le portefeuille avec les crédits mensuels de l'offre", async () => {
    const w = await wallet(customerId);
    expect(w.monthlyBalance).toBe(20);
    expect(w.purchasedBalance).toBe(0);
    expect(w.reservedBalance).toBe(0);
    const inv = await ledgerInvariant(customerId);
    expect(inv.available).toBe(inv.ledgerAvailable);
  });

  it("réserve, débite définitivement et respecte les invariants du registre", async () => {
    const s = await bareShipment(customerId, preparerId);
    const res = await db.$transaction((tx) => reserveCredits(tx, { customerId, shipmentId: s.id, amount: 3, version: 1, description: "test" }));
    expect(res.ok).toBe(true);
    let w = await wallet(customerId);
    expect(w.monthlyBalance).toBe(17);
    expect(w.reservedBalance).toBe(3);

    const cap = await db.$transaction((tx) => captureCredits(tx, { customerId, shipmentId: s.id, description: "test" }));
    expect(cap).toEqual({ amount: 3, alreadyCaptured: false });
    w = await wallet(customerId);
    expect(w.reservedBalance).toBe(0);
    expect(w.consumedTotal).toBe(3);

    // Double débit impossible
    const again = await db.$transaction((tx) => captureCredits(tx, { customerId, shipmentId: s.id, description: "test" }));
    expect(again.alreadyCaptured).toBe(true);
    expect((await wallet(customerId)).consumedTotal).toBe(3);

    const inv = await ledgerInvariant(customerId);
    expect(inv.available).toBe(inv.ledgerAvailable);
    expect(inv.reserved).toBe(inv.ledgerReserved);
  });

  it("refuse une réservation au-delà du solde sans rien écrire", async () => {
    const s = await bareShipment(customerId, preparerId);
    const before = await db.creditTransaction.count();
    const res = await db.$transaction((tx) => reserveCredits(tx, { customerId, shipmentId: s.id, amount: 25, version: 1, description: "test" }));
    expect(res).toEqual({ ok: false, available: 20, required: 25 });
    expect(await db.creditTransaction.count()).toBe(before);
  });

  it("sérialise les réservations concurrentes (pas de solde négatif)", async () => {
    const shipments = await Promise.all(Array.from({ length: 8 }, () => bareShipment(customerId, preparerId)));
    const results = await Promise.all(
      shipments.map((s) => db.$transaction((tx) => reserveCredits(tx, { customerId, shipmentId: s.id, amount: 3, version: 1, description: "concurrent" }))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(6); // 6 × 3 = 18 ≤ 20
    const w = await wallet(customerId);
    expect(w.monthlyBalance).toBe(2);
    expect(w.reservedBalance).toBe(18);
  });

  it("libère une réservation et restitue les crédits", async () => {
    const s = await bareShipment(customerId, preparerId);
    await db.$transaction((tx) => reserveCredits(tx, { customerId, shipmentId: s.id, amount: 2, version: 1, description: "test" }));
    const { released } = await db.$transaction((tx) => releaseCredits(tx, { customerId, shipmentId: s.id, description: "annulation" }));
    expect(released).toBe(2);
    const w = await wallet(customerId);
    expect(w.monthlyBalance).toBe(20);
    expect(w.reservedBalance).toBe(0);
    // Libération idempotente
    const second = await db.$transaction((tx) => releaseCredits(tx, { customerId, shipmentId: s.id, description: "annulation" }));
    expect(second.released).toBe(0);
  });

  it("consomme les crédits mensuels avant les crédits achetés", async () => {
    await db.$transaction((tx) =>
      grantCredits(tx, { customerId, bucket: "PURCHASED", amount: 5, source: "PURCHASE", expiresAt: null, type: "PURCHASE", description: "achat", idempotencyKey: "p1" }),
    );
    const s = await bareShipment(customerId, preparerId);
    await db.$transaction((tx) => reserveCredits(tx, { customerId, shipmentId: s.id, amount: 22, version: 1, description: "test" }));
    const w = await wallet(customerId);
    expect(w.monthlyBalance).toBe(0);
    expect(w.purchasedBalance).toBe(3);
  });

  it("est idempotent sur la clé d'opération", async () => {
    const input = { customerId, bucket: "PURCHASED" as const, amount: 10, source: "PURCHASE" as const, expiresAt: null, type: "PURCHASE" as const, description: "achat", idempotencyKey: "purchase:cs_1" };
    const a = await db.$transaction((tx) => grantCredits(tx, input));
    const b = await db.$transaction((tx) => grantCredits(tx, input));
    expect(a.applied).toBe(true);
    expect(b.applied).toBe(false);
    expect((await wallet(customerId)).purchasedBalance).toBe(10);
  });

  it("politique EXPIRE : les crédits mensuels non utilisés expirent au renouvellement", async () => {
    const sourceRef = await subscriptionRef(customerId);
    await db.$transaction((tx) =>
      grantMonthlyCycle(tx, { customerId, amount: 20, periodEnd: addDays(new Date(), 60), sourceRef, idempotencyKey: "cycle:in_2", description: "cycle 2" }),
    );
    const w = await wallet(customerId);
    expect(w.monthlyBalance).toBe(20);
    expect(await db.creditTransaction.count({ where: { type: "EXPIRY" } })).toBe(1);
  });

  it("politique ROLLOVER : report plafonné", async () => {
    await saveSetting("credits", { monthly: { mode: "ROLLOVER", rolloverMonths: 1, rolloverCapPercent: 50 }, purchased: { mode: "NEVER", days: 365 } }, null);
    const sourceRef = await subscriptionRef(customerId);
    await db.$transaction((tx) =>
      grantMonthlyCycle(tx, { customerId, amount: 20, periodEnd: addDays(new Date(), 60), sourceRef, idempotencyKey: "cycle:in_2", description: "cycle 2" }),
    );
    // 20 restants, plafond de report = 50 % de 20 = 10 → 10 expirent, puis +20
    expect((await wallet(customerId)).monthlyBalance).toBe(30);
  });

  it("expire les crédits achetés selon leur politique dédiée", async () => {
    await db.$transaction((tx) =>
      grantCredits(tx, { customerId, bucket: "PURCHASED", amount: 7, source: "PURCHASE", expiresAt: addDays(new Date(), -1), type: "PURCHASE", description: "achat", idempotencyKey: "p-exp" }),
    );
    await expireDueCredits();
    expect((await wallet(customerId)).purchasedBalance).toBe(0);
  });

  it("ajustement administrateur : justification obligatoire et journal d'audit", async () => {
    const admin = await createAdmin();
    await expect(
      adminAdjustCredits(admin, { customerId, direction: "CREDIT", amount: 5, bucket: "PURCHASED", reason: "", requestId: "r1" }),
    ).rejects.toBeInstanceOf(DomainError);
    await adminAdjustCredits(admin, { customerId, direction: "CREDIT", amount: 5, bucket: "PURCHASED", reason: "Geste commercial suite au retard", requestId: "r2" });
    await adminAdjustCredits(admin, { customerId, direction: "CREDIT", amount: 5, bucket: "PURCHASED", reason: "Geste commercial suite au retard", requestId: "r2" });
    expect((await wallet(customerId)).purchasedBalance).toBe(5);
    expect(await db.auditLog.count({ where: { action: "credits.admin_credit", entityId: customerId } })).toBe(1);
    await expect(
      adminAdjustCredits(admin, { customerId, direction: "DEBIT", amount: 99, bucket: "PURCHASED", reason: "Correction d'erreur", requestId: "r3" }),
    ).rejects.toThrow(/Solde insuffisant/);
  });

  it("refuse l'ajustement à un administrateur sans la permission", async () => {
    const support = await createAdmin("support");
    await expect(
      adminAdjustCredits(support, { customerId, direction: "CREDIT", amount: 5, bucket: "PURCHASED", reason: "Tentative non autorisée", requestId: "r4" }),
    ).rejects.toThrow(/rôle/);
  });

  it("le registre est en ajout seul (UPDATE/DELETE interdits en base)", async () => {
    const tx = await db.creditTransaction.findFirstOrThrow();
    await expect(db.creditTransaction.update({ where: { id: tx.id }, data: { amount: 999 } })).rejects.toThrow();
    await expect(db.creditTransaction.delete({ where: { id: tx.id } })).rejects.toThrow();
  });
});

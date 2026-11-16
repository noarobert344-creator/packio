import { randomUUID } from "node:crypto";
import { addDays, addMonths } from "date-fns";
import type { CreditBucket, CreditLotSource, CreditTransactionType } from "@/generated/prisma/enums";
import type { CreditLot, CreditReservation } from "@/generated/prisma/client";
import { db, type Tx } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";
import { assertAdmin, type Actor } from "@/server/auth/actor";
import { audit } from "./audit";
import { getSetting } from "./settings";
import { withEffects } from "./notifications";

/**
 * REGISTRE DE CRÉDITS
 * -------------------
 * - Chaque crédit appartient à un lot (crédits mensuels, achetés, manuels...)
 *   doté de sa propre date d'expiration : les politiques d'expiration / de
 *   report sont donc distinctes selon l'origine.
 * - Toute variation est inscrite dans credit_transactions (ajout seul) avec une
 *   clé d'idempotence unique : rejouer une opération (double clic, webhook
 *   renvoyé, requête réessayée) est sans effet.
 * - Le portefeuille est verrouillé (SELECT ... FOR UPDATE) pendant chaque
 *   opération : les écritures concurrentes sont sérialisées.
 * - Invariants : solde disponible = Σ amount ; solde réservé = Σ reservedDelta.
 */

type Allocation = { lotId: string; bucket: CreditBucket; amount: number };

const RELEASE_GRACE_DAYS = 7;
const MONTHLY_GRACE_DAYS = 3;

export type Balances = { monthly: number; purchased: number; reserved: number };

async function ensureWallet(tx: Tx, customerId: string) {
  await tx.$executeRaw`
    INSERT INTO "credit_wallets" ("id", "customerId", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${customerId}, now(), now())
    ON CONFLICT ("customerId") DO NOTHING`;
}

/** Verrouille le portefeuille du client pour la durée de la transaction. */
export async function lockWallet(tx: Tx, customerId: string): Promise<string> {
  await ensureWallet(tx, customerId);
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "credit_wallets" WHERE "customerId" = ${customerId} FOR UPDATE`;
  if (!rows[0]) throw new NotFoundError("Portefeuille introuvable.");
  return rows[0].id;
}

async function recompute(tx: Tx, walletId: string, consumedIncrement = 0): Promise<Balances> {
  const sums = await tx.creditLot.groupBy({
    by: ["bucket"],
    where: { walletId, expiredAt: null, remaining: { gt: 0 } },
    _sum: { remaining: true },
  });
  const held = await tx.creditReservation.aggregate({ where: { walletId, status: "HELD" }, _sum: { amount: true } });
  const balances: Balances = {
    monthly: sums.find((s) => s.bucket === "MONTHLY")?._sum.remaining ?? 0,
    purchased: sums.find((s) => s.bucket === "PURCHASED")?._sum.remaining ?? 0,
    reserved: held._sum.amount ?? 0,
  };
  await tx.creditWallet.update({
    where: { id: walletId },
    data: {
      monthlyBalance: balances.monthly,
      purchasedBalance: balances.purchased,
      reservedBalance: balances.reserved,
      ...(consumedIncrement ? { consumedTotal: { increment: consumedIncrement } } : {}),
    },
  });
  return balances;
}

async function writeTx(
  tx: Tx,
  walletId: string,
  balances: Balances,
  data: {
    type: CreditTransactionType;
    amount: number;
    reservedDelta?: number;
    bucket?: CreditBucket | null;
    description: string;
    reason?: string | null;
    actorId?: string | null;
    shipmentId?: string | null;
    reservationId?: string | null;
    paymentId?: string | null;
    idempotencyKey: string;
  },
) {
  return tx.creditTransaction.create({
    data: {
      walletId,
      type: data.type,
      amount: data.amount,
      reservedDelta: data.reservedDelta ?? 0,
      bucket: data.bucket ?? null,
      monthlyAfter: balances.monthly,
      purchasedAfter: balances.purchased,
      reservedAfter: balances.reserved,
      description: data.description,
      reason: data.reason ?? null,
      actorId: data.actorId ?? null,
      shipmentId: data.shipmentId ?? null,
      reservationId: data.reservationId ?? null,
      paymentId: data.paymentId ?? null,
      idempotencyKey: data.idempotencyKey,
    },
  });
}

async function alreadyApplied(tx: Tx, idempotencyKey: string) {
  return tx.creditTransaction.findUnique({ where: { idempotencyKey } });
}

/** Expire (totalement ou partiellement) un lot et inscrit l'opération. */
async function expireFromLot(tx: Tx, walletId: string, lot: CreditLot, amount: number, description: string, full: boolean) {
  if (amount <= 0) return;
  await tx.creditLot.update({
    where: { id: lot.id },
    data: { remaining: { decrement: amount }, ...(full ? { expiredAt: new Date() } : {}) },
  });
  const balances = await recompute(tx, walletId);
  await writeTx(tx, walletId, balances, {
    type: "EXPIRY",
    amount: -amount,
    bucket: lot.bucket,
    description,
    idempotencyKey: `expiry:${lot.id}:${randomUUID()}`,
  });
}

/** Expire les lots arrivés à échéance (appelé avant chaque opération). */
async function sweepExpired(tx: Tx, walletId: string, now = new Date()) {
  const due = await tx.creditLot.findMany({
    where: { walletId, expiredAt: null, remaining: { gt: 0 }, expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" },
  });
  for (const lot of due) {
    await expireFromLot(
      tx,
      walletId,
      lot,
      lot.remaining,
      lot.bucket === "MONTHLY" ? "Expiration de crédits mensuels" : "Expiration de crédits achetés",
      true,
    );
  }
}

/** Lots utilisables, dans l'ordre de consommation : mensuels d'abord, puis par échéance. */
async function usableLots(tx: Tx, walletId: string, bucket?: CreditBucket) {
  const lots = await tx.creditLot.findMany({
    where: { walletId, expiredAt: null, remaining: { gt: 0 }, ...(bucket ? { bucket } : {}) },
  });
  const far = Number.MAX_SAFE_INTEGER;
  return lots.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket === "MONTHLY" ? -1 : 1;
    const ea = a.expiresAt?.getTime() ?? far;
    const eb = b.expiresAt?.getTime() ?? far;
    if (ea !== eb) return ea - eb;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

function allocate(lots: CreditLot[], amount: number): Allocation[] | null {
  const out: Allocation[] = [];
  let left = amount;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(lot.remaining, left);
    out.push({ lotId: lot.id, bucket: lot.bucket, amount: take });
    left -= take;
  }
  return left > 0 ? null : out;
}

async function applyAllocations(tx: Tx, allocations: Allocation[]) {
  for (const a of allocations) {
    await tx.creditLot.update({ where: { id: a.lotId }, data: { remaining: { decrement: a.amount } } });
  }
}

function mainBucket(allocations: Allocation[]): CreditBucket | null {
  const buckets = new Set(allocations.map((a) => a.bucket));
  return buckets.size === 1 ? [...buckets][0] : null;
}

export async function purchasedCreditsExpiry(tx: Tx, from = new Date()): Promise<Date | null> {
  const policy = (await getSetting("credits", tx)).purchased;
  return policy.mode === "EXPIRE_AFTER_DAYS" ? addDays(from, policy.days) : null;
}

// -----------------------------------------------------------------------------
// Crédits entrants
// -----------------------------------------------------------------------------

export type GrantInput = {
  customerId: string;
  bucket: CreditBucket;
  amount: number;
  source: CreditLotSource;
  sourceRef?: string;
  expiresAt: Date | null;
  type: Extract<CreditTransactionType, "MONTHLY_GRANT" | "PLAN_CHANGE_GRANT" | "PURCHASE" | "ADMIN_CREDIT">;
  description: string;
  idempotencyKey: string;
  actorId?: string | null;
  reason?: string | null;
  paymentId?: string | null;
};

export async function grantCredits(tx: Tx, input: GrantInput): Promise<{ applied: boolean }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new DomainError("INVALID_AMOUNT", "Montant de crédits invalide.");
  const walletId = await lockWallet(tx, input.customerId);
  if (await alreadyApplied(tx, input.idempotencyKey)) return { applied: false };
  await sweepExpired(tx, walletId);
  await tx.creditLot.create({
    data: {
      walletId,
      bucket: input.bucket,
      source: input.source,
      sourceRef: input.sourceRef,
      initialAmount: input.amount,
      remaining: input.amount,
      expiresAt: input.expiresAt,
    },
  });
  const balances = await recompute(tx, walletId);
  await writeTx(tx, walletId, balances, {
    type: input.type,
    amount: input.amount,
    bucket: input.bucket,
    description: input.description,
    reason: input.reason,
    actorId: input.actorId,
    paymentId: input.paymentId,
    idempotencyKey: input.idempotencyKey,
  });
  return { applied: true };
}

/**
 * Allocation mensuelle d'un cycle de facturation, avec application de la
 * politique des crédits mensuels non utilisés (expiration ou report plafonné).
 */
export async function grantMonthlyCycle(
  tx: Tx,
  /** sourceRef : identifiant de la souscription (adhésion Whop) qui verse les crédits. */
  input: { customerId: string; amount: number; periodEnd: Date; sourceRef: string; idempotencyKey: string; description: string },
): Promise<{ applied: boolean }> {
  const walletId = await lockWallet(tx, input.customerId);
  if (await alreadyApplied(tx, input.idempotencyKey)) return { applied: false };
  await sweepExpired(tx, walletId);
  const policy = (await getSetting("credits", tx)).monthly;
  // Seuls les crédits mensuels de la même souscription sont concernés : lors d'un
  // changement d'offre immédiat, ceux de l'offre remplacée restent utilisables
  // jusqu'à leur propre échéance.
  const previous = (await usableLots(tx, walletId, "MONTHLY")).filter(
    (l) => l.source !== "RELEASE" && (l.source !== "SUBSCRIPTION_CYCLE" || l.sourceRef === input.sourceRef),
  );

  let expiresAt: Date;
  if (policy.mode === "EXPIRE") {
    for (const lot of previous) {
      await expireFromLot(tx, walletId, lot, lot.remaining, "Expiration des crédits mensuels non utilisés (renouvellement)", true);
    }
    expiresAt = addDays(input.periodEnd, MONTHLY_GRACE_DAYS);
  } else {
    const cap = Math.floor((input.amount * policy.rolloverCapPercent) / 100);
    let excess = previous.reduce((s, l) => s + l.remaining, 0) - cap;
    for (const lot of previous) {
      if (excess <= 0) break;
      const part = Math.min(lot.remaining, excess);
      await expireFromLot(tx, walletId, lot, part, "Crédits mensuels au-delà du plafond de report", part === lot.remaining);
      excess -= part;
    }
    expiresAt = addDays(addMonths(input.periodEnd, policy.rolloverMonths), MONTHLY_GRACE_DAYS);
  }

  if (input.amount > 0) {
    await tx.creditLot.create({
      data: {
        walletId,
        bucket: "MONTHLY",
        source: "SUBSCRIPTION_CYCLE",
        sourceRef: input.sourceRef,
        initialAmount: input.amount,
        remaining: input.amount,
        expiresAt,
      },
    });
  }
  const balances = await recompute(tx, walletId);
  await writeTx(tx, walletId, balances, {
    type: "MONTHLY_GRANT",
    amount: input.amount,
    bucket: "MONTHLY",
    description: input.description,
    idempotencyKey: input.idempotencyKey,
  });
  return { applied: true };
}

// -----------------------------------------------------------------------------
// Réservation / débit / libération (expéditions)
// -----------------------------------------------------------------------------

export type ReserveResult = { ok: true; reservationId: string; amount: number } | { ok: false; available: number; required: number };

export async function reserveCredits(
  tx: Tx,
  input: { customerId: string; shipmentId: string; amount: number; version: number; description: string },
): Promise<ReserveResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new DomainError("INVALID_AMOUNT", "Coût en crédits invalide.");
  const walletId = await lockWallet(tx, input.customerId);
  await sweepExpired(tx, walletId);

  const held = await tx.creditReservation.findFirst({ where: { shipmentId: input.shipmentId, status: "HELD" } });
  if (held) {
    if (held.amount === input.amount) return { ok: true, reservationId: held.id, amount: held.amount };
    await releaseHeld(tx, walletId, held, "Reclassification du colis : libération de l'ancienne réservation");
  }
  const captured = await tx.creditReservation.findFirst({ where: { shipmentId: input.shipmentId, status: "CAPTURED" } });
  if (captured) throw new DomainError("ALREADY_CAPTURED", "Les crédits de cette expédition ont déjà été débités.");

  const key = `reserve:${input.shipmentId}:v${input.version}`;
  const prior = await alreadyApplied(tx, key);
  if (prior) throw new DomainError("STALE_RESERVATION", "Cette réservation a déjà été traitée. Actualisez la page.");

  const lots = await usableLots(tx, walletId);
  const allocations = allocate(lots, input.amount);
  if (!allocations) {
    return { ok: false, available: lots.reduce((s, l) => s + l.remaining, 0), required: input.amount };
  }
  await applyAllocations(tx, allocations);
  const reservation = await tx.creditReservation.create({
    data: { walletId, shipmentId: input.shipmentId, amount: input.amount, allocations, status: "HELD" },
  });
  const balances = await recompute(tx, walletId);
  await writeTx(tx, walletId, balances, {
    type: "RESERVATION",
    amount: -input.amount,
    reservedDelta: input.amount,
    bucket: mainBucket(allocations),
    description: input.description,
    shipmentId: input.shipmentId,
    reservationId: reservation.id,
    idempotencyKey: key,
  });
  return { ok: true, reservationId: reservation.id, amount: input.amount };
}

async function releaseHeld(tx: Tx, walletId: string, reservation: CreditReservation, description: string) {
  const now = new Date();
  const allocations = reservation.allocations as Allocation[];
  for (const a of allocations) {
    const lot = await tx.creditLot.findUnique({ where: { id: a.lotId } });
    const stillValid = lot && !lot.expiredAt && (!lot.expiresAt || lot.expiresAt > now);
    if (stillValid) {
      await tx.creditLot.update({ where: { id: a.lotId }, data: { remaining: { increment: a.amount } } });
    } else {
      // Le lot d'origine a expiré pendant la réservation : les crédits sont
      // restitués dans un lot de courte durée plutôt que perdus.
      await tx.creditLot.create({
        data: {
          walletId,
          bucket: a.bucket,
          source: "RELEASE",
          sourceRef: reservation.id,
          initialAmount: a.amount,
          remaining: a.amount,
          expiresAt: addDays(now, RELEASE_GRACE_DAYS),
        },
      });
    }
  }
  await tx.creditReservation.update({ where: { id: reservation.id }, data: { status: "RELEASED", releasedAt: now } });
  const balances = await recompute(tx, walletId);
  await writeTx(tx, walletId, balances, {
    type: "RESERVATION_RELEASE",
    amount: reservation.amount,
    reservedDelta: -reservation.amount,
    bucket: mainBucket(allocations),
    description,
    shipmentId: reservation.shipmentId,
    reservationId: reservation.id,
    idempotencyKey: `release:${reservation.id}`,
  });
}

export async function releaseCredits(tx: Tx, input: { customerId: string; shipmentId: string; description: string }) {
  const walletId = await lockWallet(tx, input.customerId);
  const held = await tx.creditReservation.findFirst({ where: { shipmentId: input.shipmentId, status: "HELD" } });
  if (!held) return { released: 0 };
  await releaseHeld(tx, walletId, held, input.description);
  return { released: held.amount };
}

/** Débit définitif à la validation de l'expédition. Idempotent. */
export async function captureCredits(
  tx: Tx,
  input: { customerId: string; shipmentId: string; description: string },
): Promise<{ amount: number; alreadyCaptured: boolean }> {
  const walletId = await lockWallet(tx, input.customerId);
  const captured = await tx.creditReservation.findFirst({ where: { shipmentId: input.shipmentId, status: "CAPTURED" } });
  if (captured) return { amount: captured.amount, alreadyCaptured: true };
  const held = await tx.creditReservation.findFirst({ where: { shipmentId: input.shipmentId, status: "HELD" } });
  if (!held) throw new DomainError("NO_RESERVATION", "Aucun crédit n'est réservé pour cette expédition.");
  await tx.creditReservation.update({ where: { id: held.id }, data: { status: "CAPTURED", capturedAt: new Date() } });
  const balances = await recompute(tx, walletId, held.amount);
  await writeTx(tx, walletId, balances, {
    type: "CAPTURE",
    amount: 0,
    reservedDelta: -held.amount,
    bucket: mainBucket(held.allocations as Allocation[]),
    description: input.description,
    shipmentId: input.shipmentId,
    reservationId: held.id,
    idempotencyKey: `capture:${input.shipmentId}`,
  });
  return { amount: held.amount, alreadyCaptured: false };
}

/** Solde utilisable (mensuels + achetés, hors réservations), portefeuille verrouillé. */
export async function availableCredits(tx: Tx, customerId: string): Promise<number> {
  const walletId = await lockWallet(tx, customerId);
  await sweepExpired(tx, walletId);
  return (await usableLots(tx, walletId)).reduce((s, l) => s + l.remaining, 0);
}

/** Débit direct (opération manuelle, remboursement ou frais de stockage). */
export async function debitCredits(
  tx: Tx,
  input: {
    customerId: string;
    amount: number;
    bucket?: CreditBucket;
    type: Extract<CreditTransactionType, "ADMIN_DEBIT" | "REFUND_DEBIT" | "STORAGE_FEE" | "PREPARER_DEBIT">;
    description: string;
    reason?: string | null;
    actorId?: string | null;
    paymentId?: string | null;
    idempotencyKey: string;
    allowPartial?: boolean;
  },
): Promise<{ applied: boolean; debited: number }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new DomainError("INVALID_AMOUNT", "Montant de crédits invalide.");
  const walletId = await lockWallet(tx, input.customerId);
  const prior = await alreadyApplied(tx, input.idempotencyKey);
  if (prior) return { applied: false, debited: -prior.amount };
  await sweepExpired(tx, walletId);
  const lots = await usableLots(tx, walletId, input.bucket);
  const available = lots.reduce((s, l) => s + l.remaining, 0);
  const amount = input.allowPartial ? Math.min(available, input.amount) : input.amount;
  if (amount <= 0) return { applied: false, debited: 0 };
  const allocations = allocate(lots, amount);
  if (!allocations) {
    throw new DomainError("INSUFFICIENT_CREDITS", `Solde insuffisant : ${available} crédit(s) disponible(s) pour un débit de ${input.amount}.`);
  }
  await applyAllocations(tx, allocations);
  const balances = await recompute(tx, walletId);
  await writeTx(tx, walletId, balances, {
    type: input.type,
    amount: -amount,
    bucket: mainBucket(allocations),
    description: input.description,
    reason: input.reason,
    actorId: input.actorId,
    paymentId: input.paymentId,
    idempotencyKey: input.idempotencyKey,
  });
  return { applied: true, debited: amount };
}

/** Expiration planifiée de tous les lots échus (tâche cron). */
export async function expireDueCredits(now = new Date()) {
  const wallets = await db.creditLot.findMany({
    where: { expiredAt: null, remaining: { gt: 0 }, expiresAt: { lte: now } },
    select: { wallet: { select: { customerId: true } } },
    distinct: ["walletId"],
  });
  for (const w of wallets) {
    await db.$transaction(async (tx) => {
      const walletId = await lockWallet(tx, w.wallet.customerId);
      await sweepExpired(tx, walletId, now);
    });
  }
  return { wallets: wallets.length };
}

// -----------------------------------------------------------------------------
// Opérations administrateur
// -----------------------------------------------------------------------------

export async function adminAdjustCredits(
  actor: Actor,
  input: {
    customerId: string;
    direction: "CREDIT" | "DEBIT";
    amount: number;
    bucket: CreditBucket;
    reason: string;
    expiresAt?: Date | null;
    requestId: string;
  },
) {
  assertAdmin(actor, "credits.manage");
  if (input.reason.trim().length < 5) {
    throw new DomainError("REASON_REQUIRED", "Une justification d'au moins 5 caractères est obligatoire.", {
      fieldErrors: { reason: "Justification obligatoire" },
    });
  }
  const customer = await db.customerProfile.findUnique({ where: { id: input.customerId }, select: { id: true, userId: true } });
  if (!customer) throw new NotFoundError("Client introuvable.");
  const key = `admin:${input.requestId}`;

  const result = await withEffects(async (tx, fx) => {
    let applied: boolean;
    if (input.direction === "CREDIT") {
      const expiresAt =
        input.expiresAt !== undefined ? input.expiresAt : input.bucket === "PURCHASED" ? await purchasedCreditsExpiry(tx) : null;
      ({ applied } = await grantCredits(tx, {
        customerId: input.customerId,
        bucket: input.bucket,
        amount: input.amount,
        source: "ADMIN",
        expiresAt,
        type: "ADMIN_CREDIT",
        description: `Crédit manuel par l'administration (${input.amount})`,
        reason: input.reason.trim(),
        actorId: actor.userId,
        idempotencyKey: key,
      }));
    } else {
      ({ applied } = await debitCredits(tx, {
        customerId: input.customerId,
        amount: input.amount,
        bucket: input.bucket,
        type: "ADMIN_DEBIT",
        description: `Débit manuel par l'administration (${input.amount})`,
        reason: input.reason.trim(),
        actorId: actor.userId,
        idempotencyKey: key,
      }));
    }
    if (applied) {
      await audit(
        {
          actor,
          action: input.direction === "CREDIT" ? "credits.admin_credit" : "credits.admin_debit",
          entityType: "customer",
          entityId: input.customerId,
          summary: `${input.direction === "CREDIT" ? "+" : "-"}${input.amount} crédit(s) — ${input.reason.trim()}`,
          metadata: { amount: input.amount, bucket: input.bucket },
        },
        tx,
      );
      if (input.direction === "CREDIT") {
        fx.notify(customer.userId, {
          type: "CREDITS_ADDED",
          title: "Crédits ajoutés",
          body: `${input.amount} crédit(s) ont été ajoutés à votre portefeuille par l'équipe Packio.`,
          link: "/client/credits",
        });
        fx.after(async () => {
          const { retryAwaitingCredits } = await import("./shipments");
          await retryAwaitingCredits(input.customerId);
        });
      }
    }
    return { applied };
  });
  return result;
}

// -----------------------------------------------------------------------------
// Lecture
// -----------------------------------------------------------------------------

export async function getWalletOverview(customerId: string) {
  const wallet = await db.creditWallet.findUnique({ where: { customerId } });
  if (!wallet) {
    return {
      wallet: { monthlyBalance: 0, purchasedBalance: 0, reservedBalance: 0, consumedTotal: 0 },
      available: 0,
      upcomingExpirations: [] as { amount: number; expiresAt: Date; bucket: CreditBucket }[],
    };
  }
  const lots = await db.creditLot.findMany({
    where: { walletId: wallet.id, expiredAt: null, remaining: { gt: 0 }, expiresAt: { not: null } },
    orderBy: { expiresAt: "asc" },
    take: 5,
  });
  return {
    wallet,
    available: wallet.monthlyBalance + wallet.purchasedBalance,
    upcomingExpirations: lots.map((l) => ({ amount: l.remaining, expiresAt: l.expiresAt!, bucket: l.bucket })),
  };
}

export async function listCreditTransactions(customerId: string, opts?: { take?: number; skip?: number }) {
  const wallet = await db.creditWallet.findUnique({ where: { customerId }, select: { id: true } });
  if (!wallet) return { items: [], total: 0 };
  const [items, total] = await Promise.all([
    db.creditTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      take: opts?.take ?? 50,
      skip: opts?.skip ?? 0,
      include: { actor: { select: { firstName: true, lastName: true, role: true } } },
    }),
    db.creditTransaction.count({ where: { walletId: wallet.id } }),
  ]);
  return { items, total };
}

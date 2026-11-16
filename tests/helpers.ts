import { db } from "@/server/db";
import type { Actor } from "@/server/auth/actor";
import { toActor } from "@/server/auth/session-store";
import { seedReferenceData } from "@/server/seed/reference";
import { registerCustomer } from "@/server/services/auth";
import { createPreparer, saveLocation } from "@/server/services/preparers";
import { devCompleteSubscription } from "@/server/billing";

export { db };

export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await seedReferenceData(db);
}

export async function actorFor(userId: string): Promise<Actor> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { staffRole: true, customerProfile: { select: { id: true } }, preparerProfile: { select: { id: true } } },
  });
  return toActor(user);
}

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function createAdmin(roleKey = "super_admin"): Promise<Actor> {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const user = await db.user.create({
    data: { email: `admin-${uid()}@test.local`, role: "ADMIN", firstName: "Ada", lastName: "Admin", staffRoleId: role.id },
  });
  return actorFor(user.id);
}

export async function createPreparerWithLocation(admin: Actor, opts?: { maxClients?: number; locationType?: "BUSINESS_ADDRESS" | "LOCKER"; validated?: boolean }) {
  const { preparer } = await createPreparer(admin, {
    firstName: "Paul",
    lastName: `Préparateur ${uid()}`,
    email: `prep-${uid()}@test.local`,
    city: "Lyon",
    country: "FR",
    compatibleCarriers: ["COLISSIMO", "MONDIAL_RELAY"],
    storageCapacity: 500,
    maxClients: opts?.maxClients ?? 10,
  });
  const type = opts?.locationType ?? "BUSINESS_ADDRESS";
  const location = await saveLocation(admin, {
    preparerId: preparer.id,
    type,
    label: type === "LOCKER" ? "Locker InPost Part-Dieu" : "Adresse professionnelle",
    network: type === "LOCKER" ? "INPOST" : null,
    relayName: type === "LOCKER" ? "InPost Lyon Part-Dieu 01" : null,
    addressLine1: "10 rue de la République",
    postalCode: "69002",
    city: "Lyon",
    country: "FR",
    recipientName: "Paul P.",
    isPrimary: true,
    validate: opts?.validated ?? true,
  });
  const actor = await actorFor(preparer.userId);
  return { preparer, location, actor };
}

export async function createCustomer(opts?: { plan?: "STARTER" | "PRO" | "BUSINESS"; subscribe?: boolean; interval?: "MONTHLY" | "YEARLY" }) {
  const user = await registerCustomer({
    firstName: "Chloé",
    lastName: `Client ${uid()}`,
    email: `client-${uid()}@test.local`,
    password: "MotDePasse2026",
  });
  let actor = await actorFor(user.id);
  if (opts?.subscribe !== false) {
    const plan = await db.plan.findUniqueOrThrow({ where: { code: opts?.plan ?? "STARTER" } });
    await devCompleteSubscription(actor, plan.id, opts?.interval ?? "MONTHLY");
    actor = await actorFor(user.id);
  }
  return { user, actor, customerId: actor.customerId! };
}

export async function wallet(customerId: string) {
  return db.creditWallet.findUniqueOrThrow({ where: { customerId } });
}

export async function ledgerInvariant(customerId: string) {
  const w = await wallet(customerId);
  const agg = await db.creditTransaction.aggregate({ where: { walletId: w.id }, _sum: { amount: true, reservedDelta: true } });
  return {
    available: w.monthlyBalance + w.purchasedBalance,
    ledgerAvailable: agg._sum.amount ?? 0,
    reserved: w.reservedBalance,
    ledgerReserved: agg._sum.reservedDelta ?? 0,
  };
}

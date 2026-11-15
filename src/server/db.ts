import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL n'est pas défini.");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : process.env.NODE_ENV === "test" ? [] : ["warn", "error"],
  });
}

const globalForPrisma = globalThis as unknown as { __packioPrisma?: ReturnType<typeof createClient> };

export const db = globalForPrisma.__packioPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__packioPrisma = db;
}

export type Tx = Prisma.TransactionClient;
export type DbClient = typeof db | Tx;

/**
 * Exécute une transaction interactive. Le niveau d'isolation par défaut
 * (READ COMMITTED) est complété par des verrous explicites (SELECT ... FOR UPDATE)
 * dans les services sensibles (crédits, stock, affectations).
 */
export function transaction<T>(fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
  return db.$transaction(fn, { timeout: opts?.timeout ?? 15_000, maxWait: 10_000 });
}

export { Prisma };

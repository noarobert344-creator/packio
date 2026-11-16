import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@/generated/prisma/client";

/**
 * Chiffrement de la connexion : DATABASE_SSL = "off", "require" (chiffrée) ou
 * "verify" (chiffrée, certificat vérifié). Par défaut "require" pour Supabase,
 * sinon "off". Un sslmode écrit dans DATABASE_URL reste prioritaire.
 */
function sslOptions(connectionString: string) {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return undefined;
  }
  if (url.searchParams.has("sslmode") || url.searchParams.has("ssl")) return undefined;
  const mode = process.env.DATABASE_SSL ?? (/\.supabase\.(com|co)$/.test(url.hostname) ? "require" : "off");
  if (mode === "verify") return { rejectUnauthorized: true };
  if (mode === "require") return { rejectUnauthorized: false };
  return undefined;
}

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL n'est pas défini.");
  }
  // DATABASE_POOL_MAX : connexions simultanées (bases gratuites : 5 suffisent).
  const adapter = new PrismaPg({ connectionString, ssl: sslOptions(connectionString), max: Number(process.env.DATABASE_POOL_MAX) || 10 });
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

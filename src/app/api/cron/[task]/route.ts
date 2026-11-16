import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { db } from "@/server/db";
import { runAssignmentSlaCheck } from "@/server/services/assignments";
import { expireDueCredits } from "@/server/services/credits";
import { runBillingSchedule } from "@/server/billing";
import { runShipmentSlaCheck } from "@/server/services/shipments";
import { runStorageBilling } from "@/server/services/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = env.cronSecret;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

// Délais : attribution sous 24 h, expédition sous 48 h.
async function attribution() {
  return { assignments: await runAssignmentSlaCheck(), shipments: await runShipmentSlaCheck() };
}

// Expiration, puis crédits mensuels de la formule annuelle et changements d'offre programmés.
async function credits() {
  const expired = await expireDueCredits();
  const billing = await runBillingSchedule();
  return { expired, billing, storage: await runStorageBilling() };
}

async function maintenance() {
  const now = new Date();
  const [sessions, attempts, tokens] = await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 86400000) } } }),
    db.authToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86400000) } } }),
  ]);
  return { sessions: sessions.count, loginAttempts: attempts.count, tokens: tokens.count };
}

/**
 * Tâches planifiées (Vercel Cron, cron-job.org ou tout ordonnanceur) protégées par CRON_SECRET.
 * « toutes » regroupe tout pour un ordonnanceur unique toutes les 10 à 15 minutes :
 * délais et crédits à chaque passage, ménage entre 3 h 30 et 3 h 45 UTC.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/cron/[task]">) {
  if (!authorized(request)) return Response.json({ error: "Non autorisé" }, { status: 401 });
  const { task } = await ctx.params;
  switch (task) {
    case "attribution":
      return Response.json(await attribution());
    case "credits":
      return Response.json(await credits());
    case "maintenance":
      return Response.json(await maintenance());
    case "toutes": {
      const now = new Date();
      const daily = now.getUTCHours() === 3 && now.getUTCMinutes() >= 30 && now.getUTCMinutes() < 45;
      return Response.json({ attribution: await attribution(), credits: await credits(), maintenance: daily ? await maintenance() : null });
    }
    default:
      return Response.json({ error: "Tâche inconnue" }, { status: 404 });
  }
}

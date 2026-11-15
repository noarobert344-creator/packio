import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { db } from "@/server/db";
import { runAssignmentSlaCheck } from "@/server/services/assignments";
import { expireDueCredits } from "@/server/services/credits";

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

/** Tâches planifiées (Vercel Cron ou tout ordonnanceur) protégées par CRON_SECRET. */
export async function GET(request: Request, ctx: RouteContext<"/api/cron/[task]">) {
  if (!authorized(request)) return Response.json({ error: "Non autorisé" }, { status: 401 });
  const { task } = await ctx.params;
  switch (task) {
    case "attribution":
      return Response.json(await runAssignmentSlaCheck());
    case "credits":
      return Response.json(await expireDueCredits());
    case "maintenance": {
      const now = new Date();
      const [sessions, attempts, tokens] = await Promise.all([
        db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
        db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 86400000) } } }),
        db.authToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86400000) } } }),
      ]);
      return Response.json({ sessions: sessions.count, loginAttempts: attempts.count, tokens: tokens.count });
    }
    default:
      return Response.json({ error: "Tâche inconnue" }, { status: 404 });
  }
}

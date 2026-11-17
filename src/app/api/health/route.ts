import { getDiscordStatus } from "@/server/discord/status";

export const dynamic = "force-dynamic";

/** État du site, version déployée et état du bot Discord (aucune donnée personnelle, pas de base de données). */
export function GET() {
  return Response.json({ ok: true, version: process.env.APP_VERSION ?? null, discord: getDiscordStatus() }, { headers: { "Cache-Control": "no-store" } });
}

export const dynamic = "force-dynamic";

/** État du site et version déployée (aucune donnée personnelle, pas de base de données). */
export function GET() {
  return Response.json({ ok: true, version: process.env.APP_VERSION ?? null }, { headers: { "Cache-Control": "no-store" } });
}

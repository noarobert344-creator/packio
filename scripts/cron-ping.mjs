/**
 * Tâches planifiées hors Vercel (ex. tâche « cron » Render toutes les 15 min) :
 * délais d'attribution et d'expédition à chaque passage, crédits et stockage
 * (prolongations, versements mensuels de l'annuel) à chaque passage, ménage
 * quotidien vers 3 h 30 UTC. Aucune dépendance : Node ≥ 20.
 *
 *   APP_URL=https://… CRON_SECRET=… node scripts/cron-ping.mjs
 */
const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
const secret = process.env.CRON_SECRET ?? "";
if (!base || !secret) {
  console.error("APP_URL et CRON_SECRET sont requis.");
  process.exit(1);
}
const now = new Date();
const tasks = ["attribution", "credits"];
if (now.getUTCHours() === 3 && now.getUTCMinutes() >= 30 && now.getUTCMinutes() < 45) tasks.push("maintenance");

let failed = false;
for (const task of tasks) {
  try {
    const res = await fetch(`${base}/api/cron/${task}`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(55_000) });
    const body = await res.text();
    console.log(`${task}: HTTP ${res.status} ${body.slice(0, 300)}`);
    if (!res.ok) failed = true;
  } catch (err) {
    failed = true;
    console.error(`${task}: ${err instanceof Error ? err.message : err}`);
  }
}
process.exit(failed ? 1 : 0);

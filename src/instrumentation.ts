/**
 * Démarrage du serveur : lance le bot Discord « Packio » si DISCORD_BOT_TOKEN
 * est renseigné. Il tourne en arrière-plan : le site ne l'attend pas et ne
 * dépend jamais de lui.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DISCORD_BOT_TOKEN) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startDiscordBot } = await import("./server/discord/bot");
  startDiscordBot().catch((err) => console.error("[discord] démarrage impossible", err));
}

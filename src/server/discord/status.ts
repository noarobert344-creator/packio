/**
 * État du bot Discord, partagé entre le démarrage (instrumentation) et
 * /api/health par globalThis (les deux ne partagent pas forcément le même
 * module une fois le site construit). Aucune donnée secrète.
 */
export type DiscordStatus = {
  state: "absent" | "connexion" | "connecté" | "erreur";
  detail?: string;
  at?: string;
};

const KEY = "__packioDiscordStatus";

export function setDiscordStatus(status: DiscordStatus) {
  (globalThis as Record<string, unknown>)[KEY] = {
    ...status,
    at: new Date().toISOString(),
  };
}

export function getDiscordStatus(): DiscordStatus {
  const s = (globalThis as Record<string, unknown>)[KEY] as
    | DiscordStatus
    | undefined;
  return s ?? { state: process.env.DISCORD_BOT_TOKEN ? "connexion" : "absent" };
}

/** Explication en clair des erreurs de connexion les plus courantes. */
export function explainDiscordError(message: string) {
  if (/disallowed intents/i.test(message))
    return "Activez « Server Members Intent » (portail développeur Discord → Bot).";
  if (/invalid token|TokenInvalid|401/i.test(message))
    return "Jeton invalide : refaites « Reset Token » et recollez-le dans Render (DISCORD_BOT_TOKEN).";
  return message.slice(0, 200);
}

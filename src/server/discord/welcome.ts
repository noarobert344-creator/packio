/**
 * Message de bienvenue du serveur Discord de Packio (sans dépendance à
 * discord.js, pour être testé simplement) : mention du nouveau membre, puis un
 * encadré aux couleurs de Packio avec les salons utiles.
 */

export const PACKIO_BLUE = 0x2f4dff;

export type WelcomeChannels = { start?: string | null; pricing?: string | null; help?: string | null };

export function buildWelcome(input: { memberId: string; channels: WelcomeChannels; contactId?: string | null }) {
  const lines = [
    "Ravi de t'accueillir parmi les vendeurs Packio 🎉",
    "",
    input.channels.start ? `🧭 **Pour démarrer** : <#${input.channels.start}>` : null,
    input.channels.pricing ? `💳 **Les offres** : <#${input.channels.pricing}>` : null,
    input.channels.help ? `🛟 **Une question** : <#${input.channels.help}>` : null,
    input.contactId ? `📞 **Un appel découverte** : envoie un MP à <@${input.contactId}>` : null,
  ].filter((l): l is string => l !== null);
  return {
    content: `👋 Bienvenue <@${input.memberId}> !`,
    embed: { color: PACKIO_BLUE, description: lines.join("\n") },
    // Seul le nouveau membre est notifié (pas la personne à contacter).
    allowedMentions: { users: [input.memberId] },
  };
}

/** Nom de salon ramené à des lettres simples : « 👋｜bienvenue » → « bienvenue », « centre-d’aide » → « centredaide ». */
export function normalizeChannelName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Salons reconnus par leur nom (aucun identifiant à configurer). */
export const CHANNEL_KEYWORDS = {
  welcome: ["bienvenue", "welcome"],
  start: ["commencerici", "commencer", "demarrer"],
  pricing: ["tarifs", "tarif", "offres", "prix"],
  help: ["centredaide", "aide", "support", "questions"],
} as const;

export function findChannelId(channels: { id: string; name: string }[], keywords: readonly string[]) {
  const named = channels.map((c) => ({ id: c.id, n: normalizeChannelName(c.name) }));
  for (const k of keywords) {
    const hit = named.find((c) => c.n.includes(k));
    if (hit) return hit.id;
  }
  return null;
}

import {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import { buildWelcome, CHANNEL_KEYWORDS, findChannelId } from "./welcome";
import { CLOSE_ID, OPEN_ID, closeTicket, installTickets, openTicket } from "./tickets";
import { explainDiscordError, setDiscordStatus } from "./status";

/**
 * BOT DISCORD « PACKIO »
 * Lancé avec le site (src/instrumentation.ts) quand DISCORD_BOT_TOKEN est
 * renseigné. Il souhaite la bienvenue à chaque nouveau membre dans le salon
 * « bienvenue », avec les salons « commencer-ici », « tarifs » et
 * « centre-d'aide », puis ajoute une réaction. /test-bienvenue (réservé aux
 * administrateurs du serveur) envoie le message pour soi-même. Tickets :
 * /installer-tickets (voir tickets.ts).
 *
 * Réglages facultatifs : DISCORD_CONTACT_USER_ID (personne à contacter pour
 * l'appel découverte, par défaut le propriétaire du serveur) et
 * DISCORD_WELCOME_EMOJI (réaction, par défaut un émoji du serveur nommé
 * « packio », sinon 📦).
 */

let started = false;

function textChannels(guild: Guild) {
  return guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).map((c) => ({ id: c.id, name: c.name }));
}

async function sendWelcome(member: GuildMember) {
  const guild = member.guild;
  const channels = textChannels(guild);
  const welcomeId = findChannelId(channels, CHANNEL_KEYWORDS.welcome);
  if (!welcomeId) {
    console.warn(`[discord] ${guild.name} : aucun salon « bienvenue » trouvé.`);
    return null;
  }
  const channel = guild.channels.cache.get(welcomeId) as TextChannel | undefined;
  if (!channel) return null;
  const message = buildWelcome({
    memberId: member.id,
    channels: {
      start: findChannelId(channels, CHANNEL_KEYWORDS.start),
      pricing: findChannelId(channels, CHANNEL_KEYWORDS.pricing),
      help: findChannelId(channels, CHANNEL_KEYWORDS.help),
    },
    contactId: process.env.DISCORD_CONTACT_USER_ID?.trim() || guild.ownerId,
  });
  const sent = await channel.send({
    content: message.content,
    embeds: [new EmbedBuilder().setColor(message.embed.color).setDescription(message.embed.description)],
    allowedMentions: message.allowedMentions,
  });
  const custom = guild.emojis.cache.find((e) => e.name?.toLowerCase().includes("packio"));
  await sent.react(process.env.DISCORD_WELCOME_EMOJI?.trim() || custom?.toString() || "📦").catch(() => undefined);
  return channel;
}

async function registerCommands(guild: Guild) {
  await guild.commands.set([
    {
      name: "test-bienvenue",
      description: "Envoie le message de bienvenue pour vous-même (test).",
      defaultMemberPermissions: PermissionFlagsBits.Administrator,
    },
    {
      name: "installer-tickets",
      description: "Publie dans ce salon le bouton « Ouvrir un ticket » (crée la catégorie et le rôle si besoin).",
      defaultMemberPermissions: PermissionFlagsBits.Administrator,
    },
  ]);
}

/** Nouvelle tentative de connexion après un refus (jeton changé…). */
const RETRY_MS = 2 * 60 * 1000;
/** Sans « Server Members Intent », le bot tourne quand même (tickets) et revérifie l'option régulièrement. */
const UPGRADE_MS = 5 * 60 * 1000;

let active: Client | null = null;

export async function startDiscordBot() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (started || !token) return;
  started = true;
  await connect(token, true);
}

/**
 * Connexion du bot. withMembers : avec l'option « Server Members Intent »
 * (nécessaire au message de bienvenue). Si Discord la refuse, le bot se
 * connecte sans (les tickets marchent) et réessaie avec toutes les 5 minutes.
 */
async function connect(token: string, withMembers: boolean): Promise<void> {
  if (!active) setDiscordStatus({ state: "connexion" });
  const client = new Client({ intents: withMembers ? [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] : [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (ready) => {
    // Une seule connexion active : l'ancienne (sans l'option) s'arrête.
    if (active && active !== client) active.destroy().catch(() => undefined);
    active = client;
    const servers = ready.guilds.cache.map((g) => g.name).join(", ") || "aucun (invitez le bot)";
    console.log(`[discord] connecté en tant que ${ready.user.tag} (${ready.guilds.cache.size} serveur(s))${withMembers ? "" : " sans message de bienvenue"}`);
    setDiscordStatus({
      state: "connecté",
      detail: withMembers
        ? `${ready.user.tag} · ${ready.guilds.cache.size} serveur(s) : ${servers}`
        : `${ready.user.tag} · ${servers} · tickets actifs ; message de bienvenue en attente : activez « Server Members Intent » (portail développeur Discord → Bot).`,
    });
    for (const guild of ready.guilds.cache.values()) registerCommands(guild).catch((err) => console.error("[discord] commandes", err));
    if (!withMembers) {
      setTimeout(() => {
        connect(token, true).catch((e) => console.error("[discord] reconnexion", e));
      }, UPGRADE_MS);
    }
  });
  client.on(Events.GuildCreate, (guild) => registerCommands(guild).catch((err) => console.error("[discord] commandes", err)));
  client.on(Events.GuildMemberAdd, (member) => {
    if (member.user.bot) return;
    sendWelcome(member).catch((err) => console.error("[discord] bienvenue", err));
  });
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.inCachedGuild()) return;
    // Tickets : bouton d'ouverture, bouton de fermeture, commande d'installation.
    if (interaction.isButton() && (interaction.customId === OPEN_ID || interaction.customId === CLOSE_ID)) {
      const run = interaction.customId === OPEN_ID ? openTicket : closeTicket;
      await run(interaction).catch(async (err) => {
        console.error("[discord] ticket", err);
        if (!interaction.replied) {
          await interaction
            .reply({ content: "Impossible pour le moment : vérifiez que le bot peut gérer les salons et les rôles.", flags: MessageFlags.Ephemeral })
            .catch(() => undefined);
        }
      });
      return;
    }
    if (interaction.isChatInputCommand() && interaction.commandName === "installer-tickets") {
      await installTickets(interaction).catch(async (err) => {
        console.error("[discord] installer-tickets", err);
        if (!interaction.replied) {
          await interaction
            .reply({ content: "Installation impossible : vérifiez que le bot peut gérer les salons et les rôles.", flags: MessageFlags.Ephemeral })
            .catch(() => undefined);
        }
      });
      return;
    }
    if (!interaction.isChatInputCommand() || interaction.commandName !== "test-bienvenue") return;
    try {
      const channel = await sendWelcome(interaction.member);
      await interaction.reply({
        content: channel ? `Message de bienvenue envoyé dans <#${channel.id}>.` : "Aucun salon « bienvenue » trouvé : créez-en un (son nom doit contenir « bienvenue »).",
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      console.error("[discord] test-bienvenue", err);
      if (!interaction.replied) await interaction.reply({ content: "Le message n'a pas pu être envoyé : vérifiez les permissions du bot dans ce salon.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
  });
  // Une erreur du bot n'arrête jamais le site.
  client.on(Events.Error, (err) => console.error("[discord]", err));
  client.on(Events.GuildCreate, (guild) => setDiscordStatus({ state: "connecté", detail: `${client.user?.tag} · ${client.guilds.cache.size} serveur(s), dernier ajouté : ${guild.name}` }));
  try {
    await client.login(token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await client.destroy().catch(() => undefined);
    if (withMembers && /disallowed intents/i.test(message)) {
      if (active) {
        // Déjà connecté sans l'option : nouvel essai plus tard.
        setTimeout(() => {
          connect(token, true).catch((e) => console.error("[discord] reconnexion", e));
        }, UPGRADE_MS);
        return;
      }
      console.warn("[discord] « Server Members Intent » refusé : connexion sans message de bienvenue.");
      return connect(token, false);
    }
    if (!active) setDiscordStatus({ state: "erreur", detail: `${explainDiscordError(message)} Nouvel essai automatique dans 2 minutes.` });
    console.error("[discord] connexion refusée :", message);
    setTimeout(() => {
      connect(token, withMembers).catch((e) => console.error("[discord] reconnexion", e));
    }, RETRY_MS);
  }
}

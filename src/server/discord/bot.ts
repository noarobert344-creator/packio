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

/**
 * BOT DISCORD « PACKIO »
 * Lancé avec le site (src/instrumentation.ts) quand DISCORD_BOT_TOKEN est
 * renseigné. Il souhaite la bienvenue à chaque nouveau membre dans le salon
 * « bienvenue », avec les salons « commencer-ici », « tarifs » et
 * « centre-d'aide », puis ajoute une réaction. /test-bienvenue (réservé aux
 * administrateurs du serveur) envoie le message pour soi-même.
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
  ]);
}

export async function startDiscordBot() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (started || !token) return;
  started = true;
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

  client.once(Events.ClientReady, (ready) => {
    console.log(`[discord] connecté en tant que ${ready.user.tag} (${ready.guilds.cache.size} serveur(s))`);
    for (const guild of ready.guilds.cache.values()) registerCommands(guild).catch((err) => console.error("[discord] commandes", err));
  });
  client.on(Events.GuildCreate, (guild) => registerCommands(guild).catch((err) => console.error("[discord] commandes", err)));
  client.on(Events.GuildMemberAdd, (member) => {
    if (member.user.bot) return;
    sendWelcome(member).catch((err) => console.error("[discord] bienvenue", err));
  });
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "test-bienvenue" || !interaction.inCachedGuild()) return;
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
  await client.login(token);
}

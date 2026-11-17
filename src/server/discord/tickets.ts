import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type CategoryChannel,
  type ChatInputCommandInteraction,
  type Guild,
  type Role,
} from "discord.js";
import { PACKIO_BLUE, normalizeChannelName } from "./welcome";

/**
 * TICKETS DU SERVEUR DISCORD, sans réglage :
 * /installer-tickets (administrateurs) crée la catégorie « Tickets » et le rôle
 * « Équipe Packio » s'ils n'existent pas, puis publie dans le salon courant un
 * message avec le bouton « Ouvrir un ticket ». Chaque ticket est un salon
 * privé : seuls le membre, l'équipe (rôle « Équipe Packio ») et les
 * administrateurs le voient. « Fermer le ticket » supprime le salon.
 */

export const TICKET_CATEGORY = "🎫 Tickets";
export const STAFF_ROLE = "Équipe Packio";
export const OPEN_ID = "packio:ticket:open";
export const CLOSE_ID = "packio:ticket:close";

/** Nom du salon d'un ticket : « ticket-pseudo » (lettres, chiffres et tirets). */
export function ticketChannelName(username: string) {
  const slug = normalizeChannelName(username).slice(0, 80) || "membre";
  return `ticket-${slug}`;
}

/** Le sujet du salon garde l'identifiant du membre, pour retrouver son ticket. */
export function ticketTopic(userId: string) {
  return `Ticket de <@${userId}> (membre ${userId})`;
}

export function ticketOwnerFromTopic(topic: string | null | undefined) {
  return topic?.match(/\(membre (\d+)\)/)?.[1] ?? null;
}

async function ensureStaffRole(guild: Guild): Promise<Role> {
  const existing = guild.roles.cache.find((r) => r.name.toLowerCase() === STAFF_ROLE.toLowerCase());
  if (existing) return existing;
  return guild.roles.create({ name: STAFF_ROLE, mentionable: false, reason: "Tickets Packio : équipe qui voit les tickets" });
}

async function ensureCategory(guild: Guild, staff: Role): Promise<CategoryChannel> {
  const existing = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && normalizeChannelName(c.name) === normalizeChannelName(TICKET_CATEGORY)) as
    | CategoryChannel
    | undefined;
  if (existing) return existing;
  const me = guild.members.me!;
  return guild.channels.create({
    name: TICKET_CATEGORY,
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: staff.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ],
    reason: "Tickets Packio",
  });
}

/** /installer-tickets : catégorie, rôle et message avec le bouton, dans le salon courant. */
export async function installTickets(interaction: ChatInputCommandInteraction<"cached">) {
  const guild = interaction.guild;
  const staff = await ensureStaffRole(guild);
  await ensureCategory(guild, staff);
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await interaction.reply({ content: "Lancez cette commande dans le salon où doit apparaître le bouton.", flags: MessageFlags.Ephemeral });
    return;
  }
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(PACKIO_BLUE)
        .setTitle("Besoin de nous parler ?")
        .setDescription("Clique sur le bouton pour ouvrir un ticket : un salon privé, visible seulement par toi et l'équipe Packio."),
    ],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(OPEN_ID).setLabel("Ouvrir un ticket").setEmoji("📩").setStyle(ButtonStyle.Primary))],
  });
  await interaction.reply({
    content: `C'est prêt ✅ Le bouton est publié ici. Donnez le rôle **${STAFF_ROLE}** aux personnes qui doivent voir les tickets (les administrateurs les voient déjà).`,
    flags: MessageFlags.Ephemeral,
  });
}

/** Bouton « Ouvrir un ticket » : un seul ticket ouvert par membre. */
export async function openTicket(interaction: ButtonInteraction<"cached">) {
  const guild = interaction.guild;
  const staff = await ensureStaffRole(guild);
  const category = await ensureCategory(guild, staff);
  const userId = interaction.user.id;
  const existing = guild.channels.cache.find((c) => c.parentId === category.id && c.type === ChannelType.GuildText && ticketOwnerFromTopic(c.topic) === userId);
  if (existing) {
    await interaction.reply({ content: `Tu as déjà un ticket ouvert : <#${existing.id}>`, flags: MessageFlags.Ephemeral });
    return;
  }
  const me = guild.members.me!;
  const channel = await guild.channels.create({
    name: ticketChannelName(interaction.user.username),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: ticketTopic(userId),
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: userId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
      },
      { id: staff.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ],
    reason: `Ticket de ${interaction.user.username}`,
  });
  await channel.send({
    content: `Bonjour <@${userId}> 👋 Explique ta demande ici, l'équipe Packio te répond au plus vite. <@&${staff.id}>`,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(CLOSE_ID).setLabel("Fermer le ticket").setEmoji("🔒").setStyle(ButtonStyle.Secondary))],
    allowedMentions: { users: [userId], roles: [staff.id] },
  });
  await interaction.reply({ content: `Ton ticket est ouvert : <#${channel.id}>`, flags: MessageFlags.Ephemeral });
}

/** Bouton « Fermer le ticket » : le membre, l'équipe ou un administrateur. */
export async function closeTicket(interaction: ButtonInteraction<"cached">) {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) return;
  const owner = ticketOwnerFromTopic(channel.topic);
  const member = interaction.member;
  const isStaff = member.permissions.has(PermissionFlagsBits.Administrator) || member.roles.cache.some((r) => r.name.toLowerCase() === STAFF_ROLE.toLowerCase());
  if (interaction.user.id !== owner && !isStaff) {
    await interaction.reply({ content: "Seuls le membre et l'équipe peuvent fermer ce ticket.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ content: "Ticket fermé 🔒 Ce salon sera supprimé dans 5 secondes." });
  setTimeout(() => {
    channel.delete("Ticket fermé").catch((err) => console.error("[discord] suppression du ticket", err));
  }, 5000);
}

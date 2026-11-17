import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  FileUploadBuilder,
  GatewayIntentBits,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type CategoryChannel,
  type ChannelPosition,
  type ChatInputCommandInteraction,
  type Guild,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import {
  REVIEW_SUBMIT_ID,
  SERVER_LAYOUT,
  botInviteUrl,
  helpMessage,
  missingBotPermissions,
  parseRating,
  reviewEmbed,
  reviewPromptMessage,
  serverMessages,
  type ChannelKey,
  type InfoEmbed,
  type InfoMessage,
  type Links,
  type PublicOffers,
} from "./content";
import { TICKET_CATEGORY, ensureTicketSetup } from "./tickets";
import { normalizeChannelName } from "./welcome";

/**
 * /installer-serveur : met tout le serveur en place en une commande, comme les
 * serveurs de référence (catégories Bienvenue / Communauté / Aide et avis) :
 *  - vérifie les droits du bot (sinon : lien pour les lui donner) ;
 *  - reprend et renomme les salons existants, crée ceux qui manquent, les range ;
 *  - publie ou met à jour les messages (prix lus sur le site, boutons) ;
 *  - salons d'information en lecture seule, salons de discussion ouverts ;
 *  - tickets (catégorie privée + rôle « Équipe Packio ») et avis clients.
 * Relancer la commande met simplement les messages à jour (aucun doublon).
 */

/** Problème de droits du bot sur ce serveur, en clair (null si tout va bien). */
export function permissionProblem(guild: Guild) {
  const p = guild.members.me?.permissions;
  const missing = missingBotPermissions({
    administrator: !!p?.has(PermissionFlagsBits.Administrator),
    manageChannels: !!p?.has(PermissionFlagsBits.ManageChannels),
    manageRoles: !!p?.has(PermissionFlagsBits.ManageRoles),
  });
  if (!missing.length) return null;
  return [
    `❌ Il manque au bot le droit : **${missing.join("** et **")}**.`,
    "",
    "👉 Clique sur ce lien, choisis ton serveur, puis **Autoriser** (ça met à jour ses droits, rien n'est effacé) :",
    botInviteUrl(guild.client.user.id),
    "",
    "Ensuite, relance la commande.",
  ].join("\n");
}

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

function toEmbed(e: InfoEmbed) {
  const b = new EmbedBuilder().setColor(e.color);
  if (e.title) b.setTitle(e.title);
  if (e.description) b.setDescription(e.description);
  if (e.image) b.setImage(e.image);
  if (e.thumbnail) b.setThumbnail(e.thumbnail);
  if (e.footer) b.setFooter({ text: e.footer });
  return b;
}

function toPayload(m: InfoMessage) {
  const buttons = m.buttons.map((b) =>
    b.kind === "link"
      ? new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setURL(b.url)
          .setLabel(b.label)
          .setEmoji(b.emoji)
      : new ButtonBuilder()
          .setCustomId(b.id)
          .setLabel(b.label)
          .setEmoji(b.emoji)
          .setStyle(
            b.style === "success" ? ButtonStyle.Success : ButtonStyle.Primary,
          ),
  );
  return {
    embeds: m.embeds.map(toEmbed),
    components: buttons.length
      ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)]
      : [],
  };
}

/** Message déjà publié par le bot dans ce salon, reconnu par le titre d'un de ses encadrés. */
async function findMine(channel: TextChannel, marker: string) {
  const key = marker.replace(/^\P{L}+/u, "");
  const recent = await channel.messages.fetch({ limit: 100 });
  return {
    recent,
    mine: recent.find(
      (m) =>
        m.author.id === channel.client.user.id &&
        m.embeds.some((e) => (e.title ?? "").includes(key)),
    ),
  };
}

async function upsert(channel: TextChannel, message: InfoMessage) {
  const { mine } = await findMine(channel, message.marker);
  if (mine) {
    await mine.edit(toPayload(message));
    return "mis à jour";
  }
  await channel.send(toPayload(message));
  return "publié";
}

/** Message avec bouton gardé tout en bas du salon (avis clients). */
async function keepAtBottom(channel: TextChannel, message: InfoMessage) {
  const { recent, mine } = await findMine(channel, message.marker);
  const last = recent.first();
  if (mine && last?.id === mine.id) {
    await mine.edit(toPayload(message));
    return;
  }
  if (mine) await mine.delete().catch(() => undefined);
  await channel.send(toPayload(message));
}

// -----------------------------------------------------------------------------
// Salons
// -----------------------------------------------------------------------------

const sameName = (current: string, wanted: string) =>
  [...current][0] === [...wanted][0] &&
  normalizeChannelName(current) === normalizeChannelName(wanted);

async function applyLayout(guild: Guild) {
  await guild.channels.fetch();
  const ticketCategory = guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildCategory &&
      normalizeChannelName(c.name) === normalizeChannelName(TICKET_CATEGORY),
  );
  const usedChannels = new Set<string>();
  const usedCategories = new Set<string>(
    ticketCategory ? [ticketCategory.id] : [],
  );
  const ids = {} as Record<ChannelKey, string>;
  const created: string[] = [];
  const positions: ChannelPosition[] = [];
  const me = guild.client.user.id;

  const candidates = () =>
    guild.channels.cache.filter(
      (c): c is TextChannel =>
        c.type === ChannelType.GuildText &&
        !usedChannels.has(c.id) &&
        c.parentId !== ticketCategory?.id &&
        !c.name.startsWith("ticket-"),
    );

  for (const [catIndex, cat] of SERVER_LAYOUT.entries()) {
    const categories = guild.channels.cache.filter(
      (c): c is CategoryChannel =>
        c.type === ChannelType.GuildCategory && !usedCategories.has(c.id),
    );
    let category =
      categories.find((c) => c.name === cat.name) ??
      categories.find((c) =>
        cat.match.some((k) => normalizeChannelName(c.name).includes(k)),
      ) ??
      null;
    if (!category)
      category = await guild.channels.create({
        name: cat.name,
        type: ChannelType.GuildCategory,
        reason: "Installation du serveur Packio",
      });
    else if (category.name !== cat.name) await category.setName(cat.name);
    usedCategories.add(category.id);
    positions.push({ channel: category.id, position: catIndex });

    for (const [index, spec] of cat.channels.entries()) {
      const pool = candidates();
      let channel =
        pool.find((c) => sameName(c.name, spec.name)) ??
        pool.find((c) =>
          spec.match.some((k) => normalizeChannelName(c.name).includes(k)),
        ) ??
        null;
      if (!channel) {
        channel = await guild.channels.create({
          name: spec.name,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: spec.topic,
          reason: "Installation du serveur Packio",
        });
        created.push(`<#${channel.id}>`);
      } else {
        if (!sameName(channel.name, spec.name))
          await channel.setName(spec.name);
        if (channel.topic !== spec.topic) await channel.setTopic(spec.topic);
      }
      usedChannels.add(channel.id);
      ids[spec.key] = channel.id;
      positions.push({
        channel: channel.id,
        parent: category.id,
        position: index,
      });
      // Information : lecture seule pour les membres ; discussion : ouvert.
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: spec.readOnly ? false : null,
        CreatePublicThreads: spec.readOnly ? false : null,
        CreatePrivateThreads: spec.readOnly ? false : null,
      });
      await channel.permissionOverwrites.edit(me, {
        ViewChannel: true,
        SendMessages: true,
        EmbedLinks: true,
        AttachFiles: true,
        ReadMessageHistory: true,
      });
    }
  }
  const tickets = await ensureTicketSetup(guild);
  positions.push({
    channel: tickets.category.id,
    position: SERVER_LAYOUT.length,
  });
  await guild.channels.setPositions(positions);
  return { ids, created };
}

async function publicOffers(appUrl: string): Promise<PublicOffers | null> {
  try {
    const res = await fetch(`${appUrl}/api/offres`, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicOffers;
  } catch {
    return null;
  }
}

function siteLinks(ids: Partial<Record<ChannelKey, string>>): Links {
  return {
    appUrl: (process.env.APP_URL ?? "https://packio.onrender.com").replace(
      /\/$/,
      "",
    ),
    extensionUrl: process.env.EXTENSION_STORE_URL?.startsWith("https://")
      ? process.env.EXTENSION_STORE_URL
      : null,
    ids,
  };
}

export async function installServer(
  interaction: ChatInputCommandInteraction<"cached">,
) {
  const guild = interaction.guild;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const problem = permissionProblem(guild);
  if (problem) {
    await interaction.editReply(problem);
    return;
  }
  await interaction.editReply(
    "⏳ Installation en cours : salons, messages, tickets et avis…",
  );
  const { ids, created } = await applyLayout(guild);
  const links = siteLinks(ids);
  const offers = await publicOffers(links.appUrl);
  const messages = serverMessages(links, offers);
  const done: string[] = [];
  for (const [key, list] of Object.entries(messages) as [
    ChannelKey,
    InfoMessage[],
  ][]) {
    const channel = guild.channels.cache.get(ids[key]) as TextChannel;
    for (const message of list) {
      if (key === "reviews") await keepAtBottom(channel, message);
      else await upsert(channel, message);
    }
    done.push(`<#${ids[key]}>`);
  }

  const welcome = interaction.client.options.intents.has(
    GatewayIntentBits.GuildMembers,
  )
    ? `👋 Message de bienvenue **actif** dans <#${ids.welcome}>.`
    : `👋 Message de bienvenue **en attente** : active « Server Members Intent » (portail développeur Discord → Bot → Save Changes).`;
  await interaction.editReply(
    [
      "✅ **Serveur Packio installé**",
      `• Salons rangés en 3 catégories : Bienvenue, Communauté, Aide et avis${created.length ? ` (créés : ${created.join(", ")})` : ""}.`,
      `• Messages publiés ou mis à jour : ${done.join(" ")}${offers ? " (prix du site)" : " (prix indisponibles : lien vers le site)"}.`,
      "• Salons d'information en lecture seule ; Général, Vos résultats et Idées ouverts à tous.",
      "• Tickets : bouton dans le centre d'aide ; donne le rôle **Équipe Packio** à ceux qui doivent les voir.",
      `• Avis : bouton « Laisser un avis » dans <#${ids.reviews}>.`,
      welcome,
      "",
      "Relance `/installer-serveur` après un changement de prix : les messages sont mis à jour.",
    ].join("\n"),
  );
}

/** /installer-tickets : publie (ou met à jour) seulement le bouton « Ouvrir un ticket » dans le salon courant. */
export async function installTickets(
  interaction: ChatInputCommandInteraction<"cached">,
) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const problem = permissionProblem(interaction.guild);
  if (problem) {
    await interaction.editReply(problem);
    return;
  }
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.editReply(
      "Lance cette commande dans le salon où doit apparaître le bouton.",
    );
    return;
  }
  await ensureTicketSetup(interaction.guild);
  await upsert(channel, helpMessage());
  await interaction.editReply(
    "C'est prêt ✅ Le bouton est publié ici. Donne le rôle **Équipe Packio** aux personnes qui doivent voir les tickets (les administrateurs les voient déjà).",
  );
}

// -----------------------------------------------------------------------------
// Avis clients
// -----------------------------------------------------------------------------

/** Un avis par membre et par jour (protection contre les doublons). */
const lastReview = new Map<string, number>();
const REVIEW_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function ratingLabel() {
  return new LabelBuilder().setLabel("Ta note").setStringSelectMenuComponent(
    new StringSelectMenuBuilder()
      .setCustomId("rating")
      .setPlaceholder("Choisis une note")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        [5, 4, 3, 2, 1].map((n) => ({
          label: "⭐".repeat(n),
          value: String(n),
          description: `${n} sur 5`,
        })),
      ),
  );
}

function reviewTextInput() {
  return new TextInputBuilder()
    .setCustomId("text")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(10)
    .setMaxLength(1000)
    .setRequired(true);
}

/**
 * Bouton « Laisser un avis » : fenêtre avec la note, le texte et une photo
 * facultative. Si Discord refuse un élément récent (photo, liste dans une
 * fenêtre), une fenêtre plus simple est proposée à la place.
 */
export async function openReviewModal(
  interaction: ButtonInteraction<"cached">,
) {
  const text = () =>
    new LabelBuilder()
      .setLabel("Ton avis")
      .setDescription(
        "Ce que Packio t'a apporté : temps, ventes, tranquillité…",
      )
      .setTextInputComponent(reviewTextInput());
  const withPhoto = new ModalBuilder()
    .setCustomId(REVIEW_SUBMIT_ID)
    .setTitle("Ton avis sur Packio")
    .addLabelComponents(
      ratingLabel(),
      text(),
      new LabelBuilder()
        .setLabel("Une photo (facultatif)")
        .setDescription("Tes colis, ton stock, tes ventes…")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("photo")
            .setMinValues(0)
            .setMaxValues(1)
            .setRequired(false),
        ),
    );
  const withoutPhoto = new ModalBuilder()
    .setCustomId(REVIEW_SUBMIT_ID)
    .setTitle("Ton avis sur Packio")
    .addLabelComponents(ratingLabel(), text());
  const classic = new ModalBuilder()
    .setCustomId(REVIEW_SUBMIT_ID)
    .setTitle("Ton avis sur Packio")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("rating")
          .setLabel("Ta note sur 5")
          .setPlaceholder("5")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(5)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        reviewTextInput().setLabel("Ton avis"),
      ),
    );
  for (const modal of [withPhoto, withoutPhoto]) {
    try {
      await interaction.showModal(modal);
      return;
    } catch (err) {
      console.warn(
        "[discord] fenêtre d'avis refusée, version plus simple",
        err,
      );
    }
  }
  await interaction.showModal(classic);
}

/** Note choisie dans la liste, ou saisie à la main (fenêtre simple). */
function readRating(interaction: ModalSubmitInteraction<"cached">) {
  try {
    return Number(interaction.fields.getStringSelectValues("rating")[0]);
  } catch {
    return parseRating(interaction.fields.getTextInputValue("rating")) ?? 0;
  }
}

function readPhoto(interaction: ModalSubmitInteraction<"cached">) {
  try {
    return (
      interaction.fields
        .getUploadedFiles("photo")
        ?.find((f) => f.contentType?.startsWith("image/")) ?? null
    );
  } catch {
    return null;
  }
}

export async function submitReview(
  interaction: ModalSubmitInteraction<"cached">,
) {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) return;
  const userId = interaction.user.id;
  const last = lastReview.get(userId);
  if (last && Date.now() - last < REVIEW_COOLDOWN_MS) {
    await interaction.reply({
      content: "Merci, tu as déjà laissé un avis aujourd'hui 🙏",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const rating = readRating(interaction);
  const text = interaction.fields.getTextInputValue("text").trim();
  if (!(rating >= 1 && rating <= 5) || text.length < 10) {
    await interaction.reply({
      content: "Choisis une note et écris au moins quelques mots.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const photo = readPhoto(interaction);
  const ext =
    photo?.name
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "png";
  const embed = toEmbed(
    reviewEmbed({
      rating,
      author: interaction.member.displayName,
      avatarUrl: photo
        ? null
        : interaction.user.displayAvatarURL({ size: 128 }),
      text,
      at: new Date(),
    }),
  );
  // La photo est republiée avec l'avis (le lien d'envoi du formulaire est temporaire).
  if (photo) embed.setThumbnail(`attachment://avis.${ext}`);
  await channel.send({
    embeds: [embed],
    files: photo ? [{ attachment: photo.url, name: `avis.${ext}` }] : [],
    allowedMentions: { parse: [] },
  });
  lastReview.set(userId, Date.now());
  await keepAtBottom(channel, reviewPromptMessage());
  await interaction.editReply("Merci pour ton avis ⭐");
}

/**
 * Organisation et contenu du serveur Discord de Packio, sans dépendance à
 * discord.js pour être testés simplement. Appliqués par /installer-serveur
 * (server-setup.ts) : catégories, salons (nom, sujet, lecture seule), messages
 * avec encadrés et boutons. Les messages sont mis à jour à chaque relance.
 */

import { PACKIO_BLUE } from "./welcome";

export const PACKIO_GREEN = 0x22c55e;

// -----------------------------------------------------------------------------
// Droits du bot
// -----------------------------------------------------------------------------

/**
 * Lien pour (ré)inviter le bot avec tous les droits dont il a besoin : créer
 * et ranger les salons, créer le rôle de l'équipe, régler qui voit quoi.
 * Inviter de nouveau le bot avec ce lien met à jour ses droits.
 */
export function botInviteUrl(applicationId: string) {
  return `https://discord.com/oauth2/authorize?client_id=${applicationId}&scope=bot%20applications.commands&permissions=8`;
}

/** Droits manquants, en clair (vide si le bot peut tout installer). */
export function missingBotPermissions(has: {
  administrator: boolean;
  manageChannels: boolean;
  manageRoles: boolean;
}) {
  if (has.administrator) return [];
  return [
    !has.manageChannels ? "Gérer les salons" : null,
    !has.manageRoles ? "Gérer les rôles" : null,
  ].filter((p): p is string => p !== null);
}

// -----------------------------------------------------------------------------
// Organisation du serveur
// -----------------------------------------------------------------------------

export type ChannelKey =
  | "start"
  | "rules"
  | "news"
  | "pricing"
  | "guides"
  | "welcome"
  | "chat"
  | "results"
  | "ideas"
  | "preparer"
  | "help"
  | "reviews";

export type ChannelSpec = {
  key: ChannelKey;
  name: string;
  /** Mots reconnus dans le nom d'un salon existant (repris et renommé plutôt que recréé). */
  match: readonly string[];
  topic: string;
  /** Les membres lisent sans écrire (l'équipe et le bot écrivent). */
  readOnly: boolean;
};

/** Nom tel que Discord l'enregistre : en minuscules, sans apostrophe (« centre-d'aide » → « centre-daide »). */
export const discordChannelName = (name: string) =>
  name.toLowerCase().replace(/['’]/g, "");

/** Le salon porte déjà le bon nom, séparateur « ｜ » et émoji compris. */
export const sameChannelName = (current: string, wanted: string) =>
  discordChannelName(current) === discordChannelName(wanted);

export type CategorySpec = {
  name: string;
  match: readonly string[];
  channels: ChannelSpec[];
};

export const SERVER_LAYOUT: CategorySpec[] = [
  {
    name: "📌 BIENVENUE",
    match: ["bienvenue", "welcome", "information"],
    channels: [
      {
        key: "start",
        name: "👋｜commencer-ici",
        match: ["commencerici", "commencer", "demarrer"],
        topic: "Par où commencer : ton parcours pas à pas et les offres.",
        readOnly: true,
      },
      {
        key: "rules",
        name: "📜｜règles",
        match: ["regles", "reglement", "rules"],
        topic: "Les règles du serveur.",
        readOnly: true,
      },
      {
        key: "news",
        name: "✨｜nouveautés",
        match: ["nouveautes", "annonces", "news"],
        topic: "Les nouveautés de Packio : fonctionnalités, offres, annonces.",
        readOnly: true,
      },
      {
        key: "pricing",
        name: "💳｜tarifs",
        match: ["tarifs", "tarif", "offres", "prix"],
        topic: "Les offres, les crédits et les recharges.",
        readOnly: true,
      },
      {
        key: "guides",
        name: "📘｜guides",
        match: ["guides", "guide", "tutos"],
        topic: "Les guides pas à pas pour bien utiliser Packio.",
        readOnly: true,
      },
      {
        key: "welcome",
        name: "👋｜bienvenue",
        match: ["bienvenue", "welcome"],
        topic: "Les nouveaux vendeurs du serveur.",
        readOnly: true,
      },
    ],
  },
  {
    name: "💬 COMMUNAUTÉ",
    match: ["communaute", "community", "discussion"],
    channels: [
      {
        key: "chat",
        name: "💬｜général",
        match: ["general", "chat", "discussion"],
        topic: "Discussion entre vendeurs.",
        readOnly: false,
      },
      {
        key: "results",
        name: "🏆｜vos-résultats",
        match: ["resultats", "flexventes", "classement"],
        topic: "Partage tes ventes et tes réussites.",
        readOnly: false,
      },
      {
        key: "ideas",
        name: "💡｜idées",
        match: ["idees", "suggestions", "idee"],
        topic: "Tes idées pour améliorer Packio.",
        readOnly: false,
      },
      {
        key: "preparer",
        name: "📦｜devenir-préparateur",
        match: ["devenirpreparat", "devenir"],
        topic: "Rejoindre le réseau de préparateurs Packio.",
        readOnly: true,
      },
    ],
  },
  {
    name: "🛟 AIDE ET AVIS",
    match: ["aideetavis", "aide", "support", "avis"],
    channels: [
      {
        key: "help",
        name: "🛟｜centre-d’aide",
        match: ["centredaide", "centredaid", "aide", "support", "questions"],
        topic: "Une question ? Ouvre un ticket privé avec l'équipe.",
        readOnly: true,
      },
      {
        key: "reviews",
        name: "⭐｜avis-clients",
        match: ["avisclients", "avis", "temoignages"],
        topic: "Les avis des vendeurs Packio. Laisse le tien avec le bouton.",
        readOnly: true,
      },
    ],
  },
];

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

export type InfoEmbed = {
  title?: string;
  description?: string;
  color: number;
  image?: string;
  thumbnail?: string;
  footer?: string;
};
export type InfoButton =
  | { kind: "link"; label: string; emoji: string; url: string }
  | {
      kind: "action";
      id: string;
      label: string;
      emoji: string;
      style: "primary" | "success";
    };
/** Un message : ses encadrés, ses boutons, et le titre qui permet de le retrouver pour le mettre à jour. */
export type InfoMessage = {
  marker: string;
  embeds: InfoEmbed[];
  buttons: InfoButton[];
};

export type Links = {
  appUrl: string;
  extensionUrl?: string | null;
  ids: Partial<Record<ChannelKey, string>>;
};

export const TICKET_OPEN_ID = "packio:ticket:open";
export const REVIEW_OPEN_ID = "packio:review:open";
export const REVIEW_SUBMIT_ID = "packio:review:submit";

const ch = (links: Links, key: ChannelKey, fallback: string) =>
  links.ids[key] ? `<#${links.ids[key]}>` : fallback;

export function startMessage(links: Links): InfoMessage {
  const extension = links.extensionUrl
    ? `[l'extension Packio Connect](${links.extensionUrl})`
    : "l'extension Packio Connect (page Ventes de ton espace)";
  return {
    marker: "👋 Bienvenue chez Packio",
    embeds: [
      { color: PACKIO_BLUE, image: `${links.appUrl}/opengraph-image` },
      {
        color: PACKIO_BLUE,
        title: "👋 Bienvenue chez Packio",
        description:
          "**Tu vends, ton préparateur s'occupe des colis.**\n\nIci, tu trouves tout pour démarrer, poser tes questions et échanger avec les autres vendeurs.",
      },
      {
        color: PACKIO_BLUE,
        title: "🧭 Ton parcours, étape par étape",
        description: [
          "**1️⃣ Crée ton compte**",
          `↳ ${links.appUrl}/inscription`,
          "",
          "**2️⃣ Choisis ton offre**",
          `↳ ${ch(links, "pricing", "la page Tarifs")} · ton préparateur attitré t'est attribué sous 24 h`,
          "",
          "**3️⃣ Branche tes ventes**",
          `↳ Vinted et Vestiaire arrivent toutes seules avec ${extension} · ${ch(links, "guides", "les guides")}`,
          "",
          "**4️⃣ Passe ta première commande**",
          `↳ ton préparateur réceptionne, vérifie, stocke et expédie sous 48 h · ${ch(links, "guides", "les guides")}`,
        ].join("\n"),
      },
      {
        color: PACKIO_GREEN,
        description: `💳 **Les offres** : ${ch(links, "pricing", "la page Tarifs")} · 🛟 **Une question** : ${ch(links, "help", "ouvre un ticket")}`,
      },
    ],
    buttons: [
      {
        kind: "link",
        label: "Créer mon compte",
        emoji: "🚀",
        url: `${links.appUrl}/inscription`,
      },
    ],
  };
}

export function rulesMessage(links: Links): InfoMessage {
  return {
    marker: "📜 Les règles du serveur",
    embeds: [
      {
        color: PACKIO_BLUE,
        title: "📜 Les règles du serveur",
        description: [
          "Quatre règles simples, pour que tout le monde s'y sente bien.",
          "",
          "🤝 **Respect.** On est entre vendeurs : pas d'insulte, pas de moquerie.",
          "",
          "🚫 **Pas de pub.** Pas de lien vers un autre service, pas de démarchage en message privé.",
          "",
          "🔒 **Rien de personnel en public.** Adresse, téléphone, code de retrait, numéro de commande : uniquement dans un ticket.",
          "",
          `🛟 **Un souci avec ton compte ?** Ouvre un ticket dans ${ch(links, "help", "le centre d'aide")} plutôt que dans le chat.`,
          "",
          "*L'équipe peut retirer un message ou un membre qui ne respecte pas ces règles.*",
        ].join("\n"),
      },
    ],
    buttons: [],
  };
}

export function newsMessage(): InfoMessage {
  return {
    marker: "✨ Les nouveautés Packio",
    embeds: [
      {
        color: PACKIO_BLUE,
        title: "✨ Les nouveautés Packio",
        description:
          "Ici, l'équipe annonce les nouvelles fonctionnalités, les changements d'offres et les infos importantes.\n\n🔔 Active les notifications de ce salon pour ne rien manquer.",
      },
    ],
    buttons: [],
  };
}

export type PlanInfo = {
  name: string;
  priceCents: number;
  annualPriceCents: number | null;
  monthlyCredits: number;
  storageLimit: number | null;
};
export type PackInfo = { credits: number; priceCents: number };
export type PublicOffers = { plans: PlanInfo[]; packs: PackInfo[] };

export function euros(cents: number) {
  const value = cents / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(".", ",")} €`;
}

const PLAN_EMOJIS = ["🌱", "⭐", "💎", "🚀"];

export function pricingMessage(
  links: Links,
  offers: PublicOffers | null,
): InfoMessage {
  const plans = (offers?.plans ?? []).map((p, i) => {
    const stock =
      p.storageLimit == null
        ? "stock illimité"
        : `${p.storageLimit} articles en stock`;
    const annual = p.annualPriceCents
      ? ` · ou ${euros(p.annualPriceCents)} HT / an`
      : "";
    return `${PLAN_EMOJIS[i] ?? "•"} **${p.name} · ${euros(p.priceCents)} HT** / mois · ${p.monthlyCredits} crédits\n↳ ${stock}${annual}`;
  });
  const packs = offers?.packs.length
    ? `🔋 **Recharges** : ${offers.packs.map((k) => `${k.credits} crédits ${euros(k.priceCents)} HT`).join(" · ")}`
    : null;
  return {
    marker: "💳 Les offres Packio",
    embeds: [
      {
        color: PACKIO_BLUE,
        title: "💳 Les offres Packio",
        description: [
          ...(plans.length
            ? [plans.join("\n")]
            : [`Les offres sont présentées sur ${links.appUrl}/#tarifs`]),
          "",
          "📦 **Inclus dans toutes les offres** : un préparateur attitré, la réception et le contrôle de tes achats, le stockage, l'expédition de tes ventes sous 48 h, la messagerie directe et le suivi en temps réel.",
          ...(packs ? ["", packs] : []),
        ].join("\n"),
        footer:
          "Prix hors taxes · TVA ajoutée au paiement · sans engagement en mensuel",
      },
    ],
    buttons: [
      {
        kind: "link",
        label: "Créer mon compte",
        emoji: "🚀",
        url: `${links.appUrl}/inscription`,
      },
      {
        kind: "link",
        label: "Tout le détail",
        emoji: "🔎",
        url: `${links.appUrl}/#tarifs`,
      },
    ],
  };
}

export function guidesMessages(links: Links): InfoMessage[] {
  const extension = links.extensionUrl
    ? `[Packio Connect](${links.extensionUrl})`
    : "Packio Connect (lien dans ton espace, page Ventes)";
  return [
    {
      marker: "📘 Commander chez un fournisseur",
      embeds: [
        {
          color: PACKIO_BLUE,
          title: "📘 Commander chez un fournisseur",
          description: [
            "**1.** Dans ton espace, ouvre **Commander** : choisis le fournisseur (Vinted, AliExpress, Temu, SHEIN, ZenMarket, autre…) et le point de réception de ton préparateur.",
            "**2.** Passe ta commande chez le fournisseur avec ce point comme adresse de livraison.",
            "**3.** Quand le colis est arrivé, clique **« Colis arrivé : donner le code »** pour transmettre le code de retrait.",
            "**4.** Ton préparateur récupère le colis, vérifie l'article, le prend en photo et le met en stock.",
          ].join("\n"),
        },
      ],
      buttons: [],
    },
    {
      marker: "📘 Brancher tes ventes Vinted et Vestiaire",
      embeds: [
        {
          color: PACKIO_BLUE,
          title: "📘 Brancher tes ventes Vinted et Vestiaire",
          description: [
            `**1.** Installe l'extension ${extension} sur Chrome.`,
            "**2.** Dans ton espace, page **Ventes**, connecte-la en un clic.",
            "**3.** Tes ventes arrivent toutes seules : relie chacune à un article de ton stock (ou en dropshipping).",
            "**4.** Ton préparateur reçoit le bordereau et expédie sous 48 h. Une vente annulée est retirée automatiquement.",
          ].join("\n"),
        },
      ],
      buttons: [],
    },
    {
      marker: "📘 Comprendre les crédits",
      embeds: [
        {
          color: PACKIO_BLUE,
          title: "📘 Comprendre les crédits",
          description: [
            "• Ton offre te donne des **crédits chaque mois**.",
            "• Chaque colis préparé et expédié consomme des crédits selon sa taille : ils sont réservés au moment de la préparation, puis débités au dépôt.",
            "• Besoin de plus ? Recharge 10, 30, 50 ou 100 crédits depuis ton espace, page **Crédits**.",
            `• Tout le détail : ${links.appUrl}/#tarifs`,
          ].join("\n"),
        },
      ],
      buttons: [],
    },
  ];
}

export function preparerMessage(links: Links): InfoMessage {
  return {
    marker: "📦 Devenir préparateur Packio",
    embeds: [
      {
        color: PACKIO_BLUE,
        title: "📦 Devenir préparateur Packio",
        description: [
          "Tu as un peu de place, du temps en semaine et un point relais pas loin ? Rejoins le réseau de préparateurs.",
          "",
          "📥 Tu réceptionnes les achats des vendeurs qui te sont attribués.",
          "📸 Tu vérifies, prends en photo et ranges les articles.",
          "📤 Tu prépares et déposes les colis de leurs ventes sous 48 h.",
          "",
          `👉 Intéressé(e) ? Ouvre un ticket dans ${ch(links, "help", "le centre d'aide")} en indiquant ta ville : on te présente les conditions lors d'un appel.`,
        ].join("\n"),
      },
    ],
    buttons: [],
  };
}

export function helpMessage(): InfoMessage {
  return {
    marker: "🛟 Besoin de nous parler ?",
    embeds: [
      {
        color: PACKIO_BLUE,
        title: "🛟 Besoin de nous parler ?",
        description:
          "Clique sur **Ouvrir un ticket** : un salon privé, visible seulement par toi et l'équipe Packio.\n\nPour une commande, un colis ou ton abonnement, indique ton code client (affiché dans ton espace Packio).",
      },
    ],
    buttons: [
      {
        kind: "action",
        id: TICKET_OPEN_ID,
        label: "Ouvrir un ticket",
        emoji: "📩",
        style: "primary",
      },
    ],
  };
}

export function reviewPromptMessage(): InfoMessage {
  return {
    marker: "⭐ Raconte tes résultats",
    embeds: [
      {
        color: PACKIO_GREEN,
        title: "⭐ Raconte tes résultats",
        description:
          "Ce que Packio t'a fait gagner : du temps, des ventes, de la tranquillité.\nClique sur le bouton, donne ta note et quelques mots.",
      },
    ],
    buttons: [
      {
        kind: "action",
        id: REVIEW_OPEN_ID,
        label: "Laisser un avis",
        emoji: "⭐",
        style: "success",
      },
    ],
  };
}

/** Tous les messages à publier, salon par salon. */
export function serverMessages(
  links: Links,
  offers: PublicOffers | null,
): Partial<Record<ChannelKey, InfoMessage[]>> {
  return {
    start: [startMessage(links)],
    rules: [rulesMessage(links)],
    news: [newsMessage()],
    pricing: [pricingMessage(links, offers)],
    guides: guidesMessages(links),
    preparer: [preparerMessage(links)],
    help: [helpMessage()],
    reviews: [reviewPromptMessage()],
  };
}

// -----------------------------------------------------------------------------
// Avis
// -----------------------------------------------------------------------------

/** Note saisie par le membre : « 5 », « 4/5 », « ⭐⭐⭐ »… (null si illisible). */
export function parseRating(raw: string) {
  const text = raw.trim();
  const digit = text.match(/[1-5]/)?.[0];
  const n = digit ? Number(digit) : (text.match(/⭐|★/gu) ?? []).length;
  return n >= 1 && n <= 5 ? n : null;
}

export function reviewEmbed(input: {
  rating: number;
  author: string;
  avatarUrl?: string | null;
  text: string;
  at: Date;
}): InfoEmbed {
  return {
    color: PACKIO_GREEN,
    title: "⭐".repeat(input.rating),
    description: `**${input.author.slice(0, 80)}** · <t:${Math.floor(input.at.getTime() / 1000)}:D>\n\n${input.text.trim().slice(0, 1500)}`,
    thumbnail: input.avatarUrl ?? undefined,
  };
}

import { beforeEach, describe, expect, it } from "vitest";
import {
  SERVER_LAYOUT,
  botInviteUrl,
  missingBotPermissions,
  parseRating,
  pricingMessage,
  reviewEmbed,
  sameChannelName,
  serverMessages,
  startMessage,
  type Links,
} from "@/server/discord/content";
import {
  CHANNEL_KEYWORDS,
  findChannelId,
  normalizeChannelName,
} from "@/server/discord/welcome";
import { GET as offres } from "@/app/api/offres/route";
import { resetDb } from "../helpers";

const links: Links = {
  appUrl: "https://packio.test",
  extensionUrl: "https://chromewebstore.google.com/detail/x",
  ids: { pricing: "3", help: "4", guides: "5" },
};

describe("Bot Discord : installation du serveur", () => {
  it("lien d'invitation avec tous les droits, et droits manquants expliqués", () => {
    expect(botInviteUrl("123")).toBe(
      "https://discord.com/oauth2/authorize?client_id=123&scope=bot%20applications.commands&permissions=8",
    );
    expect(
      missingBotPermissions({
        administrator: false,
        manageChannels: false,
        manageRoles: false,
      }),
    ).toEqual(["Gérer les salons", "Gérer les rôles"]);
    expect(
      missingBotPermissions({
        administrator: false,
        manageChannels: true,
        manageRoles: false,
      }),
    ).toEqual(["Gérer les rôles"]);
    expect(
      missingBotPermissions({
        administrator: true,
        manageChannels: false,
        manageRoles: false,
      }),
    ).toEqual([]);
  });

  it("organisation : 3 catégories, salons uniques, reconnus par le message de bienvenue", () => {
    expect(SERVER_LAYOUT.map((c) => c.name)).toEqual([
      "📌 BIENVENUE",
      "💬 COMMUNAUTÉ",
      "🛟 AIDE ET AVIS",
    ]);
    const all = SERVER_LAYOUT.flatMap((c) => c.channels);
    expect(new Set(all.map((c) => c.key)).size).toBe(all.length);
    const channels = all.map((c, i) => ({ id: String(i), name: c.name }));
    const id = (key: string) => String(all.findIndex((c) => c.key === key));
    expect(findChannelId(channels, CHANNEL_KEYWORDS.welcome)).toBe(
      id("welcome"),
    );
    expect(findChannelId(channels, CHANNEL_KEYWORDS.start)).toBe(id("start"));
    expect(findChannelId(channels, CHANNEL_KEYWORDS.pricing)).toBe(
      id("pricing"),
    );
    expect(findChannelId(channels, CHANNEL_KEYWORDS.help)).toBe(id("help"));
    // Les anciens noms du serveur sont repris (renommés, pas recréés).
    for (const [old, key] of [
      ["🆘centre-daide", "help"],
      ["🔔annonces", "news"],
      ["📜règles", "rules"],
      ["👋commencer-ici", "start"],
    ] as const) {
      const spec = all.find((c) => c.key === key)!;
      expect(
        spec.match.some((k) => normalizeChannelName(old).includes(k)),
      ).toBe(true);
    }
    expect(all.filter((c) => !c.readOnly).map((c) => c.key)).toEqual([
      "chat",
      "results",
      "ideas",
    ]);
    // Ancien nom sans séparateur : renommé ; nom déjà enregistré par Discord (sans apostrophe) : gardé.
    expect(sameChannelName("👋commencer-ici", "👋｜commencer-ici")).toBe(false);
    expect(sameChannelName("🛟｜centre-daide", "🛟｜centre-d’aide")).toBe(true);
    expect(sameChannelName("👋｜bienvenue", "👋｜bienvenue")).toBe(true);
  });

  it("commencer-ici : bannière, parcours avec les salons, bouton pour créer son compte", () => {
    const m = startMessage(links);
    expect(m.embeds[0].image).toBe("https://packio.test/opengraph-image");
    const text = m.embeds.map((e) => e.description ?? "").join("\n");
    expect(text).toContain("https://packio.test/inscription");
    expect(text).toContain("<#3>");
    expect(text).toContain("<#4>");
    expect(text).toContain("https://chromewebstore.google.com/detail/x");
    expect(m.buttons).toEqual([
      {
        kind: "link",
        label: "Créer mon compte",
        emoji: "🚀",
        url: "https://packio.test/inscription",
      },
    ]);
  });

  it("tarifs : prix HT du site, recharges, boutons", () => {
    const m = pricingMessage(links, {
      plans: [
        {
          name: "Starter",
          priceCents: 4900,
          annualPriceCents: 49000,
          monthlyCredits: 20,
          storageLimit: 5,
        },
        {
          name: "Business",
          priceCents: 14990,
          annualPriceCents: null,
          monthlyCredits: 100,
          storageLimit: null,
        },
      ],
      packs: [{ credits: 10, priceCents: 2500 }],
    });
    const text = m.embeds[0].description!;
    expect(text).toContain("🌱 **Starter · 49 € HT** / mois · 20 crédits");
    expect(text).toContain("↳ 5 articles en stock · ou 490 € HT / an");
    expect(text).toContain(
      "⭐ **Business · 149,90 € HT** / mois · 100 crédits",
    );
    expect(text).toContain("stock illimité");
    expect(text).toContain("10 crédits 25 € HT");
    expect(m.embeds[0].footer).toContain("TVA ajoutée au paiement");
    expect(m.buttons.map((b) => b.label)).toEqual([
      "Créer mon compte",
      "Tout le détail",
    ]);
    expect(pricingMessage(links, null).embeds[0].description).toContain(
      "https://packio.test/#tarifs",
    );
  });

  it("chaque salon d'information a ses messages, chaque message un titre pour être mis à jour", () => {
    const all = serverMessages(links, null);
    expect(Object.keys(all).sort()).toEqual([
      "guides",
      "help",
      "news",
      "preparer",
      "pricing",
      "reviews",
      "rules",
      "start",
    ]);
    for (const list of Object.values(all)) {
      for (const m of list!)
        expect(
          m.embeds.some((e) =>
            e.title?.includes(m.marker.replace(/^\P{L}+/u, "")),
          ),
        ).toBe(true);
    }
    expect(all.help![0].buttons[0]).toMatchObject({
      kind: "action",
      id: "packio:ticket:open",
    });
    expect(all.reviews![0].buttons[0]).toMatchObject({
      kind: "action",
      id: "packio:review:open",
      label: "Laisser un avis",
    });
  });

  it("avis : note lue, étoiles, nom et date", () => {
    expect(parseRating("5")).toBe(5);
    expect(parseRating("4/5")).toBe(4);
    expect(parseRating("⭐⭐⭐")).toBe(3);
    expect(parseRating("dix")).toBeNull();
    const e = reviewEmbed({
      rating: 4,
      author: "mathis",
      text: "  Super service, rapide.  ",
      at: new Date("2026-11-14T10:00:00Z"),
    });
    expect(e.title).toBe("⭐⭐⭐⭐");
    expect(e.description).toBe(
      `**mathis** · <t:${Math.floor(new Date("2026-11-14T10:00:00Z").getTime() / 1000)}:D>\n\nSuper service, rapide.`,
    );
  });

  describe("offres publiques lues par le bot", () => {
    beforeEach(resetDb);
    it("renvoie les offres actives sans identifiants internes", async () => {
      const body = (await (await offres()).json()) as {
        plans: Record<string, unknown>[];
        packs: Record<string, unknown>[];
      };
      expect(body.plans.length).toBeGreaterThan(0);
      expect(Object.keys(body.plans[0]).sort()).toEqual([
        "annualPriceCents",
        "currency",
        "monthlyCredits",
        "name",
        "priceCents",
        "storageLimit",
      ]);
      expect(body.packs.length).toBeGreaterThan(0);
    });
  });
});

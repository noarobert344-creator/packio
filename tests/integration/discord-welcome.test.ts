import { describe, expect, it } from "vitest";
import { buildWelcome, CHANNEL_KEYWORDS, findChannelId, normalizeChannelName, PACKIO_BLUE } from "@/server/discord/welcome";

describe("Bot Discord : message de bienvenue", () => {
  const channels = [
    { id: "1", name: "👋｜bienvenue" },
    { id: "2", name: "👋｜commencer-ici" },
    { id: "3", name: "💳｜tarifs" },
    { id: "4", name: "🛟｜centre-d’aide" },
    { id: "5", name: "général" },
  ];

  it("reconnaît les salons par leur nom, émojis et accents compris", () => {
    expect(normalizeChannelName("🛟｜centre-d’aide")).toBe("centredaide");
    expect(findChannelId(channels, CHANNEL_KEYWORDS.welcome)).toBe("1");
    expect(findChannelId(channels, CHANNEL_KEYWORDS.start)).toBe("2");
    expect(findChannelId(channels, CHANNEL_KEYWORDS.pricing)).toBe("3");
    expect(findChannelId(channels, CHANNEL_KEYWORDS.help)).toBe("4");
    expect(findChannelId([{ id: "9", name: "annonces" }], CHANNEL_KEYWORDS.pricing)).toBeNull();
  });

  it("mentionne le nouveau membre, liste les salons et ne notifie que lui", () => {
    const msg = buildWelcome({ memberId: "42", channels: { start: "2", pricing: "3", help: "4" }, contactId: "7" });
    expect(msg.content).toBe("👋 Bienvenue <@42> !");
    expect(msg.embed.color).toBe(PACKIO_BLUE);
    expect(msg.embed.description).toContain("**Pour démarrer** : <#2>");
    expect(msg.embed.description).toContain("**Les offres** : <#3>");
    expect(msg.embed.description).toContain("**Une question** : <#4>");
    expect(msg.embed.description).toContain("envoie un MP à <@7>");
    expect(msg.allowedMentions).toEqual({ users: ["42"] });
    // Salon absent : la ligne disparaît.
    expect(buildWelcome({ memberId: "42", channels: {}, contactId: null }).embed.description).not.toContain("Les offres");
  });
});

describe("Bot Discord : tickets", () => {
  it("nom du salon, sujet et propriétaire du ticket", async () => {
    const { ticketChannelName, ticketOwnerFromTopic, ticketTopic } = await import("@/server/discord/tickets");
    expect(ticketChannelName("Papy Russe 🇷🇺")).toBe("ticket-papyrusse");
    expect(ticketChannelName("🔥🔥")).toBe("ticket-membre");
    expect(ticketOwnerFromTopic(ticketTopic("123456789012345678"))).toBe("123456789012345678");
    expect(ticketOwnerFromTopic("Salon quelconque")).toBeNull();
  });
});

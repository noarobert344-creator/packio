import { beforeEach, describe, expect, it } from "vitest";
import { autoExtract, extractSalesWithAI, redactPersonalData, type AiCaller } from "@/server/services/ai-extract";
import { createCustomer, db, resetDb } from "../helpers";

type RawSale = Awaited<ReturnType<AiCaller>>["sales"][number];

const sale = (over: Partial<RawSale> = {}): RawSale => ({
  externalOrderId: "T-1",
  externalItemId: "I-1",
  title: "Veste",
  priceCents: 2500,
  currency: "EUR",
  buyerName: null,
  soldAt: "2026-11-15T10:00:00Z",
  labelUrl: "https://www.vinted.fr/api/v2/shipments/9/label.pdf",
  cancelled: false,
  ...over,
});

const fake = (sales: RawSale[], seen?: string[]): AiCaller => async ({ content }) => {
  seen?.push(content);
  return { sales, inputTokens: 10_000, outputTokens: 1_000, model: "gemini-3.5-flash-lite", costMicros: 0 };
};

// Réponse Vinted dont les clés ont changé : plus de « my_orders ».
const RENAMED = JSON.stringify({
  meta: { page: 1, categories: [{ id: 1, title: "Femmes" }] },
  payload: {
    sold_transactions: [
      { transaction_id: 901, status: "completed", item: { id: 55, title: "Robe longue" }, price: { amount: "12.50", currency_code: "EUR" }, created_at: "2026-11-14T09:00:00Z", buyer: { login: "julie_b", email: "julie@example.com" } },
      { transaction_id: 902, status: "cancelled", item: { id: 56, title: "Sac" }, price: { amount: "30", currency_code: "EUR" }, created_at: "2026-11-13T09:00:00Z" },
      { transaction_id: 903, item: { id: 57, title: "Jean" }, total_item_price: "18", updated_at: 1763110000 },
    ],
  },
});

describe("Lecture de secours de Packio Connect", () => {
  beforeEach(resetDb);

  it("lecture automatique gratuite : retrouve les ventes malgré des clés renommées, écarte les annulations, sans IA", async () => {
    const { customerId } = await createCustomer();
    const calls: string[] = [];
    const res = await extractSalesWithAI(customerId, { platform: "VINTED", content: RENAMED }, { caller: fake([], calls) });
    expect(res.method).toBe("auto");
    expect(calls).toHaveLength(0);
    expect(res.sales.map((s) => [s.externalOrderId, s.externalItemId, s.title, s.priceCents, s.currency, s.buyerName])).toEqual([
      ["901", "55", "Robe longue", 1250, "eur", "julie_b"],
      ["903", "57", "Jean", 1800, undefined, undefined],
    ]);
    expect(await db.aiUsage.findFirstOrThrow({ where: { customerId } })).toMatchObject({ model: "lecture-auto", costMicros: 0, salesFound: 2 });

    // Page HTML contenant un bloc JSON.
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${RENAMED}</script></body></html>`;
    expect(autoExtract(html).map((s) => s.externalOrderId)).toEqual(["901", "902", "903"]);
  });

  it("IA externe seulement en dernier recours, avec les données personnelles masquées ; résultat revalidé", async () => {
    const { customerId } = await createCustomer();
    const unreadable = JSON.stringify({ blocs: [{ k: "commande 77", v: "Veste en jean", contact: { email: "acheteur@example.com" }, buyer: "Marie Dupont", phone: "06 12 34 56 78" }] });
    await expect(extractSalesWithAI(customerId, { platform: "VINTED", content: unreadable })).rejects.toMatchObject({ code: "AI_DISABLED" });

    const seen: string[] = [];
    const res = await extractSalesWithAI(
      customerId,
      { platform: "VINTED", content: unreadable },
      { caller: fake([sale(), sale(), sale({ externalOrderId: "T-2", cancelled: true }), sale({ externalOrderId: "T-3", labelUrl: "https://pirate.example/l.pdf", priceCents: -5, buyerName: "[masqué]" })], seen) },
    );
    expect(res.method).toBe("gemini");
    expect(seen[0]).not.toMatch(/acheteur@example\.com|Marie Dupont|06 12 34 56 78/);
    expect(seen[0]).toContain("Veste en jean");
    expect(res.sales.map((s) => s.externalOrderId)).toEqual(["T-1", "T-3"]);
    expect(res.sales[1]).toMatchObject({ labelUrl: undefined, priceCents: undefined, buyerName: undefined });
    expect(redactPersonalData('{"user":{"login":"x"},"title":"Pull"}')).toBe('{"user":"[masqué]","title":"Pull"}');
  });

  it("plafond quotidien par client (IA externe uniquement) et budget mensuel ; les échecs sont comptés", async () => {
    const { customerId } = await createCustomer();
    const input = { platform: "VESTIAIRE" as const, content: "<html>ventes illisibles</html>" };
    const failing: AiCaller = async () => {
      throw new Error("panne");
    };
    await expect(extractSalesWithAI(customerId, input, { caller: failing })).rejects.toMatchObject({ code: "AI_ERROR" });
    for (let i = 0; i < 5; i++) await extractSalesWithAI(customerId, input, { caller: fake([]) });
    await expect(extractSalesWithAI(customerId, input, { caller: fake([]) })).rejects.toMatchObject({ code: "AI_DAILY_LIMIT" });
    // La lecture automatique n'est jamais limitée.
    expect((await extractSalesWithAI(customerId, { platform: "VINTED", content: RENAMED })).method).toBe("auto");

    const other = await createCustomer();
    await db.aiUsage.create({ data: { customerId: other.customerId, platform: "VINTED", model: "claude-opus-5-5", costMicros: 15_000_000, succeeded: true } });
    await expect(extractSalesWithAI(other.customerId, input, { caller: fake([]) })).rejects.toMatchObject({ code: "AI_BUDGET" });
  });
});

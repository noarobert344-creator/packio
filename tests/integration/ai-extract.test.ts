import { beforeEach, describe, expect, it } from "vitest";
import { extractSalesWithAI, type AiCaller } from "@/server/services/ai-extract";
import { createCustomer, db, resetDb } from "../helpers";

const fake =
  (sales: Parameters<AiCaller>[0] extends never ? never : Awaited<ReturnType<AiCaller>>["sales"]): AiCaller =>
  async () => ({ sales, inputTokens: 10_000, outputTokens: 1_000, model: "claude-opus-5-5" });

const sale = (over: Partial<Awaited<ReturnType<AiCaller>>["sales"][number]> = {}) => ({
  externalOrderId: "T-1",
  externalItemId: "I-1",
  title: "Veste",
  priceCents: 2500,
  currency: "EUR",
  buyerName: "lea_b",
  soldAt: "2026-11-15T10:00:00Z",
  labelUrl: "https://www.vinted.fr/api/v2/shipments/9/label.pdf",
  cancelled: false,
  ...over,
});

describe("IA de secours de Packio Connect", () => {
  beforeEach(resetDb);

  it("désactivée sans clé API ; résultat revalidé (annulations, doublons, URL de bordereau hors plateforme) ; coût enregistré", async () => {
    const { customerId } = await createCustomer();
    await expect(extractSalesWithAI(customerId, { platform: "VINTED", content: "{}" })).rejects.toMatchObject({ code: "AI_DISABLED" });

    const res = await extractSalesWithAI(
      customerId,
      { platform: "VINTED", content: '{"inconnu": []}' },
      {
        caller: fake([
          sale(),
          sale(), // doublon
          sale({ externalOrderId: "T-2", cancelled: true }),
          sale({ externalOrderId: "T-3", labelUrl: "https://pirate.example/label.pdf", priceCents: -5, soldAt: "pas une date" }),
          sale({ externalOrderId: " " }),
        ]),
      },
    );
    expect(res.sales.map((s) => s.externalOrderId)).toEqual(["T-1", "T-3"]);
    expect(res.sales[0]).toMatchObject({ currency: "eur", priceCents: 2500, labelUrl: "https://www.vinted.fr/api/v2/shipments/9/label.pdf" });
    expect(res.sales[1].labelUrl).toBeUndefined();
    expect(res.sales[1].priceCents).toBeUndefined();
    const usage = await db.aiUsage.findFirstOrThrow({ where: { customerId } });
    expect(usage).toMatchObject({ succeeded: true, salesFound: 2, inputTokens: 10_000, outputTokens: 1_000, costMicros: 60_000 });
  });

  it("plafond quotidien par client et budget mensuel ; les échecs sont comptés", async () => {
    const { customerId } = await createCustomer();
    const input = { platform: "VESTIAIRE" as const, content: "<html>ventes</html>" };
    const failing: AiCaller = async () => {
      throw new Error("panne");
    };
    await expect(extractSalesWithAI(customerId, input, { caller: failing })).rejects.toMatchObject({ code: "AI_ERROR" });
    for (let i = 0; i < 5; i++) await extractSalesWithAI(customerId, input, { caller: fake([]) });
    await expect(extractSalesWithAI(customerId, input, { caller: fake([]) })).rejects.toMatchObject({ code: "AI_DAILY_LIMIT" });

    const other = await createCustomer();
    await db.aiUsage.create({ data: { customerId: other.customerId, platform: "VINTED", model: "claude-opus-5-5", costMicros: 15_000_000, succeeded: true } });
    await expect(extractSalesWithAI(other.customerId, input, { caller: fake([]) })).rejects.toMatchObject({ code: "AI_BUDGET" });
  });
});

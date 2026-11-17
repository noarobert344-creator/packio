import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startSubscriptionCheckout,
  WHOP_PRODUCT_SETTING,
} from "@/server/billing";
import { createCustomer, db, resetDb } from "../helpers";

const ENV = {
  BILLING_MODE: "whop",
  WHOP_API_KEY: "apik_test",
  WHOP_ACCOUNT_ID: "biz_Test123",
  WHOP_PRODUCT_ID: "",
};
type Call = { url: string; body: Record<string, unknown> };

function stubWhop(opts?: { failCheckoutOnce?: string }) {
  const calls: Call[] = [];
  let products = 0;
  let failed = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}")) as Record<
        string,
        unknown
      >;
      calls.push({ url, body });
      if (url.endsWith("/products"))
        return new Response(JSON.stringify({ id: `prod_auto${++products}` }), {
          status: 200,
        });
      if (opts?.failCheckoutOnce && !failed) {
        failed = true;
        return new Response(
          JSON.stringify({ error: { message: opts.failCheckoutOnce } }),
          { status: 400 },
        );
      }
      return new Response(
        JSON.stringify({
          id: "ch_1",
          purchase_url: "https://whop.com/checkout/ch_1",
        }),
        { status: 200 },
      );
    }),
  );
  return calls;
}

describe("Whop : produit Packio créé automatiquement pour les abonnements", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(async () => {
    await resetDb();
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("crée le produit une seule fois puis le réutilise", async () => {
    const plan = await db.plan.findUniqueOrThrow({
      where: { code: "STARTER" },
    });
    await db.plan.updateMany({
      data: { whopPlanId: null, whopAnnualPlanId: null },
    });
    const a = await createCustomer({ subscribe: false });
    const b = await createCustomer({ subscribe: false });
    const calls = stubWhop();

    expect(await startSubscriptionCheckout(a.actor, plan.id)).toEqual({
      url: "https://whop.com/checkout/ch_1",
    });
    await startSubscriptionCheckout(b.actor, plan.id);

    const productCalls = calls.filter((c) => c.url.endsWith("/products"));
    expect(productCalls).toHaveLength(1);
    expect(productCalls[0].body).toMatchObject({
      title: "Packio",
      account_id: "biz_Test123",
    });
    const checkouts = calls.filter((c) =>
      c.url.endsWith("/checkout_configurations"),
    );
    expect(checkouts).toHaveLength(2);
    for (const c of checkouts) {
      expect(c.body).toMatchObject({
        account_id: "biz_Test123",
        // Le premier jour : le prix de l'offre seul (pas de frais initiaux en plus), taxe ajoutée par Whop.
        variant: {
          billing_type: "renewal",
          product_id: "prod_auto1",
          initial_price: 0,
          renewal_price: plan.priceCents / 100,
          override_tax_type: "exclusive",
        },
      });
    }
    expect(
      (
        await db.appSetting.findUniqueOrThrow({
          where: { key: WHOP_PRODUCT_SETTING },
        })
      ).value,
    ).toMatchObject({ id: "prod_auto1", accountId: "biz_Test123" });
  });

  it("utilise WHOP_PRODUCT_ID s'il est renseigné ; recrée le produit s'il a disparu chez Whop", async () => {
    const plan = await db.plan.findUniqueOrThrow({
      where: { code: "STARTER" },
    });
    await db.plan.updateMany({
      data: { whopPlanId: null, whopAnnualPlanId: null },
    });
    const a = await createCustomer({ subscribe: false });

    process.env.WHOP_PRODUCT_ID = "prod_Manuel";
    let calls = stubWhop();
    await startSubscriptionCheckout(a.actor, plan.id);
    expect(calls.some((c) => c.url.endsWith("/products"))).toBe(false);
    expect(calls[0].body).toMatchObject({
      variant: { product_id: "prod_Manuel" },
    });
    vi.unstubAllGlobals();

    process.env.WHOP_PRODUCT_ID = "";
    await db.appSetting.create({
      data: {
        key: WHOP_PRODUCT_SETTING,
        value: { id: "prod_Supprime", accountId: "biz_Test123" },
      },
    });
    calls = stubWhop({ failCheckoutOnce: "Product not found" });
    await startSubscriptionCheckout(a.actor, plan.id);
    const checkouts = calls.filter((c) =>
      c.url.endsWith("/checkout_configurations"),
    );
    expect(
      checkouts.map(
        (c) => (c.body.variant as { product_id: string }).product_id,
      ),
    ).toEqual(["prod_Supprime", "prod_auto1"]);
    vi.unstubAllGlobals();

    // Si Whop refuse l'option de taxe, le paiement se fait quand même (réglage du compte).
    calls = stubWhop({ failCheckoutOnce: "Invalid override_tax_type" });
    expect(await startSubscriptionCheckout(a.actor, plan.id)).toEqual({
      url: "https://whop.com/checkout/ch_1",
    });
    const tries = calls
      .filter((c) => c.url.endsWith("/checkout_configurations"))
      .map(
        (c) =>
          (c.body.variant as { override_tax_type?: string }).override_tax_type,
      );
    expect(tries).toEqual(["exclusive", undefined]);
  });
});

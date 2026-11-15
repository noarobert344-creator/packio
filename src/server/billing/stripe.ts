import "server-only";
import Stripe from "stripe";
import { env } from "@/server/env";

let client: Stripe | null = null;

/** Client Stripe (clé secrète côté serveur uniquement). */
export function getStripe(): Stripe {
  if (!env.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY n'est pas configurée.");
  }
  if (!client) {
    client = new Stripe(env.stripeSecretKey, {
      appInfo: { name: "Packio", version: "1.0.0" },
      maxNetworkRetries: 2,
      timeout: 20_000,
    });
  }
  return client;
}

export function isStripeConfigured() {
  return !!env.stripeSecretKey;
}

// -----------------------------------------------------------------------------
// Extraction tolérante des objets Stripe (compatible anciennes et nouvelles
// versions de l'API : `invoice.parent.subscription_details`, périodes portées
// par les éléments d'abonnement, etc.).
// -----------------------------------------------------------------------------

type Obj = Record<string, unknown>;

export function asObj(v: unknown): Obj {
  return v && typeof v === "object" ? (v as Obj) : {};
}

export function idOf(v: unknown): string | null {
  if (typeof v === "string") return v;
  const o = asObj(v);
  return typeof o.id === "string" ? o.id : null;
}

export function toDate(v: unknown): Date | null {
  return typeof v === "number" && v > 0 ? new Date(v * 1000) : null;
}

export function metadataOf(v: unknown): Record<string, string> {
  return asObj(asObj(v).metadata) as Record<string, string>;
}

export function subscriptionPeriod(sub: unknown): { start: Date | null; end: Date | null } {
  const s = asObj(sub);
  const item = asObj((asObj(s.items).data as unknown[] | undefined)?.[0]);
  return {
    start: toDate(item.current_period_start) ?? toDate(s.current_period_start),
    end: toDate(item.current_period_end) ?? toDate(s.current_period_end),
  };
}

export function subscriptionPriceId(sub: unknown): string | null {
  const item = asObj((asObj(asObj(sub).items).data as unknown[] | undefined)?.[0]);
  return idOf(item.price) ?? idOf(asObj(item.plan));
}

export function invoiceSubscriptionId(invoice: unknown): string | null {
  const inv = asObj(invoice);
  const fromParent = idOf(asObj(asObj(inv.parent).subscription_details).subscription);
  return fromParent ?? idOf(inv.subscription);
}

export function invoiceLine(invoice: unknown): { priceId: string | null; start: Date | null; end: Date | null } {
  const lines = (asObj(asObj(invoice).lines).data as unknown[] | undefined) ?? [];
  const pick =
    lines.find((l) => {
      const o = asObj(l);
      return o.type === "subscription" || asObj(o.parent).type === "subscription_item_details";
    }) ?? lines[0];
  const line = asObj(pick);
  const priceId = idOf(asObj(asObj(line.pricing).price_details).price) ?? idOf(line.price);
  const period = asObj(line.period);
  return { priceId, start: toDate(period.start), end: toDate(period.end) };
}

export function invoicePaymentIntentId(invoice: unknown): string | null {
  const inv = asObj(invoice);
  const payments = (asObj(inv.payments).data as unknown[] | undefined) ?? [];
  for (const p of payments) {
    const id = idOf(asObj(asObj(p).payment).payment_intent);
    if (id) return id;
  }
  return idOf(inv.payment_intent);
}

const STATUS_MAP: Record<string, import("@/generated/prisma/enums").SubscriptionStatus> = {
  incomplete: "INCOMPLETE",
  incomplete_expired: "INCOMPLETE_EXPIRED",
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  canceled: "CANCELED",
  unpaid: "UNPAID",
  paused: "PAUSED",
};

export function mapSubscriptionStatus(status: unknown) {
  return STATUS_MAP[String(status)] ?? "INCOMPLETE";
}

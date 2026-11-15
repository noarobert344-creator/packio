import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

/**
 * Client minimal de l'API Whop (https://docs.whop.com) — appels HTTPS côté
 * serveur uniquement, clé API jamais exposée au navigateur.
 *
 * Références vérifiées dans le SDK officiel @whop/sdk :
 *  - POST   /checkout_configurations           → { id, purchase_url }
 *  - GET    /memberships/{id}
 *  - POST   /memberships/{id}/cancel           { cancel_at_period_end }
 *  - PATCH  /memberships/{id}                  { cancel_at_period_end } | { renewal_price } | { metadata }
 *    (un seul champ par appel ; renewal_price ne peut que baisser)
 *  - GET    /payments/{id}
 *  - POST   /payments/{id}/refund              { partial_amount } (unités monétaires)
 *  - Webhooks au format Standard Webhooks, HMAC-SHA256 avec le secret tel quel.
 */

export class WhopApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WhopApiError";
  }
}

export function isWhopConfigured() {
  return !!env.whop.apiKey;
}

function baseUrl() {
  return env.whop.environment === "sandbox" ? "https://sandbox-api.whop.com/api/v1" : "https://api.whop.com/api/v1";
}

async function whopRequest<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, opts?: { idempotencyKey?: string }): Promise<T> {
  if (!env.whop.apiKey) throw new WhopApiError("WHOP_API_KEY n'est pas configurée.", 500);
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.whop.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(env.whop.apiVersionDate ? { "Api-Version-Date": env.whop.apiVersionDate } : {}),
      ...(opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey.slice(0, 255) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const err = asObj(asObj(json).error);
    const message = (typeof err.message === "string" && err.message) || (typeof asObj(json).message === "string" && (asObj(json).message as string)) || `HTTP ${res.status}`;
    throw new WhopApiError(`Whop : ${message}`, res.status);
  }
  return json as T;
}

// -----------------------------------------------------------------------------
// Ressources
// -----------------------------------------------------------------------------

export type CheckoutVariant = {
  billing_type: "renewal" | "one_time";
  billing_period?: number;
  initial_price: number;
  renewal_price?: number;
  currency: string;
  title: string;
  description?: string;
  product_id?: string;
  visibility: "hidden" | "visible";
  release_method: "buy_now";
  unlimited_stock: true;
};

export async function createCheckoutConfiguration(input: {
  variantId?: string | null;
  variant?: CheckoutVariant;
  metadata: Record<string, string>;
  redirectUrl: string;
  idempotencyKey?: string;
}): Promise<{ id: string; purchase_url: string }> {
  const body = {
    ...(env.whop.accountId ? { account_id: env.whop.accountId } : {}),
    mode: "payment",
    metadata: input.metadata,
    redirect_url: input.redirectUrl,
    ...(input.variantId ? { variant_id: input.variantId } : { variant: input.variant }),
  };
  const res = await whopRequest<{ id: string; purchase_url: string }>("POST", "/checkout_configurations", body, { idempotencyKey: input.idempotencyKey });
  if (!res.purchase_url) throw new WhopApiError("Whop n'a pas renvoyé de lien de paiement.", 502);
  return res;
}

export function retrieveMembership(id: string) {
  return whopRequest<Record<string, unknown>>("GET", `/memberships/${encodeURIComponent(id)}`);
}

export function cancelMembershipAtPeriodEnd(id: string) {
  return whopRequest<Record<string, unknown>>("POST", `/memberships/${encodeURIComponent(id)}/cancel`, { cancel_at_period_end: true });
}

/**
 * Modification d'une adhésion Whop. Whop n'accepte qu'un champ par appel pour
 * renewal_price, et ce prix ne peut que baisser : une montée en gamme passe
 * donc par un nouveau paiement (voir startPlanChangeCheckout).
 */
export function updateMembership(
  id: string,
  body: { cancel_at_period_end: boolean } | { renewal_price: number } | { metadata: Record<string, unknown> },
) {
  return whopRequest<Record<string, unknown>>("PATCH", `/memberships/${encodeURIComponent(id)}`, body);
}

export function retrievePayment(id: string) {
  return whopRequest<Record<string, unknown>>("GET", `/payments/${encodeURIComponent(id)}`);
}

export function refundWhopPayment(id: string, partialAmount: number | null, idempotencyKey: string) {
  return whopRequest<Record<string, unknown>>("POST", `/payments/${encodeURIComponent(id)}/refund`, partialAmount ? { partial_amount: partialAmount } : {}, { idempotencyKey });
}

// -----------------------------------------------------------------------------
// Webhooks (Standard Webhooks)
// -----------------------------------------------------------------------------

const TOLERANCE_SECONDS = 5 * 60;

/**
 * Vérifie la signature d'un webhook Whop. Whop signe avec les octets du secret
 * tel qu'il est fourni (préfixe « ws_ » compris, sans décodage base64) le
 * contenu `${webhook-id}.${webhook-timestamp}.${corps brut}` en HMAC-SHA256.
 * L'en-tête `webhook-signature` contient une ou plusieurs signatures `v1,<base64>`.
 */
export function verifyWhopSignature(rawBody: string, headers: Headers, secret: string, now = Date.now()): boolean {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !signatures || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", Buffer.from(secret, "utf8")).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signatures.split(" ").some((part) => {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Signature d'un corps de webhook (tests et outils de développement). */
export function signWhopWebhook(rawBody: string, secret: string, id: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", Buffer.from(secret, "utf8")).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${signature}` };
}

// -----------------------------------------------------------------------------
// Lecture tolérante des objets Whop
// -----------------------------------------------------------------------------

type Obj = Record<string, unknown>;

export function asObj(v: unknown): Obj {
  return v && typeof v === "object" ? (v as Obj) : {};
}

export function idOf(v: unknown): string | null {
  if (typeof v === "string" && v) return v;
  const id = asObj(v).id;
  return typeof id === "string" && id ? id : null;
}

/** Montant Whop → centimes. Accepte `{ amount: "29.90" }`, `"29.90"` ou `29.9`. */
export function toCents(v: unknown): number {
  const raw = v && typeof v === "object" ? asObj(v).amount : v;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function currencyOf(v: unknown, fallback = "eur"): string {
  const c = v && typeof v === "object" ? asObj(v).currency : v;
  return typeof c === "string" && c ? c.toLowerCase() : fallback;
}

/** Date Whop (ISO 8601, ou secondes Unix pour d'anciennes versions) → Date. */
export function toDate(v: unknown): Date | null {
  if (typeof v === "number" && v > 0) return new Date(v * 1000);
  if (typeof v === "string" && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function metadataOf(v: unknown): Record<string, string> {
  const meta = asObj(asObj(v).metadata);
  return Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== null && value !== undefined).map(([k, value]) => [k, String(value)]));
}

const STATUS_MAP: Record<string, import("@/generated/prisma/enums").SubscriptionStatus> = {
  trialing: "TRIALING",
  active: "ACTIVE",
  past_due: "PAST_DUE",
  unresolved: "UNPAID",
  canceled: "CANCELED",
  completed: "CANCELED",
  expired: "CANCELED",
  drafted: "INCOMPLETE",
};

export function mapMembershipStatus(status: unknown) {
  return STATUS_MAP[String(status)] ?? "INCOMPLETE";
}

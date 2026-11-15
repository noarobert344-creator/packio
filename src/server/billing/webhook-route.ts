import { env } from "@/server/env";
import { handleWhopEvent, RetryLaterError, type WebhookDeps, type WebhookEvent } from "./webhook";
import { retrieveMembership, retrievePayment, verifyWhopSignature } from "./whop";

/**
 * Point d'entrée des webhooks Whop : vérification de la signature (Standard
 * Webhooks) sur le corps brut, puis traitement idempotent. Une erreur renvoie
 * un code 5xx pour que Whop renvoie l'événement plus tard.
 */
export async function processWhopWebhook(request: Request, deps?: WebhookDeps): Promise<Response> {
  const secret = env.whop.webhookSecret;
  if (!secret) return Response.json({ error: "Webhook non configuré" }, { status: 503 });
  const payload = await request.text();
  if (!verifyWhopSignature(payload, request.headers, secret)) {
    return Response.json({ error: "Signature invalide" }, { status: 400 });
  }
  let event: WebhookEvent;
  try {
    const parsed = JSON.parse(payload) as { id?: unknown; type?: unknown; data?: unknown };
    const id = typeof parsed.id === "string" && parsed.id ? parsed.id : request.headers.get("webhook-id");
    if (!id || typeof parsed.type !== "string") throw new Error("invalid");
    event = { id, type: parsed.type, data: parsed.data };
  } catch {
    return Response.json({ error: "Corps invalide" }, { status: 400 });
  }
  const resolved: WebhookDeps = deps ?? { retrieveMembership, retrievePayment };
  try {
    const outcome = await handleWhopEvent(event, resolved);
    return Response.json({ received: true, outcome });
  } catch (err) {
    if (err instanceof RetryLaterError) return Response.json({ error: err.message }, { status: 409 });
    console.error(`[whop] échec du traitement de ${event.id} (${event.type})`, err);
    return Response.json({ error: "Traitement en échec" }, { status: 500 });
  }
}

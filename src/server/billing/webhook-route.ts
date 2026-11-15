import Stripe from "stripe";
import { env } from "@/server/env";
import { getStripe } from "./stripe";
import { handleStripeEvent, RetryLaterError, type WebhookDeps } from "./webhook";

/**
 * Point d'entrée des webhooks Stripe : vérification de la signature sur le
 * corps brut, puis traitement idempotent. Une erreur renvoie un code 5xx pour
 * que Stripe renvoie l'événement plus tard.
 */
export async function processStripeWebhook(request: Request, deps?: WebhookDeps): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  const secret = env.stripeWebhookSecret;
  if (!secret) return Response.json({ error: "Webhook non configuré" }, { status: 503 });
  if (!signature) return Response.json({ error: "Signature manquante" }, { status: 400 });
  const payload = await request.text();
  let event: { id: string; type: string; data: { object: unknown } };
  try {
    event = Stripe.webhooks.constructEvent(payload, signature, secret) as unknown as typeof event;
  } catch {
    return Response.json({ error: "Signature invalide" }, { status: 400 });
  }
  const resolvedDeps: WebhookDeps = deps ?? { retrieveSubscription: (id) => getStripe().subscriptions.retrieve(id) };
  try {
    const outcome = await handleStripeEvent(event, resolvedDeps);
    return Response.json({ received: true, outcome });
  } catch (err) {
    if (err instanceof RetryLaterError) return Response.json({ error: err.message }, { status: 409 });
    console.error(`[stripe] échec du traitement de ${event.id} (${event.type})`, err);
    return Response.json({ error: "Traitement en échec" }, { status: 500 });
  }
}

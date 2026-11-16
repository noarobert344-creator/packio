"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getSession, homePathFor } from "@/server/auth/current";
import { DomainError } from "@/server/errors";
import { removePushSubscription, savePushSubscription, sendPush } from "@/server/services/push";

const subscriptionSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

type Result = { ok: true; sent?: number } | { ok: false; error: string };

async function currentUser() {
  const session = await getSession();
  if (!session) throw new DomainError("UNAUTHENTICATED", "Connectez-vous pour activer les notifications.");
  return session.actor;
}

function fail(err: unknown): Result {
  if (err instanceof DomainError) return { ok: false, error: err.message };
  console.error("[push] action en échec", err);
  return { ok: false, error: "Une erreur est survenue. Réessayez." };
}

/** Enregistre l'abonnement Web Push de cet appareil pour l'utilisateur connecté. */
export async function subscribePushAction(input: unknown): Promise<Result> {
  try {
    const actor = await currentUser();
    const parsed = subscriptionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Abonnement invalide." };
    await savePushSubscription(actor.userId, parsed.data, (await headers()).get("user-agent"));
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function unsubscribePushAction(endpoint: string): Promise<Result> {
  try {
    const actor = await currentUser();
    if (typeof endpoint !== "string" || endpoint.length > 1000) return { ok: false, error: "Abonnement invalide." };
    await removePushSubscription(actor.userId, endpoint);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Notification d'essai sur tous les appareils de l'utilisateur. */
export async function testPushAction(): Promise<Result> {
  try {
    const actor = await currentUser();
    const { sent } = await sendPush(actor.userId, {
      title: "Notifications activées",
      body: "Vous recevrez ici les notifications Packio que vous avez choisies.",
      link: homePathFor(actor),
      tag: "TEST",
    });
    return { ok: true, sent };
  } catch (err) {
    return fail(err);
  }
}

import "server-only";
import webpush from "web-push";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { DomainError } from "@/server/errors";
import { getSetting } from "./settings";

/**
 * Notifications sur le téléphone (Web Push). Le contenu est chiffré de bout en
 * bout entre Packio et l'appareil : le service de notification du navigateur
 * (Apple, Google, Mozilla, Microsoft) ne fait que l'acheminer.
 */

export type PushMessage = { title: string; body: string; link?: string; tag?: string };
type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
type Sender = (sub: Subscription, payload: string, vapid: Vapid) => Promise<unknown>;
type Vapid = { subject: string; publicKey: string; privateKey: string };

const SETTING_KEY = "web_push_vapid";

/** Services de notification acceptés (évite qu'une adresse arbitraire soit appelée par le serveur). */
const PUSH_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

export function isAllowedPushEndpoint(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port) return false;
  return PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

let sender: Sender | null = null;
/** Tests : remplace l'envoi réel. */
export function setPushSenderForTests(s: Sender | null) {
  sender = s;
}

const defaultSender: Sender = (sub, payload, vapid) =>
  webpush.sendNotification(sub, payload, {
    vapidDetails: vapid,
    TTL: 24 * 3600,
    urgency: "normal",
    timeout: 5000,
  });

/** Clés VAPID : variables d'environnement si présentes, sinon générées une fois et conservées en base. */
async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const read = async () => (await db.appSetting.findUnique({ where: { key: SETTING_KEY } }))?.value as { publicKey: string; privateKey: string } | undefined;
  const existing = await read();
  if (existing?.publicKey && existing.privateKey) return existing;
  const generated = webpush.generateVAPIDKeys();
  // Création concurrente : la première clé enregistrée l'emporte.
  await db.appSetting.createMany({ data: [{ key: SETTING_KEY, value: { publicKey: generated.publicKey, privateKey: generated.privateKey } }], skipDuplicates: true });
  return (await read())!;
}

export async function getVapidPublicKey() {
  return (await vapidKeys()).publicKey;
}

async function vapid(): Promise<Vapid> {
  const keys = await vapidKeys();
  // Le sujet doit être une adresse https ou mailto (Apple refuse localhost).
  const subject = process.env.VAPID_SUBJECT || (env.appUrl.startsWith("https://") ? env.appUrl : `mailto:${(await getSetting("support")).email}`);
  return { subject, ...keys };
}

export async function savePushSubscription(userId: string, sub: Subscription, userAgent?: string | null) {
  if (!isAllowedPushEndpoint(sub.endpoint)) throw new DomainError("PUSH_ENDPOINT", "Ce navigateur n'est pas pris en charge pour les notifications.");
  const data = { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null, failures: 0 };
  // Un même appareil passé d'un compte à un autre : l'abonnement suit le compte connecté.
  await db.pushSubscription.upsert({ where: { endpoint: sub.endpoint }, create: { endpoint: sub.endpoint, ...data }, update: data });
}

export async function removePushSubscription(userId: string, endpoint: string) {
  await db.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

export async function countPushDevices(userId: string) {
  return db.pushSubscription.count({ where: { userId } });
}

/** Envoie une notification à tous les appareils de l'utilisateur ; nettoie les abonnements expirés. */
export async function sendPush(userId: string, message: PushMessage) {
  const subs = await db.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return { sent: 0, removed: 0 };
  const keys = await vapid();
  const payload = JSON.stringify({ title: message.title, body: message.body, link: message.link ?? null, tag: message.tag ?? null });
  let sent = 0;
  let removed = 0;
  for (const s of subs) {
    try {
      await (sender ?? defaultSender)({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, keys);
      await db.pushSubscription.update({ where: { id: s.id }, data: { lastSentAt: new Date(), failures: 0 } });
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410 || s.failures >= 9) {
        await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
        removed++;
      } else {
        await db.pushSubscription.update({ where: { id: s.id }, data: { failures: { increment: 1 } } }).catch(() => undefined);
        console.warn("[push] envoi en échec", status ?? (err instanceof Error ? err.message : err));
      }
    }
  }
  return { sent, removed };
}

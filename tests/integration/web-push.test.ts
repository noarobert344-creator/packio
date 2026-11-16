import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getVapidPublicKey, isAllowedPushEndpoint, savePushSubscription, setPushSenderForTests } from "@/server/services/push";
import { notifyNow, savePreferences } from "@/server/services/notifications";
import { createCustomer, db, resetDb } from "../helpers";

const SUB = (n = 1) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/appareil-${n}`,
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
});

describe("Notifications sur le téléphone (Web Push)", () => {
  let sent: { endpoint: string; payload: Record<string, unknown> }[];
  beforeEach(async () => {
    await resetDb();
    sent = [];
    setPushSenderForTests(async (sub, payload) => {
      if (sub.endpoint.endsWith("expire")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    });
  });
  afterEach(() => setPushSenderForTests(null));

  it("accepte seulement les services de notification connus (pas d'adresse arbitraire)", async () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QGx")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isAllowedPushEndpoint("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.pirate.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    const { user } = await createCustomer();
    await expect(savePushSubscription(user.id, { ...SUB(), endpoint: "https://interne.example/x" })).rejects.toMatchObject({ code: "PUSH_ENDPOINT" });
    // Clé publique générée une fois, puis stable.
    const key = await getVapidPublicKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(await getVapidPublicKey()).toBe(key);
  });

  it("chaque notification part sur les appareils selon le choix « Téléphone » ; abonnements expirés supprimés", async () => {
    const { user } = await createCustomer();
    await savePushSubscription(user.id, SUB(1), "iPhone");
    await savePushSubscription(user.id, { ...SUB(2), endpoint: "https://web.push.apple.com/expire" });

    await notifyNow(user.id, { type: "SHIPMENT_SHIPPED", title: "Colis expédié", body: "Votre colis est parti.", link: "/client/expeditions/1" });
    expect(sent).toEqual([{ endpoint: SUB(1).endpoint, payload: { title: "Colis expédié", body: "Votre colis est parti.", link: "/client/expeditions/1", tag: "SHIPMENT_SHIPPED" } }]);
    expect(await db.pushSubscription.count({ where: { userId: user.id } })).toBe(1);

    // Par défaut, pas de téléphone pour les événements mineurs (comme l'e-mail).
    await notifyNow(user.id, { type: "STOCK_UPDATED", title: "Stock mis à jour", body: "…" });
    expect(sent).toHaveLength(1);

    // Le client choisit : plus de téléphone pour les expéditions, mais oui pour le stock.
    await savePreferences(user.id, [
      { type: "SHIPMENT_SHIPPED", inApp: true, email: true, push: false },
      { type: "STOCK_UPDATED", inApp: true, email: false, push: true },
    ]);
    await notifyNow(user.id, { type: "SHIPMENT_SHIPPED", title: "Colis expédié", body: "Encore un." });
    await notifyNow(user.id, { type: "STOCK_UPDATED", title: "Stock mis à jour", body: "2 articles." });
    expect(sent.map((s) => s.payload.title)).toEqual(["Colis expédié", "Stock mis à jour"]);
    // La notification reste visible dans l'application.
    expect(await db.notification.count({ where: { userId: user.id, type: "SHIPMENT_SHIPPED" } })).toBe(2);

    // Un appareil passé sur un autre compte suit le compte connecté.
    const other = await createCustomer();
    await savePushSubscription(other.user.id, SUB(1));
    expect(await db.pushSubscription.findUniqueOrThrow({ where: { endpoint: SUB(1).endpoint } })).toMatchObject({ userId: other.user.id });
  });
});

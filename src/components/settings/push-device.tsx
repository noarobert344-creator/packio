"use client";

import { useEffect, useState } from "react";
import { BellOff, BellRing, Share, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { subscribePushAction, testPushAction, unsubscribePushAction } from "@/server/actions/push";

type State = "checking" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function base64UrlToBytes(value: string) {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Le service de notification du navigateur peut ne jamais répondre : on abandonne après 20 s. */
function withTimeout<T>(promise: Promise<T>, ms = 20_000) {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

async function registration() {
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

/** Activation des notifications sur l'appareil utilisé (téléphone ou ordinateur). */
export function PushDevice({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) return setState(isIos() && !isStandalone() ? "ios-install" : "unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Abonnement déjà présent : on le renvoie au serveur (compte connecté, clés à jour).
        await subscribePushAction(sub.toJSON());
        return setState("on");
      }
      setState("off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
      const reg = await registration();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await withTimeout(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) })));
      const res = await subscribePushAction(sub.toJSON());
      if (!res.ok) {
        await sub.unsubscribe().catch(() => undefined);
        toast.error(res.error);
        return;
      }
      setState("on");
      const test = await testPushAction();
      toast.success(test.ok && test.sent ? "Notifications activées : une notification d'essai vient d'être envoyée." : "Notifications activées sur cet appareil.");
    } catch {
      toast.error("Impossible d'activer les notifications sur cet appareil. Vérifiez votre connexion, puis réessayez.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePushAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      toast.success("Notifications désactivées sur cet appareil.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const res = await testPushAction();
      if (res.ok && res.sent) toast.success("Notification d'essai envoyée.");
      else toast.error(res.ok ? "Aucun appareil n'a pu être joint. Désactivez puis réactivez les notifications." : res.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:items-start">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
        {state === "on" ? <BellRing className="size-5" /> : state === "denied" ? <BellOff className="size-5" /> : <Smartphone className="size-5" />}
      </span>
      <div className="min-w-0 flex-1 space-y-3 text-sm">
        {state === "checking" && <p className="text-muted-foreground">Vérification de cet appareil…</p>}
        {state === "on" && (
          <>
            <p>
              <span className="font-medium">Notifications activées sur cet appareil.</span>{" "}
              <span className="text-muted-foreground">Choisissez ci-dessous, dans la colonne « Téléphone », lesquelles vous recevez.</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={test} disabled={busy}>
                Envoyer une notification d&apos;essai
              </Button>
              <Button size="sm" variant="ghost" onClick={disable} disabled={busy}>
                Désactiver sur cet appareil
              </Button>
            </div>
          </>
        )}
        {state === "off" && (
          <>
            <p>
              <span className="font-medium">Recevez vos notifications sur ce téléphone</span>{" "}
              <span className="text-muted-foreground">(colis reçu, expédié, nouveau message…), même quand Packio est fermé.</span>
            </p>
            <Button size="sm" onClick={enable} disabled={busy}>
              <BellRing /> Activer les notifications
            </Button>
          </>
        )}
        {state === "ios-install" && (
          <>
            <p className="font-medium">Sur iPhone, ajoutez d&apos;abord Packio à votre écran d&apos;accueil :</p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                Dans Safari, touchez <Share className="inline size-4 align-text-bottom" /> <span className="text-foreground">Partager</span>.
              </li>
              <li>
                Choisissez <span className="text-foreground">« Sur l&apos;écran d&apos;accueil »</span>, puis <span className="text-foreground">Ajouter</span>.
              </li>
              <li>Ouvrez Packio depuis la nouvelle icône, revenez sur cette page et activez les notifications.</li>
            </ol>
          </>
        )}
        {state === "denied" && (
          <p>
            <span className="font-medium">Les notifications sont bloquées pour Packio sur cet appareil.</span>{" "}
            <span className="text-muted-foreground">
              Autorisez-les dans les réglages du navigateur (ou du téléphone, rubrique Notifications), puis rechargez cette page.
            </span>
          </p>
        )}
        {state === "unsupported" && (
          <p className="text-muted-foreground">Ce navigateur ne permet pas de recevoir des notifications. Utilisez Chrome, Safari (iPhone, iOS 16.4 ou plus récent), Firefox ou Edge.</p>
        )}
      </div>
    </div>
  );
}

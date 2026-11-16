"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Package, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

const VERSION = process.env.APP_VERSION;
const EVERY = 30_000;

type State = "ok" | "updating" | "offline" | "updated";

/**
 * Pendant une mise à jour, le site est indisponible quelques dizaines de
 * secondes : une petite animation l'annonce, puis propose d'actualiser la page
 * dès que la nouvelle version répond.
 */
export function UpdateWatcher() {
  const [state, setState] = useState<State>("ok");
  const failures = useRef(0);

  // Service worker : page « mise à jour en cours » pendant les coupures (et notifications).
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(check, ms);
    };

    async function check() {
      if (stopped || document.hidden) return;
      if (!navigator.onLine) {
        setState("offline");
        return schedule(5_000);
      }
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const { version } = (await res.json()) as { version: string | null };
        failures.current = 0;
        if (version && VERSION && version !== VERSION) {
          setState("updated");
          stopped = true;
          return;
        }
        setState("ok");
        schedule(EVERY);
      } catch {
        // Une coupure isolée (réseau mobile) ne suffit pas : on revérifie avant d'annoncer.
        failures.current += 1;
        if (failures.current >= 2) setState(navigator.onLine ? "updating" : "offline");
        schedule(failures.current >= 2 ? 4_000 : 2_000);
      }
    }

    const wake = () => {
      if (!document.hidden) check();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("offline", wake);
    schedule(EVERY);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", wake);
    };
  }, []);

  if (state === "ok") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex justify-center px-4" role="status" aria-live="polite">
      <div
        key={state}
        className="pointer-events-auto relative flex w-full max-w-sm items-center gap-3 overflow-hidden rounded-2xl border bg-card/95 p-3 pr-4 shadow-lg backdrop-blur animate-update-in"
      >
        {state === "updating" && (
          <>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
              <Package className="size-5 animate-update-hop" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">Packio se met à jour…</p>
              <p className="text-xs text-muted-foreground">Ça revient dans quelques secondes.</p>
            </div>
            <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-brand/10" aria-hidden>
              <span className="block h-full w-2/5 rounded-full bg-brand animate-update-bar" />
            </span>
          </>
        )}
        {state === "offline" && (
          <>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <WifiOff className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">Pas de connexion internet</p>
              <p className="text-xs text-muted-foreground">Packio se reconnectera automatiquement.</p>
            </div>
          </>
        )}
        {state === "updated" && (
          <>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success animate-soft-ping">
              <Check className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Packio est à jour</p>
              <p className="text-xs text-muted-foreground">Actualisez la page pour en profiter.</p>
            </div>
            <Button size="sm" onClick={() => window.location.reload()}>
              <RefreshCw /> Actualiser
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

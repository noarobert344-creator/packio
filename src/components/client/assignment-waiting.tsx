"use client";

import { useEffect, useState } from "react";
import { Clock, Hourglass, Sparkles } from "lucide-react";
import { formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Page d'attente d'attribution avec suivi du délai de 24 h en direct. */
export function AssignmentWaiting({ requestedAt, dueAt, state, serverNow }: { requestedAt: string | null; dueAt: string | null; state: "PENDING" | "LATE" | "REASSIGNING"; serverNow: number }) {
  // L'heure du serveur sert au premier rendu (hydratation identique), puis le compteur suit l'horloge locale.
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  const start = requestedAt ? new Date(requestedAt).getTime() : now;
  const due = dueAt ? new Date(dueAt).getTime() : now;
  const elapsed = (now - start) / 60000;
  const remaining = (due - now) / 60000;
  const late = remaining <= 0;
  const progress = Math.min(100, Math.max(4, ((now - start) / Math.max(1, due - start)) * 100));
  return (
    <section className="relative overflow-hidden rounded-3xl border bg-card p-6 shadow-soft sm:p-8">
      <div className="absolute -top-24 -right-20 size-72 rounded-full bg-brand/15 blur-3xl" aria-hidden />
      <div className="relative space-y-6">
        <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-brand text-brand-foreground glow-brand">
          <Sparkles className="size-5" />
        </span>
        <div className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight">Bienvenue sur Packio !</h2>
          <p className="max-w-2xl text-[0.95rem] leading-relaxed text-muted-foreground">
            « Votre abonnement est actif. Un préparateur de commandes personnel vous sera attribué sous 24 heures. Vous recevrez une notification dès que votre préparateur sera disponible et pourrez ensuite commencer à envoyer vos commandes directement à son point de réception. »
          </p>
        </div>
        <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full transition-all", late ? "bg-warning" : "bg-brand")} style={{ width: `${progress}%` }} />
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-xs text-muted-foreground">Date de souscription</p>
              <p className="font-medium">{formatDateTime(requestedAt)}</p>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3" /> Temps écoulé
              </p>
              <p className="font-medium tabular">{formatDuration(elapsed)}</p>
            </div>
            <div className={cn("rounded-xl p-3", late ? "bg-warning-soft text-warning" : "bg-muted/60")}>
              <p className="flex items-center gap-1 text-xs opacity-80">
                <Hourglass className="size-3" /> Échéance des 24 h
              </p>
              <p className="font-medium tabular">{late ? "Attribution en cours de finalisation" : `dans ${formatDuration(remaining)}`}</p>
            </div>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {state === "REASSIGNING"
            ? "Un nouveau préparateur vous est en cours d'attribution. Vos commandes en route restent prises en charge."
            : late
              ? "L'attribution prend un peu plus de temps que prévu : notre équipe s'en occupe en priorité et vous tient informé."
              : "En attendant, vous pouvez consulter les offres, vos crédits et configurer vos préférences de notification."}
        </p>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";

/** Crédits restants du client, en haut de l'espace client ; mis à jour à chaque page et au retour sur l'onglet. */
export function CreditsBadge({ initial }: { initial: number }) {
  const [credits, setCredits] = useState(initial);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch("/api/me/credits", { cache: "no-store" });
        if (!res.ok) return;
        const { available } = (await res.json()) as { available: number };
        if (!cancelled) setCredits(available);
      } catch {
        // hors ligne : on garde la dernière valeur
      }
    };
    refresh();
    const onFocus = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [pathname]);

  const low = credits <= 2;
  return (
    <Link
      href="/client/credits"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
        low ? "border-warning/40 bg-warning-soft text-warning hover:bg-warning-soft/80" : "bg-brand-soft/60 text-foreground hover:bg-brand-soft",
      )}
      title={low ? "Il vous reste peu de crédits : rechargez votre solde." : "Crédits restants"}
    >
      <Coins className={cn("size-4", low ? "text-warning" : "text-brand")} />
      <span className="tabular">{credits}</span>
      <span className="hidden text-muted-foreground sm:inline">crédit{credits > 1 ? "s" : ""}</span>
      <span className="sr-only sm:hidden">crédit{credits > 1 ? "s" : ""} restants</span>
    </Link>
  );
}

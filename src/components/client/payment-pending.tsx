"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Package } from "lucide-react";

const EVERY = 3000;
const MAX_TRIES = 40; // environ 2 minutes

/**
 * Retour de Whop avant que le paiement soit confirmé (quelques secondes en
 * général) : écran d'attente qui se met à jour seul, pour que le client ne
 * repaie pas en revoyant le choix des offres.
 */
export function PaymentPending() {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= MAX_TRIES) return;
    const timer = setTimeout(() => {
      router.refresh();
      setTries((t) => t + 1);
    }, EVERY);
    return () => clearTimeout(timer);
  }, [router, tries]);
  const late = tries >= MAX_TRIES;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 rounded-3xl border bg-card p-8 text-center shadow-soft" role="status" aria-live="polite">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-brand/15 text-brand">
        <Package className="size-7 animate-update-hop" />
      </span>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">{late ? "La confirmation prend plus de temps que prévu" : "Paiement reçu, activation en cours…"}</h1>
        <p className="text-sm text-muted-foreground">
          {late
            ? "Votre paiement est bien enregistré chez Whop. Ne repayez pas : votre abonnement s'activera dès la confirmation. Si rien ne change d'ici quelques minutes, écrivez-nous."
            : "Whop confirme votre paiement : votre abonnement s'active dans quelques secondes. Ne fermez pas cette page et ne repayez pas."}
        </p>
      </div>
      {late ? (
        <div className="flex flex-wrap justify-center gap-2 text-sm">
          <button type="button" className="rounded-lg border px-3 py-1.5 hover:bg-muted" onClick={() => setTries(0)}>
            Vérifier à nouveau
          </button>
          <Link href="/#contact" className="rounded-lg border px-3 py-1.5 hover:bg-muted">
            Contacter Packio
          </Link>
        </div>
      ) : (
        <span className="relative block h-1 w-40 overflow-hidden rounded-full bg-brand/10" aria-hidden>
          <span className="block h-full w-2/5 rounded-full bg-brand animate-update-bar" />
        </span>
      )}
    </div>
  );
}

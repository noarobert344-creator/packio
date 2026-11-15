"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BillingIntervalToggle } from "@/components/shared/billing-interval-toggle";
import { annualSavings, commonAnnualBadge, hasAnnualOffer, monthlyEquivalentCents, type BillingIntervalValue } from "@/lib/billing-intervals";
import { formatMoney, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PricingPlan = {
  id: string;
  code: string;
  name: string;
  tagline: string | null;
  priceCents: number;
  annualPriceCents: number | null;
  currency: string;
  monthlyCredits: number;
  storageLimit: number | null;
  features: string[];
  highlighted: boolean;
};

/** Cartes d'offres de la page d'accueil, avec bascule Mensuel / Annuel. */
export function PricingPlans({ plans }: { plans: PricingPlan[] }) {
  const anyAnnual = plans.some(hasAnnualOffer);
  const [interval, setInterval] = useState<BillingIntervalValue>("MONTHLY");
  const yearly = interval === "YEARLY";
  return (
    <div className="space-y-8">
      {anyAnnual && (
        <div className="flex justify-center">
          <BillingIntervalToggle value={interval} onChange={setInterval} annualBadge={commonAnnualBadge(plans)} />
        </div>
      )}
      <div className={cn("grid gap-5", plans.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2")}>
        {plans.map((p) => {
          const annual = yearly && hasAnnualOffer(p);
          const savings = annualSavings(p);
          return (
            <div
              key={p.id}
              className={cn(
                "relative flex flex-col rounded-3xl border bg-card p-7 shadow-soft",
                p.highlighted && "border-brand/50 bg-gradient-to-b from-brand-soft/70 to-card glow-brand lg:-my-3 lg:py-10",
              )}
            >
              {p.highlighted && <span className="absolute -top-3 left-7 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-brand-foreground">Recommandé</span>}
              <p className="text-lg font-semibold">{p.name}</p>
              {p.tagline && <p className="mt-1 min-h-10 text-sm text-muted-foreground">{p.tagline}</p>}
              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tracking-tight tabular">{formatPrice(annual ? p.annualPriceCents : p.priceCents, p.currency)}</span>
                <span className="text-sm text-muted-foreground">{annual ? "/ an" : "/ mois"}</span>
              </p>
              <p className="mt-1 min-h-5 text-sm text-muted-foreground">
                {annual && savings ? (
                  <>
                    soit {formatMoney(monthlyEquivalentCents(p, "YEARLY"), p.currency)} / mois ·{" "}
                    <span className="font-medium text-brand">{formatPrice(savings.savedCents, p.currency)} économisés</span>
                  </>
                ) : yearly ? (
                  "Formule annuelle non proposée pour cette offre"
                ) : (
                  " "
                )}
              </p>
              <p className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">{p.monthlyCredits} crédits par mois</p>
              <ul className="mt-7 flex-1 space-y-3">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-sm">
                    <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button asChild size="lg" variant={p.highlighted ? "default" : "outline"} className="mt-8 h-11 w-full text-[0.95rem]">
                <Link href={`/inscription?offre=${p.code}${annual ? "&periodicite=annuel" : ""}`}>
                  Choisir {p.name} <ArrowRight />
                </Link>
              </Button>
            </div>
          );
        })}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {yearly
          ? "Tarifs TTC. Formule annuelle payée en une fois et renouvelée chaque année via Whop ; vos crédits sont versés chaque mois. Les codes promotionnels peuvent être saisis lors du paiement."
          : "Tarifs TTC, renouvelés automatiquement tous les 30 jours via Whop. Les codes promotionnels peuvent être saisis lors du paiement."}
      </p>
    </div>
  );
}

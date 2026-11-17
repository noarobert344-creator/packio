"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { formatMoney, formatPrice } from "@/lib/format";
import {
  annualSavings,
  commonAnnualBadge,
  hasAnnualOffer,
  monthlyEquivalentCents,
  priceFor,
  type BillingIntervalValue,
} from "@/lib/billing-intervals";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { BillingIntervalToggle } from "@/components/shared/billing-interval-toggle";
import type { FormAction } from "@/lib/action-types";

type Plan = {
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

export type CurrentSubscription = {
  planId: string;
  interval: BillingIntervalValue;
  pendingPlanId: string | null;
  pendingInterval: BillingIntervalValue | null;
  /** Changement déjà transmis à Whop : plus annulable. */
  pendingLocked: boolean;
  /** Date d'échéance, déjà mise en forme côté serveur. */
  periodEndLabel: string | null;
};

type Choice = { label: string; hint: string | null; disabled: boolean };

function describeChoice(
  p: Plan,
  interval: BillingIntervalValue,
  plans: Plan[],
  current?: CurrentSubscription,
): Choice {
  const price = priceFor(p, interval);
  if (price === null)
    return {
      label: "Formule annuelle non proposée",
      hint: null,
      disabled: true,
    };
  const yearly = interval === "YEARLY";
  if (!current)
    return {
      label: `Souscrire ${p.name}${yearly ? " en annuel" : ""}`,
      hint: null,
      disabled: false,
    };

  const end = current.periodEndLabel ?? "l'échéance";
  const isCurrent = p.id === current.planId && interval === current.interval;
  const isPending =
    p.id === current.pendingPlanId &&
    (current.pendingInterval ?? current.interval) === interval;
  const hasPending = !!current.pendingPlanId || !!current.pendingInterval;
  if (isPending)
    return {
      label: "Programmé à l'échéance",
      hint: `Prend effet le ${end}.`,
      disabled: true,
    };
  if (isCurrent) {
    if (!hasPending)
      return { label: "Offre actuelle", hint: null, disabled: true };
    return current.pendingLocked
      ? {
          label: "Offre actuelle",
          hint: "Le changement programmé a déjà été transmis pour l'échéance toute proche.",
          disabled: true,
        }
      : {
          label: `Conserver ${p.name}`,
          hint: "Annule le changement programmé.",
          disabled: false,
        };
  }
  if (current.interval === "YEARLY" && interval === "MONTHLY") {
    return {
      label: `Passer à ${p.name} en mensuel à l'échéance`,
      hint: `Votre formule annuelle continue jusqu'au ${end}, puis vous activerez ${p.name} en mensuel.`,
      disabled: false,
    };
  }
  const currentPlan = plans.find((x) => x.id === current.planId);
  const currentPrice = currentPlan
    ? (priceFor(currentPlan, current.interval) ?? currentPlan.priceCents)
    : 0;
  if (current.interval === interval && price < currentPrice) {
    return {
      label: `Passer à ${p.name} au renouvellement`,
      hint: `Nouveau tarif et nouveaux crédits à partir du ${end}.`,
      disabled: false,
    };
  }
  return {
    label:
      yearly && current.interval === "MONTHLY" && p.id === current.planId
        ? "Passer à l'annuel maintenant"
        : `Passer à ${p.name} maintenant`,
    hint:
      `Paiement immédiat de ${formatPrice(price, p.currency)} HT (TVA en plus) et crédits disponibles tout de suite. Votre offre actuelle ne sera plus renouvelée ; ` +
      (current.interval === "YEARLY"
        ? `ses crédits mensuels déjà payés continuent d'être versés jusqu'au ${end}.`
        : "ses crédits restent utilisables."),
    disabled: false,
  };
}

export function PlanPicker({
  plans,
  action,
  current,
  preselect,
  initialInterval,
}: {
  plans: Plan[];
  action: FormAction;
  current?: CurrentSubscription;
  preselect?: string;
  initialInterval?: BillingIntervalValue;
}) {
  const anyAnnual = plans.some(hasAnnualOffer);
  const [interval, setInterval] = useState<BillingIntervalValue>(
    initialInterval ?? current?.interval ?? "MONTHLY",
  );
  const yearly = interval === "YEARLY";
  return (
    <div className="space-y-6">
      {anyAnnual && (
        <BillingIntervalToggle
          value={interval}
          onChange={setInterval}
          annualBadge={commonAnnualBadge(plans)}
        />
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((p) => {
          const choice = describeChoice(p, interval, plans, current);
          const isCurrent =
            !!current &&
            p.id === current.planId &&
            interval === current.interval;
          const focus = preselect ? p.code === preselect : p.highlighted;
          const annual = yearly && hasAnnualOffer(p);
          const savings = annualSavings(p);
          return (
            <div
              key={p.id}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-card p-6 shadow-soft",
                focus && "border-brand ring-1 ring-brand",
                isCurrent && "bg-muted/40",
              )}
            >
              {p.highlighted && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-brand px-2.5 py-0.5 text-xs font-medium text-brand-foreground">
                  Le plus choisi
                </span>
              )}
              <p className="text-lg font-semibold">{p.name}</p>
              {p.tagline && (
                <p className="mt-1 min-h-10 text-sm text-muted-foreground">
                  {p.tagline}
                </p>
              )}
              <p className="mt-5 flex items-baseline gap-1">
                <span className="text-3xl font-semibold tracking-tight tabular">
                  {formatPrice(
                    annual ? p.annualPriceCents : p.priceCents,
                    p.currency,
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {annual ? "HT / an" : "HT / mois"}
                </span>
              </p>
              <p className="mt-1 min-h-5 text-xs text-muted-foreground">
                {annual && savings ? (
                  <>
                    soit{" "}
                    {formatMoney(
                      monthlyEquivalentCents(p, "YEARLY"),
                      p.currency,
                    )}{" "}
                    / mois ·{" "}
                    <span className="font-medium text-brand">
                      {formatPrice(savings.savedCents, p.currency)} économisés
                    </span>
                  </>
                ) : (
                  " "
                )}
              </p>
              <p className="mt-2 text-sm font-medium text-brand">
                {p.monthlyCredits} crédits par mois
              </p>
              <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                    {f}
                  </li>
                ))}
              </ul>
              <ActionForm action={action} silent className="mt-6">
                <input type="hidden" name="planId" value={p.id} />
                <input type="hidden" name="interval" value={interval} />
                <SubmitButton
                  className="h-10 w-full"
                  variant={focus ? "default" : "outline"}
                  disabled={choice.disabled}
                  pendingLabel="Enregistrement…"
                >
                  {choice.label}
                </SubmitButton>
              </ActionForm>
              {choice.hint && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {choice.hint}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

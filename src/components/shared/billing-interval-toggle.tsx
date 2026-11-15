"use client";

import { cn } from "@/lib/utils";
import type { BillingIntervalValue } from "@/lib/billing-intervals";

/** Sélecteur Mensuel / Annuel (avec l'avantage de la formule annuelle). */
export function BillingIntervalToggle({
  value,
  onChange,
  annualBadge,
  className,
}: {
  value: BillingIntervalValue;
  onChange: (value: BillingIntervalValue) => void;
  annualBadge?: string | null;
  className?: string;
}) {
  const options: { value: BillingIntervalValue; label: string }[] = [
    { value: "MONTHLY", label: "Mensuel" },
    { value: "YEARLY", label: "Annuel" },
  ];
  return (
    <div role="radiogroup" aria-label="Périodicité de facturation" className={cn("inline-flex items-center gap-1 rounded-full border bg-muted/60 p-1", className)}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.value === "YEARLY" && annualBadge && (
              <span className={cn("rounded-full px-2 py-0.5 text-[0.7rem] font-semibold", active ? "bg-brand text-brand-foreground" : "bg-brand-soft text-brand")}>{annualBadge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}


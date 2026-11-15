"use client";

import { useState } from "react";
import { Minus, Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton, useFieldError } from "@/components/shared/action-form";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { buyCustomCreditsAction } from "@/server/actions/customer";

function QuantityError() {
  const error = useFieldError("credits");
  return error ? <p className="text-xs text-destructive">{error}</p> : null;
}

/** Achat de crédits supplémentaires en quantité libre, au prix unitaire fixé par Packio. */
export function CustomCreditPurchase({ unitPriceCents, min, max, suggested }: { unitPriceCents: number; min: number; max: number; suggested?: number }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n) || min));
  const [credits, setCredits] = useState(() => clamp(suggested ?? Math.max(min, 10)));
  const presets = [10, 20, 50, 100].filter((p) => p >= min && p <= max);
  const total = credits * unitPriceCents;

  return (
    <ActionForm action={buyCustomCreditsAction} silent className="grid gap-4 rounded-xl border border-brand/30 bg-brand-soft/30 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">Quantité libre</p>
          <p className="text-sm text-muted-foreground">
            {formatMoney(unitPriceCents)} le crédit · de {min} à {max} crédits
          </p>
        </div>
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quantités suggérées">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setCredits(p)}
                className={cn(
                  "h-8 rounded-lg border px-3 text-sm tabular transition-colors",
                  credits === p ? "border-brand bg-brand text-brand-foreground" : "bg-background hover:border-foreground/20",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-1.5">
          <label htmlFor="custom-credits" className="text-[0.8rem] font-medium">
            Nombre de crédits
          </label>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon-lg" onClick={() => setCredits((c) => clamp(c - 1))} disabled={credits <= min} aria-label="Retirer un crédit">
              <Minus />
            </Button>
            <input
              id="custom-credits"
              name="credits"
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              step={1}
              value={credits}
              onChange={(e) => setCredits(Number(e.target.value))}
              onBlur={() => setCredits((c) => clamp(c))}
              className="h-10 w-24 rounded-lg border border-input bg-background text-center text-lg font-semibold tabular outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Button type="button" variant="outline" size="icon-lg" onClick={() => setCredits((c) => clamp(c + 1))} disabled={credits >= max} aria-label="Ajouter un crédit">
              <Plus />
            </Button>
          </div>
          <QuantityError />
        </div>
        <div className="flex items-center gap-4 sm:justify-end">
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total TTC</p>
            <p className="text-2xl font-semibold tabular" aria-live="polite">
              {formatMoney(Number.isFinite(total) ? total : 0)}
            </p>
          </div>
          <SubmitButton size="lg" className="h-10" pendingLabel="Redirection…" disabled={!Number.isInteger(credits) || credits < min || credits > max}>
            <ShoppingCart /> Acheter {Number.isInteger(credits) ? credits : ""} crédits
          </SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

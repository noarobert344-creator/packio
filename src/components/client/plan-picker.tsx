import { Check } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import type { FormAction } from "@/lib/action-types";

type Plan = { id: string; code: string; name: string; tagline: string | null; priceCents: number; monthlyCredits: number; storageLimit: number | null; features: string[]; highlighted: boolean };

export function PlanPicker({ plans, action, currentPlanId, preselect, ctaLabel }: { plans: Plan[]; action: FormAction; currentPlanId?: string; preselect?: string; ctaLabel: (p: Plan) => string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {plans.map((p) => {
        const current = p.id === currentPlanId;
        const focus = preselect ? p.code === preselect : p.highlighted;
        return (
          <div key={p.id} className={cn("relative flex flex-col rounded-2xl border bg-card p-6 shadow-soft", focus && "border-brand ring-1 ring-brand", current && "bg-muted/40")}>
            {p.highlighted && <span className="absolute -top-2.5 left-6 rounded-full bg-brand px-2.5 py-0.5 text-xs font-medium text-brand-foreground">Le plus choisi</span>}
            <p className="text-lg font-semibold">{p.name}</p>
            {p.tagline && <p className="mt-1 text-sm text-muted-foreground">{p.tagline}</p>}
            <p className="mt-5 flex items-baseline gap-1">
              <span className="text-3xl font-semibold tracking-tight tabular">{formatMoney(p.priceCents)}</span>
              <span className="text-sm text-muted-foreground">/ mois</span>
            </p>
            <p className="mt-1 text-sm font-medium text-brand">{p.monthlyCredits} crédits par mois</p>
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
              <SubmitButton className="h-10 w-full" variant={focus ? "default" : "outline"} disabled={current} pendingLabel="Redirection…">
                {current ? "Offre actuelle" : ctaLabel(p)}
              </SubmitButton>
            </ActionForm>
          </div>
        );
      })}
    </div>
  );
}

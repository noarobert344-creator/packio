import { randomUUID } from "node:crypto";
import { CalendarClock, Info, PackagePlus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { SelectField } from "@/components/shared/form-field";
import { buyStorageSlotsAction } from "@/server/actions/customer";
import type { getStorageOverview } from "@/server/services/storage";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Overview = Awaited<ReturnType<typeof getStorageOverview>>;

/** Places de stock (incluses, achetées, occupées) et achat de places supplémentaires. */
export function StoragePanel({ overview, planName }: { overview: Overview; planName: string | null }) {
  const { rules, capacity, included, extra, used, incoming, purchases } = overview;
  const ratio = capacity ? (used + incoming) / capacity : 0;
  const over = capacity !== null && used + incoming > capacity;
  return (
    <div className="grid gap-4 rounded-2xl border bg-card p-4 shadow-soft sm:p-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">Places de stock</p>
          <p className="text-sm tabular">
            {capacity === null ? (
              <span className="text-muted-foreground">Illimité</span>
            ) : (
              <>
                <span className="font-semibold">{used}</span> occupée{used > 1 ? "s" : ""}
                {incoming > 0 && <span className="text-muted-foreground"> + {incoming} en commande</span>} / {capacity} places
              </>
            )}
          </p>
        </div>
        {capacity !== null && (
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full", over ? "bg-danger" : ratio > 0.85 ? "bg-warning" : "bg-brand")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {included !== null ? `${included} places incluses dans votre offre${planName ? ` ${planName}` : ""}` : "Places illimitées"}
          {extra > 0 ? ` + ${extra} places achetées` : ""}. Une place = un article en stock chez votre préparateur.
        </p>
        {purchases.length > 0 && (
          <ul className="space-y-1 text-xs">
            {purchases.map((p) => (
              <li key={p.id} className="flex items-center gap-1.5 text-muted-foreground">
                <CalendarClock className="size-3.5" /> +{p.slots} places jusqu&apos;au {formatDate(p.expiresAt, "d MMMM")}
              </li>
            ))}
          </ul>
        )}
        <p className="flex gap-2 rounded-xl bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0 text-brand" />
          <span>
            Chaque article peut rester {rules.includedDays} jours en stock. Au-delà, {rules.extensionCredits} crédit par article est prélevé automatiquement pour {rules.extensionDays} jours
            de plus (rappel {rules.reminderDaysBefore} jours avant). Si une commande dépasse vos places, les crédits nécessaires vous sont indiqués avant validation.
          </span>
        </p>
      </div>
      {capacity !== null && (
        <ActionForm action={buyStorageSlotsAction} className="flex flex-col justify-between gap-3 rounded-xl border p-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <PackagePlus className="size-4 text-brand" /> Ajouter des places
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              1 crédit = {rules.slotsPerCredit} place{rules.slotsPerCredit > 1 ? "s" : ""} pendant {rules.extraSlotsDays} jours, prélevé sur votre solde.
            </p>
          </div>
          <input type="hidden" name="requestId" value={randomUUID()} />
          <SelectField
            name="credits"
            label="Places à ajouter"
            defaultValue="1"
            options={[1, 2, 3, 4, 5, 10].map((n) => ({ value: String(n), label: `${n * rules.slotsPerCredit} place${n * rules.slotsPerCredit > 1 ? "s" : ""} — ${n} crédit${n > 1 ? "s" : ""}` }))}
          />
          <SubmitButton variant="outline" pendingLabel="Ajout…">
            Ajouter les places
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}

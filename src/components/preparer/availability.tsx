"use client";

import { useState } from "react";
import { CalendarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmitButton, useFieldError } from "@/components/shared/action-form";
import { TextField } from "@/components/shared/form-field";
import { cn } from "@/lib/utils";
import { declareAbsenceAction, updateAvailabilityAction } from "@/server/actions/preparer";
import { StepForm, StepDialog } from "./step-form";

const DAYS = [
  { key: "mon", label: "Lundi" },
  { key: "tue", label: "Mardi" },
  { key: "wed", label: "Mercredi" },
  { key: "thu", label: "Jeudi" },
  { key: "fri", label: "Vendredi" },
  { key: "sat", label: "Samedi" },
  { key: "sun", label: "Dimanche" },
] as const;

type Day = { open: boolean; from: string; to: string };
export type Availability = Record<(typeof DAYS)[number]["key"], Day>;

function DayRow({ day, label, value }: { day: string; label: string; value: Day }) {
  const [open, setOpen] = useState(value.open);
  const error = useFieldError(`from:${day}`);
  return (
    <li className="grid grid-cols-1 items-center gap-x-3 gap-y-2 py-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
      <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium">
        <input type="checkbox" name={`open:${day}`} checked={open} onChange={(e) => setOpen(e.target.checked)} className="size-4 accent-[var(--brand)]" />
        {label}
      </label>
      <div className={cn("flex min-w-0 items-center gap-2", !open && "opacity-50")} aria-label={open ? undefined : `${label} : indisponible`}>
        <input
          type="time"
          name={`from:${day}`}
          defaultValue={value.from}
          disabled={!open}
          aria-label={`${label} — ouverture`}
          className="h-10 w-full max-w-[8.5rem] min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
        <span className="text-sm text-muted-foreground">à</span>
        <input
          type="time"
          name={`to:${day}`}
          defaultValue={value.to}
          disabled={!open}
          aria-label={`${label} — fermeture`}
          className="h-10 w-full max-w-[8.5rem] min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </div>
      {error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}
    </li>
  );
}

export function AvailabilityForm({ availability, note }: { availability: Availability; note: string | null }) {
  return (
    <StepForm action={updateAvailabilityAction} className="grid gap-4">
      <ul className="divide-y">
        {DAYS.map((d) => (
          <DayRow key={d.key} day={d.key} label={d.label} value={availability[d.key]} />
        ))}
      </ul>
      <TextField name="note" label="Précision pour l'équipe Packio" defaultValue={note ?? ""} placeholder="Ex. : dépôts transporteurs chaque jour à 17 h" />
      <div>
        <SubmitButton pendingLabel="Enregistrement…">Enregistrer mes disponibilités</SubmitButton>
      </div>
    </StepForm>
  );
}

export function AbsenceDialog() {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <StepDialog
      trigger={
        <Button>
          <CalendarOff /> Déclarer une absence
        </Button>
      }
      title="Déclarer une absence"
      description="L'équipe Packio et vos clients attribués sont prévenus. Les colis arrivant pendant votre absence seront traités à votre retour."
      action={declareAbsenceAction}
      submitLabel="Déclarer l'absence"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField name="startsAt" label="Du" type="date" required min={today} defaultValue={today} />
        <TextField name="endsAt" label="Au (inclus)" type="date" required min={today} />
      </div>
      <TextField name="reason" label="Motif" placeholder="Facultatif — ex. : congés" />
    </StepDialog>
  );
}

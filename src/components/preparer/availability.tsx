"use client";

import { useState } from "react";
import { CalendarOff, MapPinPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmitButton, useFieldError } from "@/components/shared/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/shared/form-field";
import { LOCATION_TYPE, PICKUP_NETWORKS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { declareAbsenceAction, proposeLocationAction, updateAvailabilityAction } from "@/server/actions/preparer";
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

export function ProposeLocationDialog({ defaultRecipient, defaultCity }: { defaultRecipient: string; defaultCity: string }) {
  const [type, setType] = useState<"BUSINESS_ADDRESS" | "LOCKER" | "RELAY_POINT">("LOCKER");
  const relay = type !== "BUSINESS_ADDRESS";
  return (
    <StepDialog
      trigger={
        <Button variant="outline">
          <MapPinPlus /> Proposer un point de réception
        </Button>
      }
      title="Proposer un point de réception"
      description="Le point sera communiqué à vos clients uniquement après vérification et validation par l'équipe Packio."
      action={proposeLocationAction}
      submitLabel="Envoyer pour validation"
      wide
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          name="type"
          label="Type"
          required
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          options={(Object.keys(LOCATION_TYPE) as (keyof typeof LOCATION_TYPE)[]).map((k) => ({ value: k, label: LOCATION_TYPE[k] }))}
        />
        <TextField name="label" label="Libellé" required placeholder="Ex. : Locker secondaire" />
        {relay && (
          <>
            <SelectField name="network" label="Réseau" required placeholder="Choisir…" options={PICKUP_NETWORKS.map((n) => ({ value: n.code, label: n.label }))} />
            <TextField name="relayName" label="Nom exact du point relais / locker" required />
            <TextField name="externalId" label="Identifiant du point (si connu)" />
            <TextField name="openingHours" label="Horaires" placeholder="Ex. : 24 h/24" />
          </>
        )}
        <TextField name="addressLine1" label="Adresse" required className="sm:col-span-2" />
        <TextField name="addressLine2" label="Complément d'adresse" className="sm:col-span-2" />
        <TextField name="postalCode" label="Code postal" required />
        <TextField name="city" label="Ville" required defaultValue={defaultCity} />
        <TextField name="country" label="Pays (code ISO)" required defaultValue="FR" maxLength={2} />
        <TextField name="recipientName" label="Nom du destinataire à indiquer" required defaultValue={defaultRecipient} />
      </div>
      <TextAreaField name="instructions" label="Instructions pour les clients" rows={2} placeholder="Facultatif" />
    </StepDialog>
  );
}

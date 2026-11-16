"use client";

import { Lock, MapPin, Phone } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { TextField } from "@/components/shared/form-field";
import { completeOnboardingAction } from "@/server/actions/preparer";

const LOCKERS = [
  { code: "MONDIAL_RELAY", label: "Locker Mondial Relay", name: "Nom du locker", example: "Ex. : Locker Mondial Relay Gare Part-Dieu" },
  { code: "VINTED_GO", label: "Locker Vinted Go", name: "Nom du locker", example: "Ex. : Vinted Go Lyon Brotteaux" },
  { code: "CHRONOPOST_PICKUP", label: "Locker Chronopost", name: "Nom du locker", example: "Ex. : Pickup Station Lyon 6e" },
  { code: "LA_POSTE", label: "Bureau de poste (poste restante)", name: "Nom du bureau de poste", example: "Ex. : Bureau de poste Lyon Bellecour" },
] as const;

/** Questionnaire de bienvenue : coordonnées visibles par les clients (après validation). */
export function OnboardingForm({ defaultPhone }: { defaultPhone: string | null }) {
  return (
    <ActionForm action={completeOnboardingAction} className="grid gap-8">
      <fieldset className="grid gap-4">
        <legend className="mb-1 flex items-center gap-2 text-base font-semibold">
          <Phone className="size-4 text-brand" /> Votre téléphone
        </legend>
        <p className="-mt-2 text-sm text-muted-foreground">Indiqué sur les commandes de vos clients (Vinted l&apos;exige : le code de retrait arrive par SMS).</p>
        <TextField name="phone" label="Numéro de téléphone" type="tel" autoComplete="tel" required defaultValue={defaultPhone ?? ""} className="sm:max-w-xs" />
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-1 flex items-center gap-2 text-base font-semibold">
          <Lock className="size-4 text-brand" /> Votre adresse (privée)
        </legend>
        <p className="-mt-2 text-sm text-muted-foreground">
          Connue seulement de l&apos;équipe Packio : elle n&apos;est jamais montrée à vos clients et aucun colis n&apos;y est livré.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="addressLine1" label="Adresse" required autoComplete="address-line1" className="sm:col-span-2" />
          <TextField name="addressLine2" label="Complément" placeholder="Bâtiment, étage, digicode…" autoComplete="address-line2" className="sm:col-span-2" />
          <TextField name="postalCode" label="Code postal" required autoComplete="postal-code" />
          <TextField name="city" label="Ville" required autoComplete="address-level2" />
        </div>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-1 flex items-center gap-2 text-base font-semibold">
          <MapPin className="size-4 text-brand" /> Vos points de réception (au moins un)
        </legend>
        <p className="-mt-2 text-sm text-muted-foreground">
          Vos clients font livrer leurs achats dans ces lockers ou en poste restante au bureau de poste, jamais chez vous. Le bureau de poste sert notamment pour
          ZenMarket : le colis vous attend au guichet et vous le retirez avec votre pièce d&apos;identité. Laissez vides ceux que vous n&apos;utilisez pas.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {LOCKERS.map((l) => (
            <div key={l.code} className="grid content-start gap-3 rounded-xl border p-4">
              <p className="text-sm font-medium">{l.label}</p>
              <TextField name={`${l.code}_relayName`} label={l.name} placeholder={l.example} />
              <TextField name={`${l.code}_addressLine1`} label="Adresse" />
              <div className="grid grid-cols-[6rem_1fr] gap-3">
                <TextField name={`${l.code}_postalCode`} label="Code postal" />
                <TextField name={`${l.code}_city`} label="Ville" />
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SubmitButton className="h-10 px-5" pendingLabel="Envoi…">
          Enregistrer ma fiche
        </SubmitButton>
        <p className="text-xs text-muted-foreground">Vos points de réception sont vérifiés par l&apos;équipe Packio avant d&apos;être proposés à vos clients.</p>
      </div>
    </ActionForm>
  );
}

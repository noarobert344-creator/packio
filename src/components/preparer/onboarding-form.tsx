"use client";

import { Home, MapPin, Phone } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { TextField } from "@/components/shared/form-field";
import { completeOnboardingAction } from "@/server/actions/preparer";

const LOCKERS = [
  {
    code: "MONDIAL_RELAY",
    label: "Locker Mondial Relay",
    name: "Nom du locker",
    example: "Ex. : Locker Mondial Relay Gare Part-Dieu",
  },
  {
    code: "VINTED_GO",
    label: "Locker Vinted Go",
    name: "Nom du locker",
    example: "Ex. : Vinted Go Lyon Brotteaux",
  },
  {
    code: "CHRONOPOST_PICKUP",
    label: "Locker Chronopost",
    name: "Nom du locker",
    example: "Ex. : Pickup Station Lyon 6e",
  },
  {
    code: "LA_POSTE",
    label: "Bureau de poste (poste restante)",
    name: "Nom du bureau de poste",
    example: "Ex. : Bureau de poste Lyon Bellecour",
  },
] as const;

/** Questionnaire de bienvenue : coordonnées visibles par les clients (après validation). */
export function OnboardingForm({
  defaultPhone,
}: {
  defaultPhone: string | null;
}) {
  return (
    <ActionForm action={completeOnboardingAction} className="grid gap-8">
      <fieldset className="grid gap-4">
        <legend className="mb-1 flex items-center gap-2 text-base font-semibold">
          <Phone className="size-4 text-brand" /> Votre téléphone
        </legend>
        <p className="-mt-2 text-sm text-muted-foreground">
          Indiqué sur les commandes de vos clients (Vinted l&apos;exige : le
          code de retrait arrive par SMS).
        </p>
        <TextField
          name="phone"
          label="Numéro de téléphone"
          type="tel"
          autoComplete="tel"
          required
          defaultValue={defaultPhone ?? ""}
          className="sm:max-w-xs"
        />
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-1 flex items-center gap-2 text-base font-semibold">
          <MapPin className="size-4 text-brand" /> Vos points de réception (au
          moins un)
        </legend>
        <p className="-mt-2 text-sm text-muted-foreground">
          Vos clients font livrer leurs achats dans ces lockers ou en poste
          restante au bureau de poste. Pour les fournisseurs qui ne livrent pas
          en point relais (Japon, fournisseurs privés…), vous pouvez aussi
          indiquer votre adresse ci-dessous. Laissez vides ceux que vous
          n&apos;utilisez pas.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {LOCKERS.map((l) => (
            <div
              key={l.code}
              className="grid content-start gap-3 rounded-xl border p-4"
            >
              <p className="text-sm font-medium">{l.label}</p>
              <TextField
                name={`${l.code}_relayName`}
                label={l.name}
                placeholder={l.example}
              />
              <TextField name={`${l.code}_addressLine1`} label="Adresse" />
              <div className="grid grid-cols-[6rem_1fr] gap-3">
                <TextField name={`${l.code}_postalCode`} label="Code postal" />
                <TextField name={`${l.code}_city`} label="Ville" />
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-1 flex items-center gap-2 text-base font-semibold">
          <Home className="size-4 text-brand" /> Votre adresse (facultatif)
        </legend>
        <p className="-mt-2 text-sm text-muted-foreground">
          Proposée à vos clients quand le fournisseur ne livre pas en point
          relais ni en locker. Ils ont tous donné leur nom, leur téléphone et
          leur adresse en s&apos;abonnant.
        </p>
        <div className="grid gap-3 rounded-xl border p-4 md:grid-cols-2">
          <TextField
            name="home_addressLine1"
            label="Adresse"
            className="md:col-span-2"
            autoComplete="address-line1"
          />
          <TextField
            name="home_addressLine2"
            label="Complément d'adresse"
            className="md:col-span-2"
            autoComplete="address-line2"
          />
          <TextField
            name="home_postalCode"
            label="Code postal"
            autoComplete="postal-code"
          />
          <TextField
            name="home_city"
            label="Ville"
            autoComplete="address-level2"
          />
        </div>
      </fieldset>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SubmitButton className="h-10 px-5" pendingLabel="Envoi…">
          Enregistrer ma fiche
        </SubmitButton>
        <p className="text-xs text-muted-foreground">
          Vos points de réception sont vérifiés par l&apos;équipe Packio avant
          d&apos;être proposés à vos clients.
        </p>
      </div>
    </ActionForm>
  );
}

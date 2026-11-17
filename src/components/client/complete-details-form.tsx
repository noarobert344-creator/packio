"use client";

import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { SelectField, TextField } from "@/components/shared/form-field";
import { completeDetailsAction } from "@/server/actions/customer";
import type { CustomerDetailsDefaults } from "@/server/services/customers";

export const COUNTRY_OPTIONS = [
  { value: "FR", label: "France" },
  { value: "BE", label: "Belgique" },
  { value: "LU", label: "Luxembourg" },
  { value: "CH", label: "Suisse" },
  { value: "DE", label: "Allemagne" },
  { value: "ES", label: "Espagne" },
  { value: "IT", label: "Italie" },
  { value: "NL", label: "Pays-Bas" },
  { value: "PT", label: "Portugal" },
];

/** Formulaire imposé après le paiement : nom, téléphone, adresse. */
export function CompleteDetailsForm({
  defaults,
}: {
  defaults: CustomerDetailsDefaults;
}) {
  return (
    <ActionForm action={completeDetailsAction} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="firstName"
          label="Prénom"
          autoComplete="given-name"
          required
          defaultValue={defaults.firstName}
        />
        <TextField
          name="lastName"
          label="Nom"
          autoComplete="family-name"
          required
          defaultValue={defaults.lastName}
        />
      </div>
      <TextField
        name="phone"
        label="Téléphone"
        type="tel"
        autoComplete="tel"
        required
        placeholder="06 12 34 56 78"
        defaultValue={defaults.phone}
      />
      <TextField
        name="addressLine1"
        label="Adresse"
        autoComplete="address-line1"
        required
        placeholder="Numéro et rue"
        defaultValue={defaults.addressLine1}
      />
      <TextField
        name="addressLine2"
        label="Complément d'adresse"
        autoComplete="address-line2"
        placeholder="Facultatif"
        defaultValue={defaults.addressLine2}
      />
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr_9rem]">
        <TextField
          name="postalCode"
          label="Code postal"
          autoComplete="postal-code"
          required
          defaultValue={defaults.postalCode}
        />
        <TextField
          name="city"
          label="Ville"
          autoComplete="address-level2"
          required
          defaultValue={defaults.city}
        />
        <SelectField
          name="country"
          label="Pays"
          required
          defaultValue={defaults.country || "FR"}
          options={COUNTRY_OPTIONS}
        />
      </div>
      <SubmitButton
        size="lg"
        className="h-10 w-full"
        pendingLabel="Enregistrement…"
      >
        Valider et accéder à mon espace
      </SubmitButton>
    </ActionForm>
  );
}

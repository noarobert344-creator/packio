"use client";

import { useState } from "react";
import { MapPinPlus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionDialog } from "@/components/shared/action-dialog";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/shared/form-field";
import { LOCATION_TYPE, PICKUP_NETWORKS } from "@/lib/labels";
import { saveLocationAction } from "@/server/actions/admin/people";

export type LocationValues = {
  id: string;
  type: "BUSINESS_ADDRESS" | "LOCKER" | "RELAY_POINT";
  label: string;
  network: string | null;
  relayName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  country: string;
  externalId: string | null;
  recipientName: string;
  openingHours: string | null;
  instructions: string | null;
  isPrimary: boolean;
  validated: boolean;
};

export function LocationDialog({ preparerId, location, defaultRecipient }: { preparerId: string; location?: LocationValues; defaultRecipient: string }) {
  const [type, setType] = useState<LocationValues["type"]>(location?.type ?? "LOCKER");
  const isRelay = type !== "BUSINESS_ADDRESS";
  return (
    <ActionDialog
      wide
      trigger={
        location ? (
          <Button variant="ghost" size="xs">
            <Pencil /> Modifier
          </Button>
        ) : (
          <Button size="sm">
            <MapPinPlus /> Ajouter un lieu
          </Button>
        )
      }
      title={location ? "Modifier le lieu de réception" : "Nouveau lieu de réception"}
      description="Seuls les lieux validés sont communiqués aux clients. Toute modification retire la validation, sauf si vous la confirmez ci-dessous."
      action={saveLocationAction}
      submitLabel="Enregistrer le lieu"
    >
      <input type="hidden" name="preparerId" value={preparerId} />
      {location && <input type="hidden" name="locationId" value={location.id} />}
      <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            name="type"
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as LocationValues["type"])}
            options={Object.entries(LOCATION_TYPE).map(([value, label]) => ({ value, label }))}
          />
          <TextField name="label" label="Libellé interne" required defaultValue={location?.label ?? (isRelay ? "Locker principal" : "Adresse professionnelle")} />
        </div>
        {isRelay && (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField name="network" label="Réseau" required defaultValue={location?.network ?? "MONDIAL_RELAY"} options={PICKUP_NETWORKS.map((n) => ({ value: n.code, label: n.label }))} />
            <TextField name="externalId" label="Identifiant du point relais" defaultValue={location?.externalId ?? ""} placeholder="Si disponible" />
            <TextField name="relayName" label="Nom exact du point relais / locker" required defaultValue={location?.relayName ?? ""} className="sm:col-span-2" />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="addressLine1" label="Adresse" required defaultValue={location?.addressLine1} className="sm:col-span-2" />
          <TextField name="addressLine2" label="Complément" defaultValue={location?.addressLine2 ?? ""} className="sm:col-span-2" />
          <TextField name="postalCode" label="Code postal" required defaultValue={location?.postalCode} />
          <TextField name="city" label="Ville" required defaultValue={location?.city} />
          <TextField name="country" label="Pays (code ISO)" required defaultValue={location?.country ?? "FR"} maxLength={2} />
          <TextField name="recipientName" label="Nom du destinataire à indiquer" required defaultValue={location?.recipientName ?? defaultRecipient} />
        </div>
        <TextField name="openingHours" label="Horaires" defaultValue={location?.openingHours ?? ""} placeholder="Ex. : 24 h/24, 7 j/7" />
        <TextAreaField name="instructions" label="Instructions pour le client" defaultValue={location?.instructions ?? ""} rows={2} />
        <CheckboxField name="isPrimary" label="Lieu principal (affiché en premier au client)" defaultChecked={location?.isPrimary ?? !location} />
        <CheckboxField name="validate" label="Je confirme que ce lieu est réellement utilisable : le valider immédiatement" defaultChecked={location?.validated ?? false} />
      </div>
    </ActionDialog>
  );
}

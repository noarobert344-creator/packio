"use client";

import { useState } from "react";
import { MapPinPlus, Pencil, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/shared/form-field";
import { LOCATION_TYPE, PICKUP_NETWORKS } from "@/lib/labels";
import { proposeLocationAction, removeLocationAction, setPrimaryLocationAction } from "@/server/actions/preparer";
import { StepButton, StepDialog } from "./step-form";

type PointType = "LOCKER" | "RELAY_POINT" | "POST_OFFICE" | "BUSINESS_ADDRESS";

export type PreparerLocationValues = {
  id: string;
  type: PointType;
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
  recipientPhone: string | null;
  openingHours: string | null;
  instructions: string | null;
  validated: boolean;
};

/**
 * Ajout ou modification d'un point de réception par le préparateur : lockers,
 * points relais, poste restante, et son adresse pour les fournisseurs qui ne
 * livrent pas en point relais.
 */
export function LocationDialog({
  location,
  defaultRecipient,
  defaultCity,
  defaultPhone,
}: {
  location?: PreparerLocationValues;
  defaultRecipient: string;
  defaultCity: string;
  defaultPhone?: string | null;
}) {
  const [type, setType] = useState<PointType>(location?.type ?? "LOCKER");
  const relay = type === "LOCKER" || type === "RELAY_POINT";
  return (
    <StepDialog
      trigger={
        location ? (
          <Button variant="outline" size="sm">
            <Pencil /> Modifier
          </Button>
        ) : (
          <Button variant="outline">
            <MapPinPlus /> Ajouter un point
          </Button>
        )
      }
      title={location ? "Modifier le point de réception" : "Ajouter un point de réception"}
      description={
        location?.validated
          ? "Le nom, le téléphone, le libellé et les horaires se modifient tout de suite. Si vous changez l'endroit (réseau, nom du point, adresse) ou les instructions, l'équipe Packio le vérifie à nouveau avant de le proposer à vos clients."
          : "Le point sera communiqué à vos clients uniquement après vérification et validation par l'équipe Packio."
      }
      action={proposeLocationAction}
      submitLabel={location ? "Enregistrer" : "Envoyer pour validation"}
      wide
    >
      {location && <input type="hidden" name="locationId" value={location.id} />}
      <div className="grid max-h-[60vh] grid-cols-1 gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
        <SelectField
          name="type"
          label="Type"
          required
          value={type}
          onChange={(e) => setType(e.target.value as PointType)}
          options={(["LOCKER", "RELAY_POINT", "POST_OFFICE", "BUSINESS_ADDRESS"] as const).map((k) => ({ value: k, label: LOCATION_TYPE[k] }))}
        />
        <TextField name="label" label="Libellé" required defaultValue={location?.label ?? ""} placeholder="Ex. : Locker secondaire" />
        {type === "BUSINESS_ADDRESS" && (
          <p className="rounded-xl bg-info-soft p-3 text-xs text-info sm:col-span-2">
            Votre adresse est proposée à vos clients quand le fournisseur ne livre pas en point relais ni en locker (Japon, fournisseurs privés…). Les points relais et lockers restent proposés en premier. Les
            clients qui la voient ont donné leur téléphone et leur adresse à l&apos;inscription.
          </p>
        )}
        {type === "POST_OFFICE" && (
          <>
            <p className="rounded-xl bg-info-soft p-3 text-xs text-info sm:col-span-2">
              Poste restante : le colis vous attend au bureau de poste et vous le retirez avec votre pièce d&apos;identité. Le nom du destinataire doit être celui de
              votre pièce d&apos;identité.
            </p>
            <input type="hidden" name="network" value="LA_POSTE" />
            <TextField
              name="relayName"
              label="Nom du bureau de poste"
              required
              defaultValue={location?.relayName ?? ""}
              placeholder="Ex. : Bureau de poste Lyon Bellecour"
              className="sm:col-span-2"
            />
          </>
        )}
        {relay && (
          <>
            <SelectField
              name="network"
              label="Réseau"
              required
              placeholder="Choisir…"
              defaultValue={location?.network && location.network !== "LA_POSTE" ? location.network : undefined}
              options={PICKUP_NETWORKS.map((n) => ({ value: n.code, label: n.label }))}
            />
            <TextField name="relayName" label="Nom exact du point relais / locker" required defaultValue={location?.relayName ?? ""} />
            <TextField name="externalId" label="Identifiant du point (si connu)" defaultValue={location?.externalId ?? ""} />
            <TextField name="openingHours" label="Horaires" defaultValue={location?.openingHours ?? ""} placeholder="Ex. : 24 h/24" />
          </>
        )}
        <TextField name="addressLine1" label={type === "BUSINESS_ADDRESS" ? "Votre adresse" : "Adresse du point"} required defaultValue={location?.addressLine1 ?? ""} className="sm:col-span-2" />
        <TextField name="addressLine2" label="Complément d'adresse" defaultValue={location?.addressLine2 ?? ""} className="sm:col-span-2" />
        <TextField name="postalCode" label="Code postal" required defaultValue={location?.postalCode ?? ""} />
        <TextField name="city" label="Ville" required defaultValue={location?.city ?? defaultCity} />
        <TextField name="country" label="Pays (code ISO)" required defaultValue={location?.country ?? "FR"} maxLength={2} />
        <TextField name="recipientName" label="Nom du destinataire à indiquer" required defaultValue={location?.recipientName ?? defaultRecipient} />
        <TextField
          name="recipientPhone"
          label="Téléphone à indiquer"
          type="tel"
          defaultValue={location?.recipientPhone ?? defaultPhone ?? ""}
          hint="Vinted l'exige : vous recevez le code de retrait par SMS."
        />
      </div>
      <TextAreaField name="instructions" label="Instructions pour les clients" rows={2} defaultValue={location?.instructions ?? ""} placeholder="Facultatif" />
    </StepDialog>
  );
}

export function SetPrimaryButton({ locationId }: { locationId: string }) {
  return (
    <StepButton action={setPrimaryLocationAction} fields={{ locationId }} variant="ghost" size="sm">
      <Star /> Mettre en principal
    </StepButton>
  );
}

export function RemoveLocationButton({ locationId, label }: { locationId: string; label: string }) {
  return (
    <StepDialog
      trigger={
        <Button variant="ghost" size="sm" className="text-destructive">
          <Trash2 /> Retirer
        </Button>
      }
      title="Retirer ce point de réception ?"
      description={`« ${label} » ne sera plus proposé à vos clients. Les colis déjà commandés vers ce point y arriveront quand même : pensez à les récupérer.`}
      action={removeLocationAction}
      submitLabel="Retirer le point"
      destructive
    >
      <input type="hidden" name="locationId" value={locationId} />
    </StepDialog>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, PackageCheck, Pencil, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionDialog } from "@/components/shared/action-dialog";
import { ActionForm, SubmitButton, useFieldError } from "@/components/shared/action-form";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/shared/form-field";
import { CopyButton } from "@/components/shared/copy-button";
import { CARRIERS } from "@/lib/labels";
import {
  createPreparerAction,
  resendInvitationAction,
  setParcelsProcessedAction,
  setPreparerStatusAction,
  updatePreparerAction,
  messagePreparerAction,
} from "@/server/actions/admin/people";

export type PreparerValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  city: string;
  country: string;
  businessAddressLine1: string | null;
  businessAddressLine2: string | null;
  businessPostalCode: string | null;
  businessCity: string | null;
  businessCountry: string | null;
  compatibleCarriers: string[];
  storageCapacity: number;
  maxClients: number;
  availabilityNote: string | null;
  adminNotes: string | null;
};

function CarrierCheckboxes({ selected }: { selected: string[] }) {
  const error = useFieldError("compatibleCarriers");
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-[0.8rem] font-medium">Transporteurs compatibles</legend>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {CARRIERS.filter((c) => c.code !== "OTHER").map((c) => (
          <label key={c.code} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="compatibleCarriers[]" value={c.code} defaultChecked={selected.includes(c.code)} className="size-4 accent-[var(--brand)]" />
            {c.label}
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </fieldset>
  );
}

function PreparerFields({ v }: { v?: PreparerValues }) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="firstName" label="Prénom" required defaultValue={v?.firstName} />
        <TextField name="lastName" label="Nom" required defaultValue={v?.lastName} />
        <TextField name="email" label="Adresse e-mail" type="email" required defaultValue={v?.email} />
        <TextField name="phone" label="Téléphone" type="tel" defaultValue={v?.phone ?? ""} />
        <TextField name="city" label="Ville" required defaultValue={v?.city} />
        <TextField name="country" label="Pays (code ISO)" required defaultValue={v?.country ?? "FR"} maxLength={2} />
      </div>
      <div className="grid gap-4 rounded-xl border border-dashed p-4">
        <p className="text-sm font-medium">
          Adresse professionnelle de réception <span className="text-xs font-normal text-muted-foreground">— confidentielle</span>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="businessAddressLine1" label="Adresse" defaultValue={v?.businessAddressLine1 ?? ""} className="sm:col-span-2" />
          <TextField name="businessAddressLine2" label="Complément" defaultValue={v?.businessAddressLine2 ?? ""} className="sm:col-span-2" />
          <TextField name="businessPostalCode" label="Code postal" defaultValue={v?.businessPostalCode ?? ""} />
          <TextField name="businessCity" label="Ville" defaultValue={v?.businessCity ?? ""} />
          <TextField name="businessCountry" label="Pays (code ISO)" defaultValue={v?.businessCountry ?? "FR"} maxLength={2} />
        </div>
      </div>
      <CarrierCheckboxes selected={v?.compatibleCarriers ?? ["COLISSIMO", "MONDIAL_RELAY"]} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="storageCapacity" label="Capacité de stockage (articles)" type="number" min={0} required defaultValue={v?.storageCapacity ?? 500} />
        <TextField name="maxClients" label="Nombre maximal de clients" type="number" min={0} required defaultValue={v?.maxClients ?? 20} />
      </div>
      <TextField name="availabilityNote" label="Note de disponibilité" defaultValue={v?.availabilityNote ?? ""} placeholder="Ex. : dépôts transporteurs à 17 h" />
      <TextAreaField name="adminNotes" label="Notes internes de l'administration" defaultValue={v?.adminNotes ?? ""} rows={3} />
    </div>
  );
}

export function CreatePreparerForm() {
  const [created, setCreated] = useState<{ invitationUrl: string; preparerId: string } | null>(null);
  if (created) {
    return (
      <div className="grid gap-4 rounded-2xl border bg-card p-6">
        <p className="flex items-center gap-2 font-medium text-success">
          <CheckCircle2 className="size-5" /> Préparateur créé
        </p>
        <p className="text-sm text-muted-foreground">
          Une invitation a été envoyée par e-mail. Si l&apos;envoi d&apos;e-mails n&apos;est pas configuré, transmettez ce lien d&apos;activation (valable 7 jours) par un canal sûr :
        </p>
        <code className="block overflow-x-auto rounded-lg bg-muted p-3 text-xs">{created.invitationUrl}</code>
        <div className="flex flex-wrap gap-2">
          <CopyButton value={created.invitationUrl} label="Copier le lien" />
          <Button asChild size="sm">
            <Link href={`/admin/preparateurs/${created.preparerId}`}>Ouvrir la fiche et ajouter ses points de réception</Link>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <ActionForm action={createPreparerAction} onSuccess={(s) => s.data && setCreated(s.data)} className="grid gap-6">
      <PreparerFields />
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Création…">Créer le préparateur et l&apos;inviter</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EditPreparerDialog({ preparerId, values }: { preparerId: string; values: PreparerValues }) {
  return (
    <ActionDialog
      wide
      trigger={
        <Button variant="outline" size="sm">
          <Pencil /> Modifier
        </Button>
      }
      title="Modifier le préparateur"
      action={updatePreparerAction}
      submitLabel="Enregistrer"
    >
      <input type="hidden" name="preparerId" value={preparerId} />
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        <PreparerFields v={values} />
      </div>
    </ActionDialog>
  );
}

export function PreparerStatusDialog({ preparerId, status, clients }: { preparerId: string; status: string; clients: number }) {
  return (
    <ActionDialog
      trigger={
        <Button variant="outline" size="sm">
          Changer le statut / désactiver
        </Button>
      }
      title="Statut du préparateur"
      description="Un préparateur indisponible ou suspendu ne peut plus recevoir de nouveaux clients."
      action={setPreparerStatusAction}
      submitLabel="Appliquer"
    >
      <input type="hidden" name="preparerId" value={preparerId} />
      <SelectField
        name="status"
        label="Nouveau statut"
        defaultValue={status}
        options={[
          { value: "ACTIVE", label: "Actif" },
          { value: "UNAVAILABLE", label: "Indisponible" },
          { value: "SUSPENDED", label: "Suspendu" },
        ]}
      />
      <TextField name="reason" label="Motif" required />
      <CheckboxField name="startReassignment" label={`Lancer la réattribution de ses ${clients} client(s)`} hint="Les clients passent en « Réattribution » avec un délai de 24 h." />
      <CheckboxField name="deactivateAccount" label="Bloquer l'accès au compte (déconnexion immédiate)" hint="Ignoré si le statut est « Actif » : l'accès est alors rétabli." />
    </ActionDialog>
  );
}

export function ResendInvitationButton({ preparerId }: { preparerId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <ActionForm action={resendInvitationAction} onSuccess={(s) => s.data && setUrl(s.data.invitationUrl)} className="inline-flex">
        <input type="hidden" name="preparerId" value={preparerId} />
        <SubmitButton variant="outline" size="sm" pendingLabel="Envoi…">
          <Send /> Renvoyer l&apos;invitation
        </SubmitButton>
      </ActionForm>
      {url && (
        <div className="flex flex-wrap items-center gap-2">
          <code className="max-w-full overflow-x-auto rounded-md bg-muted px-2 py-1 text-[0.7rem]">{url}</code>
          <CopyButton value={url} label="Copier" size="xs" />
        </div>
      )}
    </div>
  );
}

export function MessagePreparerDialog({ preparerId, name }: { preparerId: string; name: string }) {
  return (
    <ActionDialog
      trigger={
        <Button variant="outline" size="sm">
          <Send /> Envoyer un message
        </Button>
      }
      title={`Message à ${name}`}
      description="Le message est envoyé dans une conversation de support entre l'administration et le préparateur."
      action={messagePreparerAction}
      submitLabel="Envoyer"
    >
      <input type="hidden" name="preparerId" value={preparerId} />
      <TextField name="subject" label="Objet" required />
      <TextAreaField name="body" label="Message" required rows={5} />
    </ActionDialog>
  );
}

/** Correction du nombre de colis traités (ex. colis préparés avant Packio), motif journalisé. */
export function ParcelsProcessedDialog({ preparerId, name, value, compact }: { preparerId: string; name: string; value: number; compact?: boolean }) {
  return (
    <ActionDialog
      trigger={
        compact ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" aria-label={`Modifier les colis traités de ${name}`}>
            <Pencil className="size-3.5" /> Modifier
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm">
            <PackageCheck /> Modifier les colis traités
          </Button>
        )
      }
      title={`Colis traités par ${name}`}
      description="Nombre de colis préparés par ce préparateur, visible dans le back-office et lors des attributions. Il augmente tout seul à chaque colis traité dans Packio ; corrigez-le par exemple pour reprendre les colis préparés avant Packio."
      action={setParcelsProcessedAction}
      submitLabel="Enregistrer"
      successMessage="Nombre de colis traités mis à jour."
    >
      <input type="hidden" name="preparerId" value={preparerId} />
      <TextField name="value" label="Nombre de colis traités" type="number" min={0} max={1000000} step={1} required defaultValue={String(value)} />
      <TextField name="reason" label="Motif" required placeholder="Ex. : colis préparés avant l'arrivée sur Packio" hint="Conservé dans le journal d'audit." />
    </ActionDialog>
  );
}

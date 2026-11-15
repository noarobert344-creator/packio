"use client";

import { CalendarOff, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionDialog } from "@/components/shared/action-dialog";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/shared/form-field";
import { INCIDENT_PRIORITY, PARCEL_SIZE } from "@/lib/labels";
import { assignIncidentAction, declareAbsenceAction, reclassifyShipmentAction } from "@/server/actions/admin/people";

export function AbsenceDialog({ preparerId }: { preparerId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionDialog
      trigger={
        <Button variant="outline" size="sm">
          <CalendarOff /> Déclarer une absence
        </Button>
      }
      title="Déclarer une absence"
      description="L'administration et les clients attribués sont prévenus. Le préparateur n'est plus proposé à l'attribution pendant la période."
      action={declareAbsenceAction}
      submitLabel="Enregistrer"
    >
      <input type="hidden" name="preparerId" value={preparerId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="startsAt" label="Du" type="date" required defaultValue={today} min={today} />
        <TextField name="endsAt" label="Au (inclus)" type="date" required defaultValue={today} min={today} />
      </div>
      <TextField name="reason" label="Motif (facultatif)" />
    </ActionDialog>
  );
}

export function IncidentAdminControls({ incidentId, assignedToId, priority, admins }: { incidentId: string; assignedToId: string | null; priority: string; admins: { id: string; name: string }[] }) {
  return (
    <ActionForm action={assignIncidentAction} className="grid gap-3">
      <input type="hidden" name="incidentId" value={incidentId} />
      <SelectField name="adminId" label="Pris en charge par" defaultValue={assignedToId ?? ""} placeholder="Non attribué" options={admins.map((a) => ({ value: a.id, label: a.name }))} />
      <SelectField name="priority" label="Priorité" defaultValue={priority} options={Object.entries(INCIDENT_PRIORITY).map(([value, v]) => ({ value, label: v.label }))} />
      <div>
        <SubmitButton size="sm" pendingLabel="Enregistrement…">
          Enregistrer
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ReclassifyDialog({ incidentId, shipmentId, current, costs }: { incidentId: string; shipmentId: string; current: string | null; costs: Record<string, number> }) {
  return (
    <ActionDialog
      trigger={
        <Button variant="outline" size="sm" className="w-full">
          <Ruler /> Corriger la classification
        </Button>
      }
      title="Corriger la classification du colis"
      description="Avant débit, la réservation de crédits est ajustée. Après débit, seule une correction à la baisse est possible : la différence est restituée au client."
      action={reclassifyShipmentAction}
      submitLabel="Corriger"
    >
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <SelectField
        name="size"
        label="Nouvelle catégorie"
        defaultValue={current ?? "SMALL"}
        options={Object.entries(PARCEL_SIZE).map(([value, v]) => ({ value, label: `${v.label} — ${costs[value] ?? "?"} crédit(s)` }))}
      />
      <TextAreaField name="reason" label="Justification" required rows={3} />
    </ActionDialog>
  );
}

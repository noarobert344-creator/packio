"use client";

import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { CheckboxField, SelectField, TextAreaField } from "@/components/shared/form-field";
import { INCIDENT_STATUS } from "@/lib/labels";
import { addIncidentUpdateAction } from "@/server/actions/incidents";

export function IncidentReplyForm({ incidentId, isAdmin, currentStatus }: { incidentId: string; isAdmin: boolean; currentStatus: string }) {
  return (
    <ActionForm action={addIncidentUpdateAction} resetOnSuccess className="mt-5 grid gap-3 border-t pt-5">
      <input type="hidden" name="incidentId" value={incidentId} />
      <TextAreaField name="body" label={isAdmin ? "Réponse ou note" : "Ajouter une précision"} required rows={3} />
      {isAdmin && (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            name="status"
            label="Changer le statut"
            placeholder="Conserver le statut actuel"
            options={Object.entries(INCIDENT_STATUS)
              .filter(([k]) => k !== currentStatus)
              .map(([value, v]) => ({ value, label: v.label }))}
          />
          <CheckboxField name="internal" label="Note interne (invisible pour le client et le préparateur)" className="self-end pb-2" />
        </div>
      )}
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Envoi…">Envoyer</SubmitButton>
      </div>
    </ActionForm>
  );
}

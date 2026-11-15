"use client";

import { useState } from "react";
import { BadgeCheck, CircleSlash, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionButton, ActionDialog } from "@/components/shared/action-dialog";
import { TextField } from "@/components/shared/form-field";
import { assignPreparerAction, cancelAbsenceAction, deactivateLocationAction, setLocationValidationAction } from "@/server/actions/admin/people";
import { cn } from "@/lib/utils";

export function LocationValidationButton({ locationId, preparerId, validated }: { locationId: string; preparerId: string; validated: boolean }) {
  return (
    <ActionButton action={setLocationValidationAction} fields={{ locationId, preparerId, validated: validated ? "0" : "1" }} variant={validated ? "ghost" : "default"} size="xs">
      {validated ? <CircleSlash /> : <BadgeCheck />} {validated ? "Retirer la validation" : "Valider"}
    </ActionButton>
  );
}

export function DeactivateLocationButton({ locationId, preparerId }: { locationId: string; preparerId: string }) {
  return (
    <ActionButton action={deactivateLocationAction} fields={{ locationId, preparerId }} variant="ghost" size="xs" className="text-destructive">
      <X /> Désactiver
    </ActionButton>
  );
}

export function CancelAbsenceButton({ absenceId, preparerId }: { absenceId: string; preparerId: string }) {
  return (
    <ActionButton action={cancelAbsenceAction} fields={{ absenceId, preparerId }} variant="ghost" size="xs">
      Annuler
    </ActionButton>
  );
}

export function AssignCustomerDialog({
  preparerId,
  preparerName,
  customers,
  disabledReason,
}: {
  preparerId: string;
  preparerName: string;
  customers: { id: string; name: string; code: string; late: boolean }[];
  disabledReason: string | null;
}) {
  const [selected, setSelected] = useState(customers[0]?.id ?? "");
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="outline" disabled={!!disabledReason || customers.length === 0} title={disabledReason ?? (customers.length ? undefined : "Aucun client en attente")}>
          <UserPlus /> Attribuer un client
        </Button>
      }
      title={`Attribuer un client à ${preparerName}`}
      description="Clients en attente d'attribution. Le client et le préparateur sont notifiés à la confirmation."
      action={assignPreparerAction}
      submitLabel="Confirmer l'attribution"
    >
      <input type="hidden" name="preparerId" value={preparerId} />
      <input type="hidden" name="customerId" value={selected} />
      <div className="grid max-h-72 gap-2 overflow-y-auto" role="radiogroup" aria-label="Client">
        {customers.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={selected === c.id}
            onClick={() => setSelected(c.id)}
            className={cn(
              "flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-sm",
              selected === c.id ? "border-brand bg-brand-soft/50 ring-1 ring-brand" : "hover:border-foreground/20",
            )}
          >
            <span>
              <span className="font-medium">{c.name}</span> <span className="text-xs text-muted-foreground">{c.code}</span>
            </span>
            {c.late && <span className="text-xs font-medium text-danger">En retard</span>}
          </button>
        ))}
      </div>
      <TextField name="note" label="Note interne (facultatif)" />
    </ActionDialog>
  );
}

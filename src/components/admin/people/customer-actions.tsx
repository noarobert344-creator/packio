"use client";

import { Ban, Coins, ShieldOff, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionDialog } from "@/components/shared/action-dialog";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { RequestIdInput, SelectField, TextAreaField, TextField } from "@/components/shared/form-field";
import { adjustCreditsAction, anonymizeCustomerAction, setCustomerStatusAction, updateCustomerNotesAction } from "@/server/actions/admin/people";

export function CreditAdjustDialog({ customerId, requestId }: { customerId: string; requestId: string }) {
  return (
    <ActionDialog
      trigger={
        <Button variant="outline" size="sm">
          <Coins /> Créditer / Débiter
        </Button>
      }
      title="Ajuster le solde de crédits"
      description="L'opération est inscrite au registre des crédits et au journal d'audit avec votre justification. Elle ne peut pas être supprimée : une erreur se corrige par une opération inverse."
      action={adjustCreditsAction}
      submitLabel="Enregistrer l'opération"
      pendingLabel="Enregistrement…"
    >
      <input type="hidden" name="customerId" value={customerId} />
      <RequestIdInput value={requestId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="direction"
          label="Opération"
          defaultValue="CREDIT"
          options={[
            { value: "CREDIT", label: "Créditer" },
            { value: "DEBIT", label: "Débiter" },
          ]}
        />
        <TextField name="amount" label="Nombre de crédits" type="number" min={1} max={10000} required inputMode="numeric" />
      </div>
      <SelectField
        name="bucket"
        label="Catégorie de crédits"
        defaultValue="PURCHASED"
        hint="Les crédits mensuels suivent la politique d'expiration mensuelle ; les crédits achetés, la leur."
        options={[
          { value: "PURCHASED", label: "Crédits achetés / hors abonnement" },
          { value: "MONTHLY", label: "Crédits mensuels" },
        ]}
      />
      <TextAreaField name="reason" label="Justification" required rows={3} placeholder="Ex. : geste commercial suite au retard d'attribution" />
    </ActionDialog>
  );
}

export function CustomerNotesForm({ customerId, notes }: { customerId: string; notes: string | null }) {
  return (
    <ActionForm action={updateCustomerNotesAction} className="grid gap-3">
      <input type="hidden" name="customerId" value={customerId} />
      <TextAreaField name="notes" label="Note" defaultValue={notes ?? ""} rows={4} hint="Visibles uniquement par l'administration." />
      <div>
        <SubmitButton size="sm" variant="outline" pendingLabel="Enregistrement…">
          Enregistrer les notes
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function CustomerStatusDialog({ customerId, suspended }: { customerId: string; suspended: boolean }) {
  return (
    <ActionDialog
      trigger={
        <Button variant={suspended ? "outline" : "destructive"} size="sm">
          {suspended ? <UserCheck /> : <Ban />} {suspended ? "Réactiver le compte" : "Suspendre le compte"}
        </Button>
      }
      title={suspended ? "Réactiver le compte client" : "Suspendre le compte client"}
      description={
        suspended
          ? "Le client pourra de nouveau se connecter. Son statut est recalculé selon son abonnement."
          : "Le client est déconnecté et ne peut plus se connecter. L'abonnement Stripe n'est pas modifié."
      }
      action={setCustomerStatusAction}
      destructive={!suspended}
      submitLabel={suspended ? "Réactiver" : "Suspendre"}
    >
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="status" value={suspended ? "ACTIVE" : "SUSPENDED"} />
      <TextField name="reason" label="Motif" required />
    </ActionDialog>
  );
}

export function AnonymizeDialog({ customerId }: { customerId: string }) {
  return (
    <ActionDialog
      trigger={
        <Button variant="ghost" size="sm" className="text-destructive">
          <ShieldOff /> Anonymiser (RGPD)
        </Button>
      }
      title="Anonymiser les données personnelles"
      description="Droit à l'effacement : nom, e-mail, téléphone et mot de passe sont définitivement remplacés. Les registres comptables et logistiques sont conservés de façon anonyme. Impossible si l'abonnement est actif ou si du stock reste à restituer. Action irréversible."
      action={anonymizeCustomerAction}
      destructive
      submitLabel="Anonymiser définitivement"
    >
      <input type="hidden" name="customerId" value={customerId} />
      <TextField name="confirmation" label="Saisissez ANONYMISER pour confirmer" required autoComplete="off" />
    </ActionDialog>
  );
}

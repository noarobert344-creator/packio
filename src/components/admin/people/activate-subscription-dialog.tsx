"use client";

import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionDialog } from "@/components/shared/action-dialog";
import { SelectField, TextAreaField } from "@/components/shared/form-field";
import { activateSubscriptionAction } from "@/server/actions/admin/people";

/** Activer l'abonnement d'un client sans paiement (offert par Packio). */
export function ActivateSubscriptionDialog({
  customerId,
  customerLabel,
  plans,
  size = "sm",
}: {
  customerId: string;
  customerLabel: string;
  plans: { id: string; name: string; monthlyCredits: number }[];
  size?: "sm" | "xs";
}) {
  return (
    <ActionDialog
      trigger={
        <Button size={size} variant="outline">
          <Gift /> Activer l&apos;abonnement
        </Button>
      }
      title="Activer l'abonnement sans paiement"
      description={`${customerLabel} : abonnement offert par Packio, jamais facturé. Les crédits de l'offre sont versés chaque mois (le premier tout de suite) et l'abonnement s'arrête tout seul à la fin de la durée choisie.`}
      action={activateSubscriptionAction}
      submitLabel="Activer l'abonnement"
    >
      <input type="hidden" name="customerId" value={customerId} />
      <SelectField
        name="planId"
        label="Offre"
        required
        defaultValue={plans[0]?.id}
        options={plans.map((p) => ({
          value: p.id,
          label: `${p.name} — ${p.monthlyCredits} crédits par mois`,
        }))}
      />
      <SelectField
        name="months"
        label="Durée"
        required
        defaultValue="1"
        options={[
          { value: "1", label: "1 mois" },
          { value: "3", label: "3 mois" },
          { value: "6", label: "6 mois" },
          { value: "12", label: "12 mois" },
        ]}
      />
      <TextAreaField
        name="reason"
        label="Motif"
        required
        rows={2}
        placeholder="Ex. : paiement reçu en direct, geste commercial, partenaire…"
      />
    </ActionDialog>
  );
}

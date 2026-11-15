"use client";

import { ArrowLeftRight, BellRing, RotateCcw, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionDialog } from "@/components/shared/action-dialog";
import { CheckboxField, TextAreaField, TextField } from "@/components/shared/form-field";
import { assignPreparerAction, notifyDelayAction, reassignCustomerAction, startReassignmentAction } from "@/server/actions/admin/people";
import { PreparerPicker } from "./preparer-picker";
import type { CapacityOption } from "./types";

export function AssignDialog({ customerId, customerName, options, size = "default", label = "Attribuer un préparateur" }: {
  customerId: string;
  customerName: string;
  options: CapacityOption[];
  size?: "default" | "sm";
  label?: string;
}) {
  const none = !options.some((o) => o.available);
  return (
    <ActionDialog
      wide
      trigger={
        <Button size={size}>
          <UserPlus /> {label}
        </Button>
      }
      title={`Attribuer un préparateur à ${customerName}`}
      description="L'attribution est manuelle et définitive après confirmation : le client et le préparateur sont notifiés, leur conversation privée est créée et l'adresse de réception devient visible pour le client."
      action={assignPreparerAction}
      submitLabel="Confirmer l'attribution"
      pendingLabel="Attribution…"
    >
      <input type="hidden" name="customerId" value={customerId} />
      {none && (
        <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger">
          Aucun préparateur n&apos;est disponible actuellement. Ajoutez un préparateur, validez un point de réception ou augmentez une capacité.
        </p>
      )}
      <PreparerPicker options={options} />
      <TextField name="note" label="Note interne (facultatif)" placeholder="Ex. : même ville que le client" />
    </ActionDialog>
  );
}

export function ReassignDialog({ customerId, currentPreparerId, options }: { customerId: string; currentPreparerId: string | null; options: CapacityOption[] }) {
  return (
    <ActionDialog
      wide
      trigger={
        <Button variant="outline">
          <ArrowLeftRight /> Réattribuer
        </Button>
      }
      title="Réattribuer le client"
      description="L'affectation actuelle est clôturée (historique conservé) et l'ancien préparateur perd l'accès à la conversation. Les commandes déjà en route vers l'ancien préparateur restent à sa charge."
      action={reassignCustomerAction}
      submitLabel="Confirmer la réattribution"
      pendingLabel="Réattribution…"
    >
      <input type="hidden" name="customerId" value={customerId} />
      <PreparerPicker options={options} excludeId={currentPreparerId} />
      <TextField name="reason" label="Motif" required placeholder="Ex. : déménagement du préparateur" />
      <CheckboxField
        name="transferStock"
        label="Transférer le stock du client vers le nouveau préparateur"
        hint="Refusé si des expéditions sont en cours de préparation. Les expéditions non commencées suivent le stock."
      />
    </ActionDialog>
  );
}

export function StartReassignmentDialog({ customerId }: { customerId: string }) {
  return (
    <ActionDialog
      trigger={
        <Button variant="outline">
          <RotateCcw /> Lancer une réattribution
        </Button>
      }
      title="Lancer une réattribution"
      description="Le client passe en état « Réattribution » avec un nouveau délai de 24 h. Le préparateur actuel reste en charge jusqu'à la nouvelle attribution."
      action={startReassignmentAction}
      submitLabel="Lancer"
    >
      <input type="hidden" name="customerId" value={customerId} />
      <TextField name="reason" label="Motif" required />
    </ActionDialog>
  );
}

export function NotifyDelayDialog({ customerId, size = "default" }: { customerId: string; size?: "default" | "sm" }) {
  return (
    <ActionDialog
      trigger={
        <Button variant="outline" size={size}>
          <BellRing /> Informer du retard
        </Button>
      }
      title="Informer le client du retard"
      description="Le client reçoit une notification et un e-mail. Laissez le message vide pour utiliser le texte standard."
      action={notifyDelayAction}
      submitLabel="Envoyer l'information"
    >
      <input type="hidden" name="customerId" value={customerId} />
      <TextAreaField name="message" label="Message personnalisé (facultatif)" rows={4} placeholder="Ex. : votre préparateur vous sera attribué demain matin." />
    </ActionDialog>
  );
}

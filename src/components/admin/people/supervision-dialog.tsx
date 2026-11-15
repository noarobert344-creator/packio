"use client";

import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionDialog } from "@/components/shared/action-dialog";
import { TextAreaField } from "@/components/shared/form-field";
import { requestSupervisionAction } from "@/server/actions/messaging";

export function SupervisionRequestDialog({ conversationId, label, minutes }: { conversationId: string; label: string; minutes: number }) {
  return (
    <ActionDialog
      trigger={
        <Button variant="outline" size="sm">
          <Eye /> Demander un accès
        </Button>
      }
      title="Accès de supervision encadré"
      description={`Conversation ${label}. L'accès est accordé en lecture seule pour ${minutes} minutes, journalisé dans l'audit, et un message système informe les participants. N'y recourez que pour un besoin de support ou de litige.`}
      action={requestSupervisionAction}
      submitLabel="Accéder à la conversation"
    >
      <input type="hidden" name="conversationId" value={conversationId} />
      <TextAreaField name="reason" label="Motif précis" required rows={3} placeholder="Ex. : litige signalé par le client sur l'état d'un colis (incident INC-…)" hint="10 caractères minimum. Ce motif est conservé dans le journal d'audit." />
    </ActionDialog>
  );
}

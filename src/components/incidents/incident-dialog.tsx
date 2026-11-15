"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionDialog } from "@/components/shared/action-dialog";
import { SelectField, TextAreaField, TextField } from "@/components/shared/form-field";
import { FileUploader } from "@/components/shared/file-uploader";
import { INCIDENT_TYPE } from "@/lib/labels";
import { reportIncidentAction } from "@/server/actions/incidents";

type IncidentTypeKey = keyof typeof INCIDENT_TYPE;

export function ReportIncidentDialog({
  types,
  context,
  defaultTitle,
  customerId,
  trigger,
  label = "Signaler un problème",
}: {
  types: IncidentTypeKey[];
  context?: { supplierOrderId?: string; shipmentId?: string; inventoryItemId?: string };
  defaultTitle?: string;
  customerId?: string;
  trigger?: React.ReactNode;
  label?: string;
}) {
  return (
    <ActionDialog
      trigger={
        trigger ?? (
          <Button variant="outline">
            <TriangleAlert /> {label}
          </Button>
        )
      }
      title={label}
      description="Décrivez précisément la situation. Vous pourrez suivre son traitement et échanger avec l'équipe Packio."
      action={reportIncidentAction}
      submitLabel="Envoyer le signalement"
    >
      {context?.supplierOrderId && <input type="hidden" name="supplierOrderId" value={context.supplierOrderId} />}
      {context?.shipmentId && <input type="hidden" name="shipmentId" value={context.shipmentId} />}
      {context?.inventoryItemId && <input type="hidden" name="inventoryItemId" value={context.inventoryItemId} />}
      <SelectField name="type" label="Type de problème" required options={types.map((t) => ({ value: t, label: INCIDENT_TYPE[t] }))} defaultValue={types[0]} />
      <TextField name="title" label="Titre" required defaultValue={defaultTitle} />
      <TextAreaField name="description" label="Description" required rows={4} />
      <div className="grid gap-1.5">
        <span className="text-[0.8rem] font-medium">Photos (facultatif)</span>
        <FileUploader purpose="INCIDENT_ATTACHMENT" customerId={customerId} accept="image/*,application/pdf" />
      </div>
    </ActionDialog>
  );
}

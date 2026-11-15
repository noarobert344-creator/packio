"use client";

import { Camera } from "lucide-react";
import { SubmitButton } from "@/components/shared/action-form";
import { FileUploader } from "@/components/shared/file-uploader";
import { updateItemAction } from "@/server/actions/preparer";
import { StepForm } from "./step-form";

/** Photos d'un article, publiées dans l'espace « À vendre » du client. */
export function PhotoForSaleForm({ itemId, customerId, hasPhotos }: { itemId: string; customerId: string; hasPhotos: boolean }) {
  return (
    <StepForm action={updateItemAction} className="grid gap-3" successMessage="Photos publiées : le client est prévenu.">
      <input type="hidden" name="itemId" value={itemId} />
      <FileUploader purpose="PRODUCT_PHOTO" customerId={customerId} capture max={10} label={hasPhotos ? "Ajouter" : "Photographier"} hint="Plusieurs angles, fond neutre, étiquettes visibles." />
      <SubmitButton size="sm" pendingLabel="Publication…">
        <Camera /> {hasPhotos ? "Ajouter à l'annonce" : "Mettre en vente"}
      </SubmitButton>
    </StepForm>
  );
}

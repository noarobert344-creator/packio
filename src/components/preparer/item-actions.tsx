"use client";

import { Camera, CircleCheck, MapPin, PackageX, PencilLine, SearchX, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/shared/action-form";
import { TextAreaField, TextField } from "@/components/shared/form-field";
import { FileUploader } from "@/components/shared/file-uploader";
import { adjustQuantityAction, declareLossAction, markFoundAction, updateItemAction } from "@/server/actions/preparer";
import { StepForm, StepDialog } from "./step-form";

type Item = {
  id: string;
  customerId: string;
  name: string;
  storageLocation: string | null;
  notes: string | null;
  quantityAvailable: number;
  quantityMissing: number;
};

const actionBtn = "h-11 w-full justify-start";

export function ItemActions({ item, photoCount }: { item: Item; photoCount: number }) {
  return (
    <div className="grid gap-4">
      <section className="rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <MapPin className="size-4 text-brand" /> Emplacement et notes
        </h2>
        <StepForm action={updateItemAction} className="grid gap-3">
          <input type="hidden" name="itemId" value={item.id} />
          <TextField name="storageLocation" label="Emplacement de stockage" defaultValue={item.storageLocation ?? ""} placeholder="Ex. : A-03" />
          <TextAreaField name="notes" label="Notes internes" defaultValue={item.notes ?? ""} rows={2} placeholder="Visibles par vous et l'équipe Packio" />
          <SubmitButton variant="outline" pendingLabel="Enregistrement…">
            <PencilLine /> Enregistrer
          </SubmitButton>
        </StepForm>
      </section>

      <section className="rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Camera className="size-4 text-brand" /> Photographier l&apos;article
        </h2>
        <StepForm key={photoCount} action={updateItemAction} className="grid gap-3">
          <input type="hidden" name="itemId" value={item.id} />
          <FileUploader purpose="PRODUCT_PHOTO" customerId={item.customerId} capture label="Photographier" />
          <SubmitButton variant="outline" pendingLabel="Ajout…">
            Ajouter les photos
          </SubmitButton>
        </StepForm>
      </section>

      <section className="grid gap-2 rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
        <h2 className="mb-1 font-semibold">Quantités</h2>
        <StepDialog
          trigger={
            <Button variant="outline" className={actionBtn}>
              <SlidersHorizontal /> Modifier la quantité
            </Button>
          }
          title="Modifier la quantité disponible"
          description={`Disponible actuellement : ${item.quantityAvailable}. Indiquez une variation positive (ajout) ou négative (retrait). L'opération est historisée et le client est informé.`}
          action={adjustQuantityAction}
          submitLabel="Appliquer"
        >
          <input type="hidden" name="itemId" value={item.id} />
          <TextField name="delta" label="Variation" type="number" required inputMode="numeric" placeholder="Ex. : -1 ou 2" />
          <TextAreaField name="reason" label="Motif" required rows={2} />
        </StepDialog>
        <StepDialog
          trigger={
            <Button variant="outline" className={actionBtn} disabled={item.quantityAvailable < 1}>
              <PackageX /> Déclarer un article abîmé
            </Button>
          }
          title="Déclarer un article abîmé"
          description="Les quantités concernées sont retirées du stock disponible et un incident est ouvert."
          action={declareLossAction}
          submitLabel="Déclarer"
          destructive
        >
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="kind" value="DAMAGE" />
          <TextField name="quantity" label="Quantité abîmée" type="number" min={1} max={item.quantityAvailable} defaultValue="1" required />
          <TextAreaField name="reason" label="Description du dommage" required rows={3} />
        </StepDialog>
        <StepDialog
          trigger={
            <Button variant="outline" className={actionBtn} disabled={item.quantityAvailable < 1}>
              <SearchX /> Signaler un article manquant
            </Button>
          }
          title="Signaler un article manquant"
          description="Les quantités concernées sont retirées du stock disponible et un incident est ouvert. Vous pourrez les déclarer retrouvées ensuite."
          action={declareLossAction}
          submitLabel="Signaler"
          destructive
        >
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="kind" value="MISSING" />
          <TextField name="quantity" label="Quantité manquante" type="number" min={1} max={item.quantityAvailable} defaultValue="1" required />
          <TextAreaField name="reason" label="Circonstances" required rows={3} />
        </StepDialog>
        {item.quantityMissing > 0 && (
          <StepDialog
            trigger={
              <Button variant="outline" className={actionBtn}>
                <CircleCheck /> Article retrouvé
              </Button>
            }
            title="Article retrouvé"
            description={`${item.quantityMissing} article(s) déclaré(s) manquant(s).`}
            action={markFoundAction}
            submitLabel="Remettre en stock"
          >
            <input type="hidden" name="itemId" value={item.id} />
            <TextField name="quantity" label="Quantité retrouvée" type="number" min={1} max={item.quantityMissing} defaultValue={String(item.quantityMissing)} required />
            <TextField name="reason" label="Précision" placeholder="Facultatif" />
          </StepDialog>
        )}
      </section>
    </div>
  );
}

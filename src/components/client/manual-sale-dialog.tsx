"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionDialog } from "@/components/shared/action-dialog";
import { SelectField, TextField } from "@/components/shared/form-field";
import { FileUploader } from "@/components/shared/file-uploader";
import { createManualSaleAction } from "@/server/actions/marketplace";

/** Ajout d'une vente à la main, quand l'extension n'est pas installée ou pour une autre plateforme. */
export function ManualSaleDialog() {
  return (
    <ActionDialog
      wide
      trigger={
        <Button variant="outline" size="sm">
          <Plus /> Ajouter une vente
        </Button>
      }
      title="Ajouter une vente à la main"
      description="Sans l'extension, ou pour une vente faite ailleurs : elle rejoint « Toutes mes ventes » avec les mêmes boutons. Si l'article porte le même nom qu'un article de votre stock, il est pris automatiquement."
      action={createManualSaleAction}
      submitLabel="Ajouter la vente"
    >
      <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
        <SelectField
          name="platform"
          label="Plateforme"
          required
          defaultValue="VINTED"
          options={[
            { value: "VINTED", label: "Vinted" },
            { value: "VESTIAIRE", label: "Vestiaire Collective" },
            { value: "OTHER", label: "Autre plateforme" },
          ]}
        />
        <TextField name="title" label="Article vendu" required placeholder="Ex. : Pull en laine beige" />
        <TextField name="size" label="Taille" placeholder="Facultatif — ex. : M" />
        <TextField name="price" label="Prix de vente (€)" inputMode="decimal" placeholder="Facultatif" />
        <TextField name="externalOrderId" label="N° de commande" placeholder="Facultatif" />
        <TextField name="buyerName" label="Acheteur" placeholder="Facultatif" />
        <TextField name="shipBy" label="Date limite d'envoi" type="date" hint="Facultatif : les colis urgents passent en premier." />
        <div className="sm:col-span-2">
          <FileUploader name="labelFileIds" purpose="SHIPPING_LABEL" max={1} accept="application/pdf,image/*" label="Ajouter le bordereau" hint="Facultatif — PDF, JPEG ou PNG." />
        </div>
      </div>
    </ActionDialog>
  );
}

"use client";

import { ClipboardCheck, MinusCircle, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/shared/form-field";
import { FileUploader } from "@/components/shared/file-uploader";
import { useFieldError } from "@/components/shared/action-form";
import { addItemAction, inventoryCountAction, preparerDebitCreditsAction } from "@/server/actions/preparer";
import { StepDialog } from "./step-form";

export function AddItemDialog({ customerId, customerLabel }: { customerId: string; customerLabel: string }) {
  return (
    <StepDialog
      trigger={
        <Button>
          <PackagePlus /> Ajouter un article au stock
        </Button>
      }
      title="Ajouter un article au stock"
      description={`Article reçu pour ${customerLabel} hors commande enregistrée. Le client est notifié et l'opération est historisée.`}
      action={addItemAction}
      submitLabel="Ajouter au stock"
      pendingLabel="Ajout…"
    >
      <input type="hidden" name="customerId" value={customerId} />
      <TextField name="name" label="Nom de l'article" required placeholder="Ex. : Pull col roulé bleu (M)" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextField name="quantity" label="Quantité" type="number" min={1} max={999} defaultValue="1" required inputMode="numeric" />
        <TextField name="storageLocation" label="Emplacement" placeholder="Ex. : B-04" />
        <TextField name="supplierName" label="Fournisseur" placeholder="Facultatif" />
      </div>
      <TextAreaField name="description" label="Description" rows={2} placeholder="État, taille, particularités…" />
      <div className="grid gap-1.5">
        <span className="text-[0.8rem] font-medium">Photos de l&apos;article</span>
        <FileUploader purpose="PRODUCT_PHOTO" customerId={customerId} capture label="Photographier" />
      </div>
    </StepDialog>
  );
}

type CountItem = { id: string; name: string; sku: string; storageLocation: string | null; quantityAvailable: number };

function CountRow({ item }: { item: CountItem }) {
  const error = useFieldError(`count:${item.id}`);
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.name}</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{item.sku}</span>
          {item.storageLocation && ` · ${item.storageLocation}`} · attendu : <span className="font-medium text-foreground tabular">{item.quantityAvailable}</span>
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <input
        type="number"
        name={`count:${item.id}`}
        min={0}
        inputMode="numeric"
        defaultValue={item.quantityAvailable}
        aria-label={`Quantité comptée pour ${item.name}`}
        className="h-10 w-20 rounded-lg border border-input bg-transparent px-2 text-center text-sm tabular outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />
    </li>
  );
}

export function InventoryCountDialog({ customerId, items }: { customerId: string; items: CountItem[] }) {
  return (
    <StepDialog
      trigger={
        <Button variant="outline" disabled={!items.length}>
          <ClipboardCheck /> Réaliser un inventaire
        </Button>
      }
      title="Inventaire du stock client"
      description="Comptez physiquement chaque article disponible. Les écarts sont corrigés par des mouvements « Inventaire » historisés, et le client est informé."
      action={inventoryCountAction}
      submitLabel="Valider l'inventaire"
      pendingLabel="Enregistrement…"
      wide
    >
      <input type="hidden" name="customerId" value={customerId} />
      <ul className="max-h-[50vh] divide-y overflow-y-auto pr-1">
        {items.map((item) => (
          <CountRow key={item.id} item={item} />
        ))}
      </ul>
      <TextAreaField name="notes" label="Notes" rows={2} placeholder="Facultatif" />
    </StepDialog>
  );
}

/** Retrait de crédits : le motif est envoyé au client dans la messagerie. */
export function DebitCreditsDialog({ customerId, available, requestId, max }: { customerId: string; available: number; requestId: string; max: number }) {
  return (
    <StepDialog
      trigger={
        <Button variant="outline">
          <MinusCircle /> Retirer des crédits
        </Button>
      }
      title="Retirer des crédits"
      description={`Solde disponible du client : ${available} crédit(s). Le motif lui est envoyé automatiquement dans votre conversation, et le retrait figure dans son historique.`}
      action={preparerDebitCreditsAction}
      submitLabel="Retirer et prévenir le client"
      pendingLabel="Retrait…"
    >
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="requestId" value={requestId} />
      <TextField name="amount" label="Nombre de crédits" type="number" min={1} max={Math.min(max, Math.max(available, 1))} defaultValue="1" required inputMode="numeric" className="sm:max-w-40" />
      <TextAreaField name="reason" label="Motif (envoyé au client)" rows={3} required placeholder="Ex. : emballage renforcé demandé pour l'article fragile, carton double épaisseur." />
    </StepDialog>
  );
}

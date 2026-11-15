"use client";

import { useState } from "react";
import { CircleCheck, Coins, PackageCheck, PackageOpen, Play, Ruler, Tag, Truck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SubmitButton, useFieldError } from "@/components/shared/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/shared/form-field";
import { FileUploader } from "@/components/shared/file-uploader";
import { CARRIERS, INCIDENT_TYPE } from "@/lib/labels";
import { cn } from "@/lib/utils";
import {
  classifyShipmentAction,
  confirmDropOffAction,
  confirmLabelAction,
  markReadyAction,
  reportShipmentIncidentAction,
  startPreparationAction,
  updateTransitAction,
} from "@/server/actions/preparer";
import { StepForm, StepButton, StepDialog } from "./step-form";

type Size = "SMALL" | "MEDIUM" | "LARGE";
export type SizeRuleView = {
  size: Size;
  label: string;
  description: string | null;
  creditCost: number;
  maxLengthCm: number | null;
  maxWidthCm: number | null;
  maxHeightCm: number | null;
  maxWeightGrams: number | null;
};

type ShipmentStatus =
  | "REQUESTED"
  | "AWAITING_CLASSIFICATION"
  | "CLASSIFIED"
  | "AWAITING_CREDITS"
  | "PREPARING"
  | "READY"
  | "LABEL_READY"
  | "DROPPED_OFF"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "INCIDENT"
  | "CANCELLED";

function Panel({ icon: Icon, title, description, children, highlight = true }: { icon: typeof Ruler; title: string; description?: React.ReactNode; children: React.ReactNode; highlight?: boolean }) {
  return (
    <section className={cn("rounded-2xl border bg-card p-4 shadow-soft sm:p-5", highlight && "border-brand/30 ring-1 ring-brand/10")}>
      <div className="mb-4 flex items-start gap-3">
        <span className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-xl", highlight ? "bg-brand text-brand-foreground" : "bg-muted")}>
          <Icon className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
      </div>
      {children}
    </section>
  );
}

function SizeOptions({ rules, defaultSize }: { rules: SizeRuleView[]; defaultSize: Size | null }) {
  const error = useFieldError("size");
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-[0.8rem] font-medium">
        Catégorie du colis <span className="text-destructive">*</span>
      </legend>
      {rules.map((r) => {
        const dims = r.maxLengthCm && r.maxWidthCm && r.maxHeightCm ? `${r.maxLengthCm} × ${r.maxWidthCm} × ${r.maxHeightCm} cm` : null;
        const weight = r.maxWeightGrams ? `${(r.maxWeightGrams / 1000).toLocaleString("fr-FR")} kg` : null;
        return (
          <label
            key={r.size}
            className="flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand-soft/60 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
          >
            <input type="radio" name="size" value={r.size} defaultChecked={defaultSize === r.size} className="mt-1 size-4 accent-[var(--brand)]" required />
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{r.label}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-foreground px-2 py-0.5 text-xs font-semibold text-background tabular">
                  <Coins className="size-3" /> {r.creditCost} crédit{r.creditCost > 1 ? "s" : ""}
                </span>
              </span>
              {r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}
              {(dims || weight) && <span className="block text-xs text-muted-foreground">Max. {[dims, weight].filter(Boolean).join(" · ")}</span>}
            </span>
          </label>
        );
      })}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </fieldset>
  );
}

export function ClassificationForm({
  shipmentId,
  rules,
  current,
  reclassify,
}: {
  shipmentId: string;
  rules: SizeRuleView[];
  current: { size: Size | null; weightGrams: number | null; lengthCm: number | null; widthCm: number | null; heightCm: number | null };
  reclassify?: boolean;
}) {
  const [open, setOpen] = useState(!reclassify);
  if (!open) {
    return (
      <Button variant="outline" className="h-11 w-full justify-start" onClick={() => setOpen(true)}>
        <Ruler /> Modifier la classification
      </Button>
    );
  }
  return (
    <Panel
      icon={Ruler}
      highlight={!reclassify}
      title={reclassify ? "Modifier la classification" : "Classifier le colis"}
      description="Vous seul déterminez la taille réelle du colis, selon les règles Packio. Le client est notifié et les crédits correspondants sont réservés sur son solde."
    >
      <StepForm action={classifyShipmentAction} className="grid gap-4">
        <input type="hidden" name="shipmentId" value={shipmentId} />
        <SizeOptions rules={rules} defaultSize={current.size} />
        <details className="group rounded-xl border p-3" open={!!(current.weightGrams || current.lengthCm)}>
          <summary className="cursor-pointer text-sm font-medium">Poids et dimensions (facultatif)</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TextField name="weightGrams" label="Poids (g)" type="number" min={1} inputMode="numeric" defaultValue={current.weightGrams ? String(current.weightGrams) : ""} />
            <TextField name="lengthCm" label="Long. (cm)" type="number" min={1} inputMode="numeric" defaultValue={current.lengthCm ? String(current.lengthCm) : ""} />
            <TextField name="widthCm" label="Larg. (cm)" type="number" min={1} inputMode="numeric" defaultValue={current.widthCm ? String(current.widthCm) : ""} />
            <TextField name="heightCm" label="Haut. (cm)" type="number" min={1} inputMode="numeric" defaultValue={current.heightCm ? String(current.heightCm) : ""} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Si renseignés, le poids et les dimensions sont contrôlés par rapport aux limites de la catégorie.</p>
        </details>
        <TextField name="note" label="Note" placeholder="Facultatif — visible dans l'historique" />
        <div className="flex gap-2">
          {reclassify && (
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
          )}
          <SubmitButton size="lg" className="h-12 flex-1 text-base" pendingLabel="Enregistrement…">
            <CircleCheck /> Confirmer la classification
          </SubmitButton>
        </div>
      </StepForm>
    </Panel>
  );
}

export function ShipmentStepPanel({
  shipmentId,
  customerId,
  status,
  creditCost,
  requestedCarrier,
  customerLabelAvailable,
}: {
  shipmentId: string;
  customerId: string;
  status: ShipmentStatus;
  creditCost: number | null;
  requestedCarrier: string | null;
  customerLabelAvailable: boolean;
}) {
  if (status === "CLASSIFIED") {
    return (
      <Panel icon={Play} title="Démarrer la préparation" description="Les crédits sont réservés. Rassemblez les articles de la liste de préparation.">
        <StepButton action={startPreparationAction} fields={{ shipmentId }} size="lg" className="h-12 w-full text-base" successMessage="Préparation démarrée.">
          <PackageOpen /> Commencer la préparation
        </StepButton>
      </Panel>
    );
  }
  if (status === "PREPARING") {
    return (
      <Panel icon={PackageCheck} title="Colis prêt" description="Photographiez le colis fermé (recommandé), puis validez.">
        <StepForm action={markReadyAction} className="grid gap-4">
          <input type="hidden" name="shipmentId" value={shipmentId} />
          <FileUploader purpose="PREPARATION_PHOTO" customerId={customerId} capture label="Photo du colis" />
          <TextField name="note" label="Note" placeholder="Facultatif" />
          <SubmitButton size="lg" className="h-12 w-full text-base" pendingLabel="Validation…">
            <PackageCheck /> Le colis est prêt
          </SubmitButton>
        </StepForm>
      </Panel>
    );
  }
  if (status === "READY") {
    return (
      <Panel
        icon={Tag}
        title="Étiquette d'expédition"
        description={customerLabelAvailable ? "Le client a fourni son bordereau : imprimez-le et collez-le, ou ajoutez l'étiquette que vous avez créée." : "Ajoutez l'étiquette créée (PDF ou photo)."}
      >
        <StepForm action={confirmLabelAction} className="grid gap-4">
          <input type="hidden" name="shipmentId" value={shipmentId} />
          <FileUploader name="labelIds" purpose="SHIPPING_LABEL" customerId={customerId} accept="application/pdf,image/*" max={1} label="Ajouter l'étiquette" hint="PDF, JPEG ou PNG — 10 Mo max." />
          <SubmitButton size="lg" className="h-12 w-full text-base" pendingLabel="Validation…">
            <Tag /> {customerLabelAvailable ? "Valider l'étiquette" : "Enregistrer l'étiquette"}
          </SubmitButton>
        </StepForm>
      </Panel>
    );
  }
  if (status === "LABEL_READY") {
    return (
      <Panel
        icon={Truck}
        title="Confirmer le dépôt"
        description={
          <>
            {creditCost ? (
              <p>
                À la validation, <strong className="text-foreground">{creditCost} crédit{creditCost > 1 ? "s" : ""}</strong> de préparation sont débités définitivement du solde du client.
              </p>
            ) : (
              <p>Aucun crédit n&apos;est requis pour cette expédition.</p>
            )}
          </>
        }
      >
        <StepForm action={confirmDropOffAction} className="grid gap-4">
          <input type="hidden" name="shipmentId" value={shipmentId} />
          <SelectField name="carrier" label="Transporteur" required defaultValue={requestedCarrier ?? ""} placeholder="Choisir…" options={CARRIERS.map((c) => ({ value: c.code, label: c.label }))} />
          <TextField name="trackingNumber" label="Numéro de suivi" required autoComplete="off" autoCapitalize="characters" />
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm font-medium">Frais de transport (facultatif)</summary>
            <p className="mt-2 text-xs text-muted-foreground">Affranchissement avancé pour le client, distinct des crédits de préparation et facturé séparément.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_1fr]">
              <TextField name="shippingFee" label="Montant (€)" inputMode="decimal" placeholder="0,00" />
              <TextField name="shippingFeeNote" label="Précision" placeholder="Ex. : Colissimo 1 kg" />
            </div>
          </details>
          <SubmitButton size="lg" className="h-12 w-full text-base" pendingLabel="Confirmation…">
            <Truck /> Confirmer le dépôt
          </SubmitButton>
        </StepForm>
      </Panel>
    );
  }
  if (status === "DROPPED_OFF" || status === "IN_TRANSIT" || status === "INCIDENT") {
    return (
      <Panel icon={Truck} highlight={false} title="Suivi de l'acheminement" description="Mettez à jour le statut selon le suivi du transporteur.">
        <div className="grid gap-2">
          {status === "DROPPED_OFF" && (
            <StepButton action={updateTransitAction} fields={{ shipmentId, status: "IN_TRANSIT" }} variant="outline" className="h-11 w-full justify-start">
              <Truck /> Marquer en transit
            </StepButton>
          )}
          <StepButton action={updateTransitAction} fields={{ shipmentId, status: "DELIVERED" }} variant="outline" className="h-11 w-full justify-start">
            <CircleCheck /> Marquer comme livré
          </StepButton>
        </div>
      </Panel>
    );
  }
  return null;
}

export function ShipmentIncidentDialog({ shipmentId, customerId }: { shipmentId: string; customerId: string }) {
  return (
    <StepDialog
      trigger={
        <Button variant="outline" className="h-11 w-full justify-start">
          <TriangleAlert /> Signaler un incident
        </Button>
      }
      title="Signaler un incident d'expédition"
      description="Le client et l'équipe Packio sont prévenus. Après dépôt, l'expédition passe en statut « Incident »."
      action={reportShipmentIncidentAction}
      submitLabel="Signaler"
    >
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <SelectField name="type" label="Type" required defaultValue="SHIPMENT_ISSUE" options={(["SHIPMENT_ISSUE", "OTHER"] as const).map((t) => ({ value: t, label: INCIDENT_TYPE[t] }))} />
      <TextAreaField name="description" label="Description" required rows={4} />
      <div className="grid gap-1.5">
        <span className="text-[0.8rem] font-medium">Photos</span>
        <FileUploader purpose="INCIDENT_ATTACHMENT" customerId={customerId} capture accept="image/*,application/pdf" />
      </div>
    </StepDialog>
  );
}

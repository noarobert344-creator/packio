"use client";

import { useState } from "react";
import { ClipboardCheck, MapPin, PackageCheck, PackagePlus, Plus, Trash2, TriangleAlert, Undo2, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitButton, useFieldError } from "@/components/shared/action-form";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/shared/form-field";
import { FileUploader } from "@/components/shared/file-uploader";
import { INCIDENT_TYPE } from "@/lib/labels";
import { cn } from "@/lib/utils";
import {
  markPickedUpAction,
  receiveOrderAction,
  reportOrderProblemAction,
  setOrderStatusAction,
  stockOrderAction,
} from "@/server/actions/preparer";
import { StepForm, StepButton, StepDialog } from "./step-form";

type OrderStatus =
  | "REGISTERED"
  | "SUPPLIER_CONFIRMED"
  | "IN_TRANSIT"
  | "AT_LOCKER"
  | "PICKED_UP"
  | "RECEIVED"
  | "QUALITY_CHECK"
  | "IN_STOCK"
  | "INCIDENT"
  | "RETURNED_TO_SUPPLIER"
  | "CANCELLED";

type Props = {
  orderId: string;
  customerId: string;
  status: OrderStatus;
  quantity: number;
  description: string;
  directDelivery: boolean;
};

const BEFORE_PICKUP: OrderStatus[] = ["REGISTERED", "SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER"];

function ActionCard({ icon: Icon, title, description, children, tone = "brand" }: { icon: typeof PackageCheck; title: string; description: string; children: React.ReactNode; tone?: "brand" | "muted" }) {
  return (
    <section className={cn("rounded-2xl border bg-card p-4 shadow-soft sm:p-5", tone === "brand" && "border-brand/30 ring-1 ring-brand/10")}>
      <div className="mb-4 flex items-start gap-3">
        <span className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-xl", tone === "brand" ? "bg-brand text-brand-foreground" : "bg-muted")}>
          <Icon className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function PickupForm({ orderId, customerId }: { orderId: string; customerId: string }) {
  return (
    <ActionCard icon={MapPin} title="Confirmer la récupération" description="Vous avez retiré le colis au locker ou au point relais. Le client est notifié.">
      <StepForm action={markPickedUpAction} className="grid gap-4">
        <input type="hidden" name="orderId" value={orderId} />
        <FileUploader purpose="RECEPTION_PHOTO" customerId={customerId} capture label="Photo du colis" hint="Facultatif — photo du colis tel que récupéré." />
        <TextField name="note" label="Note" placeholder="Facultatif" />
        <SubmitButton size="lg" className="h-12 w-full text-base" pendingLabel="Confirmation…">
          <PackageCheck /> J&apos;ai récupéré le colis
        </SubmitButton>
      </StepForm>
    </ActionCard>
  );
}

function ConditionChoice() {
  const error = useFieldError("condition");
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-[0.8rem] font-medium">
        État du contenu <span className="text-destructive">*</span>
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {[
          { value: "ok", label: "Conforme", hint: "Contenu intact et conforme" },
          { value: "defaut", label: "Défaut constaté", hint: "Abîmé, incomplet ou erroné" },
        ].map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer flex-col gap-0.5 rounded-xl border p-3 text-sm transition-colors has-[:checked]:border-brand has-[:checked]:bg-brand-soft/60"
          >
            <span className="flex items-center gap-2 font-medium">
              <input type="radio" name="condition" value={o.value} defaultChecked={o.value === "ok"} className="size-4 accent-[var(--brand)]" />
              {o.label}
            </span>
            <span className="pl-6 text-xs text-muted-foreground">{o.hint}</span>
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </fieldset>
  );
}

function ReceiveForm({ orderId, customerId, quantity, primary }: { orderId: string; customerId: string; quantity: number; primary: boolean }) {
  return (
    <ActionCard
      icon={PackageCheck}
      tone={primary ? "brand" : "muted"}
      title="Réceptionner le colis"
      description="Contrôlez le contenu, indiquez les quantités et photographiez les articles."
    >
      <StepForm action={receiveOrderAction} className="grid gap-4">
        <input type="hidden" name="orderId" value={orderId} />
        <TextField name="quantityReceived" label={`Quantité reçue (attendue : ${quantity})`} type="number" min={0} max={999} defaultValue={String(quantity)} inputMode="numeric" required />
        <ConditionChoice />
        <TextAreaField name="conditionNotes" label="Observations" rows={2} placeholder="Obligatoire en cas de défaut" />
        <div className="grid gap-1.5">
          <span className="text-[0.8rem] font-medium">Photos de réception</span>
          <FileUploader purpose="RECEPTION_PHOTO" customerId={customerId} capture label="Photographier" />
        </div>
        <CheckboxField name="qualityCheck" label="Placer en contrôle qualité avant mise en stock" hint="Automatique si un défaut ou un écart de quantité est constaté." />
        <SubmitButton size="lg" className="h-12 w-full text-base" pendingLabel="Enregistrement…">
          <PackageCheck /> Valider la réception
        </SubmitButton>
      </StepForm>
    </ActionCard>
  );
}

function RowErrors({ index }: { index: number }) {
  const name = useFieldError(`name.${index}`);
  const qty = useFieldError(`quantity.${index}`);
  if (!name && !qty) return null;
  return <p className="text-xs text-destructive">{[name, qty].filter(Boolean).join(" · ")}</p>;
}

function StockForm({ orderId, customerId, quantity, description }: { orderId: string; customerId: string; quantity: number; description: string }) {
  const [rows, setRows] = useState<number[]>([0]);
  const [next, setNext] = useState(1);
  return (
    <ActionCard icon={Warehouse} title="Mettre en stock" description="Créez les articles du client. Ajoutez une ligne par référence distincte (ex. : tailles différentes).">
      <StepForm action={stockOrderAction} className="grid gap-4">
        <input type="hidden" name="orderId" value={orderId} />
        <ol className="grid gap-3">
          {rows.map((key, index) => (
            <li key={key} className="grid gap-3 rounded-xl border bg-muted/30 p-3">
              <input type="hidden" name="row[]" value={key} />
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Article {index + 1}</span>
                {rows.length > 1 && (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Retirer l'article ${index + 1}`} onClick={() => setRows((r) => r.filter((k) => k !== key))}>
                    <Trash2 />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_6rem_8rem]">
                <label className="grid gap-1 text-[0.8rem] font-medium">
                  Nom
                  <Input name="name[]" defaultValue={index === 0 ? description : ""} required className="h-10" />
                </label>
                <label className="grid gap-1 text-[0.8rem] font-medium">
                  Quantité
                  <Input name="quantity[]" type="number" min={1} max={999} inputMode="numeric" defaultValue={index === 0 ? String(quantity) : "1"} required className="h-10" />
                </label>
                <label className="grid gap-1 text-[0.8rem] font-medium">
                  Emplacement
                  <Input name="location[]" placeholder="Ex. : A-03" className="h-10" />
                </label>
              </div>
              <RowErrors index={index} />
              <FileUploader name={`photos${key}`} purpose="PRODUCT_PHOTO" customerId={customerId} capture label="Photo produit" hint="" max={4} />
            </li>
          ))}
        </ol>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setRows((r) => [...r, next]);
            setNext((n) => n + 1);
          }}
        >
          <Plus /> Ajouter une ligne
        </Button>
        <SubmitButton size="lg" className="h-12 w-full text-base" pendingLabel="Mise en stock…">
          <PackagePlus /> Mettre en stock
        </SubmitButton>
      </StepForm>
    </ActionCard>
  );
}

const PROBLEM_TYPES = ["INBOUND_DAMAGED", "WRONG_ITEM", "INBOUND_MISSING", "LOCKER_ISSUE"] as const;

function ProblemDialog({ orderId, customerId }: { orderId: string; customerId: string }) {
  return (
    <StepDialog
      trigger={
        <Button variant="outline" className="h-11 w-full justify-start">
          <TriangleAlert /> Signaler un défaut
        </Button>
      }
      title="Signaler un défaut"
      description="Un incident est ouvert : le client et l'équipe Packio sont prévenus. La commande passe en statut « Incident »."
      action={reportOrderProblemAction}
      submitLabel="Signaler"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <SelectField name="type" label="Type de problème" required defaultValue="INBOUND_DAMAGED" options={PROBLEM_TYPES.map((t) => ({ value: t, label: INCIDENT_TYPE[t] }))} />
      <TextAreaField name="description" label="Description" required rows={4} placeholder="Décrivez précisément ce que vous constatez." />
      <div className="grid gap-1.5">
        <span className="text-[0.8rem] font-medium">Photos</span>
        <FileUploader purpose="INCIDENT_ATTACHMENT" customerId={customerId} capture accept="image/*,application/pdf" />
      </div>
    </StepDialog>
  );
}

/** Panneau d'actions contextuel : seules les actions valides pour le statut sont proposées. */
export function OrderActionsPanel({ orderId, customerId, status, quantity, description, directDelivery }: Props) {
  const beforePickup = BEFORE_PICKUP.includes(status);
  const canReceive = beforePickup || status === "PICKED_UP";
  const canStock = ["RECEIVED", "QUALITY_CHECK", "INCIDENT"].includes(status);
  const canQuality = status === "RECEIVED" || status === "INCIDENT";
  const canReturn = status === "INCIDENT";
  const canProblem = !["IN_STOCK", "RETURNED_TO_SUPPLIER", "CANCELLED", "INCIDENT"].includes(status);

  if (!canReceive && !canStock && !canReturn) {
    return (
      <div className="rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground">
        {status === "IN_STOCK" ? "Commande traitée : les articles sont en stock." : "Aucune action requise pour cette commande."}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {beforePickup && !directDelivery && <PickupForm orderId={orderId} customerId={customerId} />}
      {canReceive && <ReceiveForm orderId={orderId} customerId={customerId} quantity={quantity} primary={status === "PICKED_UP" || directDelivery} />}
      {canStock && <StockForm orderId={orderId} customerId={customerId} quantity={quantity} description={description} />}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {/* L'arrivée au point de retrait est signalée par le client, qui a le code. */}
        {canQuality && (
          <StepButton action={setOrderStatusAction} fields={{ orderId, status: "QUALITY_CHECK" }} variant="outline" className="h-11 w-full justify-start">
            <ClipboardCheck /> Contrôle qualité en cours
          </StepButton>
        )}
        {canProblem && <ProblemDialog orderId={orderId} customerId={customerId} />}
        {canReturn && (
          <StepDialog
            trigger={
              <Button variant="outline" className="h-11 w-full justify-start">
                <Undo2 /> Retour fournisseur
              </Button>
            }
            title="Retour au fournisseur"
            description="Indiquez comment le colis est retourné. Le client est notifié."
            action={setOrderStatusAction}
            submitLabel="Confirmer le retour"
          >
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="status" value="RETURNED_TO_SUPPLIER" />
            <TextAreaField name="note" label="Note" rows={3} placeholder="Ex. : retour déposé en point relais, numéro de suivi…" />
          </StepDialog>
        )}
      </div>
    </div>
  );
}

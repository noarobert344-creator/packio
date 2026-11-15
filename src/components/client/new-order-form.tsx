"use client";

import { useMemo, useState } from "react";
import { CircleCheck, CircleX, ExternalLink } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/shared/form-field";
import { FileUploader } from "@/components/shared/file-uploader";
import { Button } from "@/components/ui/button";
import { CARRIERS } from "@/lib/labels";
import { createOrderAction } from "@/server/actions/customer";

export type OrderSupplier = {
  id: string;
  code: string;
  name: string;
  websiteUrl: string | null;
  requiresPickupCode: boolean;
  compatibilityNotes: string | null;
  compatibility: Record<string, { ok: true } | { ok: false; reason: string }>;
};

export function NewOrderForm({ suppliers, locations, defaultSupplier }: { suppliers: OrderSupplier[]; locations: { id: string; label: string; detail: string }[]; defaultSupplier?: string }) {
  const [supplierId, setSupplierId] = useState(() => suppliers.find((s) => s.code === defaultSupplier)?.id ?? suppliers[0]?.id ?? "");
  const supplier = suppliers.find((s) => s.id === supplierId);
  const compatible = useMemo(() => locations.filter((l) => supplier?.compatibility[l.id]?.ok), [locations, supplier]);
  const [locationId, setLocationId] = useState(compatible[0]?.id ?? "");
  const effectiveLocation = compatible.some((l) => l.id === locationId) ? locationId : (compatible[0]?.id ?? "");

  return (
    <ActionForm action={createOrderAction} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="supplierId"
          label="Fournisseur"
          required
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
        />
        {supplier?.code === "OTHER" && <TextField name="supplierLabel" label="Nom de la boutique" required placeholder="Ex. : Zalando, Leboncoin…" />}
      </div>
      {supplier && (
        <div className="rounded-xl border bg-muted/30 p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">Points de réception compatibles avec {supplier.name}</p>
            {supplier.websiteUrl && (
              <Button asChild variant="outline" size="sm">
                <a href={supplier.websiteUrl} target="_blank" rel="noopener noreferrer">
                  Ouvrir le fournisseur <ExternalLink />
                </a>
              </Button>
            )}
          </div>
          <ul className="mt-3 space-y-1.5">
            {locations.map((l) => {
              const c = supplier.compatibility[l.id];
              return (
                <li key={l.id} className="flex gap-2">
                  {c?.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  <span className={c?.ok ? "" : "text-muted-foreground"}>
                    {l.label}
                    {c && !c.ok && <span className="block text-xs">{c.reason}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {supplier.compatibilityNotes && <p className="mt-3 text-xs text-muted-foreground">{supplier.compatibilityNotes}</p>}
        </div>
      )}
      {compatible.length === 0 ? (
        <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning">
          Aucun point de réception de votre préparateur n&apos;est compatible avec ce fournisseur. Contactez votre préparateur ou le support.
        </p>
      ) : (
        <>
          <SelectField
            name="locationId"
            label="Point de réception utilisé"
            required
            value={effectiveLocation}
            onChange={(e) => setLocationId(e.target.value)}
            options={compatible.map((l) => ({ value: l.id, label: `${l.label} — ${l.detail}` }))}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="description" label="Description du produit" required placeholder="Ex. : Veste en jean Levi's taille M" className="sm:col-span-2" />
            <TextField name="articleUrl" label="Lien de l'article" type="url" placeholder="https://…" className="sm:col-span-2" />
            <TextField name="supplierOrderNumber" label="Numéro de commande" placeholder="Facultatif" />
            <TextField name="quantity" label="Quantité" type="number" min={1} max={999} defaultValue={1} required />
            <TextField name="trackingNumber" label="Numéro de suivi" placeholder="Si déjà disponible" />
            <SelectField name="carrier" label="Transporteur" placeholder="Inconnu pour le moment" options={CARRIERS.map((c) => ({ value: c.code, label: c.label }))} />
            <TextField name="expectedArrivalAt" label="Date d'arrivée estimée" type="date" />
          </div>
          <TextAreaField name="instructions" label="Instructions pour votre préparateur" rows={3} placeholder="Ex. : vérifier la taille, photographier l'étiquette…" />
          <div className="grid gap-1.5">
            <span className="text-[0.8rem] font-medium">Photo du produit (facultatif)</span>
            <FileUploader purpose="ORDER_PHOTO" max={4} label="Ajouter" />
          </div>
          {supplier?.code === "OTHER" && (
            <CheckboxField
              name="compatibilityConfirmed"
              required
              label="Je confirme que cette boutique livre bien vers le point de réception sélectionné, au nom du destinataire indiqué."
            />
          )}
          {supplier?.requiresPickupCode && (
            <p className="rounded-xl bg-info-soft p-3 text-xs text-info">
              Ce fournisseur utilise des points de retrait avec code. Pensez à transmettre le code de retrait à votre préparateur dès que le colis est disponible.
            </p>
          )}
          <div>
            <SubmitButton size="lg" pendingLabel="Enregistrement…">
              Enregistrer la commande
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

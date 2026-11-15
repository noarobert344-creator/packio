"use client";

import { useState } from "react";
import { ImageOff, Info } from "lucide-react";
import { ActionForm, SubmitButton, useFieldError } from "@/components/shared/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/shared/form-field";
import { FileUploader } from "@/components/shared/file-uploader";
import { CARRIERS, SHIPMENT_OPTIONS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { requestShipmentAction } from "@/server/actions/customer";

type Item = { id: string; name: string; sku: string; available: number; photoId: string | null; storageLocation: string | null };

function ItemsError() {
  const err = useFieldError("items");
  return err ? <p className="text-xs text-destructive">{err}</p> : null;
}

export function ShipmentRequestForm({ items, preselect, sizes, available }: { items: Item[]; preselect?: string; sizes: { label: string; creditCost: number; dims: string }[]; available: number }) {
  const [selected, setSelected] = useState<Record<string, number>>(() => (preselect && items.some((i) => i.id === preselect) ? { [preselect]: 1 } : {}));
  const [labelMode, setLabelMode] = useState<"CUSTOMER_PROVIDED" | "PREPARER_PROVIDED">("CUSTOMER_PROVIDED");
  const count = Object.values(selected).reduce((s, n) => s + n, 0);

  return (
    <ActionForm action={requestShipmentAction} className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-8">
        <fieldset className="space-y-3">
          <legend className="mb-2 text-base font-semibold">1. Articles à expédier</legend>
          <div className="grid gap-2">
            {items.map((i) => {
              const checked = selected[i.id] !== undefined;
              return (
                <label key={i.id} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors", checked ? "border-brand bg-brand-soft/40" : "hover:bg-muted/40")}>
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--brand)]"
                    checked={checked}
                    onChange={(e) =>
                      setSelected((s) => {
                        const next = { ...s };
                        if (e.target.checked) next[i.id] = 1;
                        else delete next[i.id];
                        return next;
                      })
                    }
                  />
                  {checked && <input type="hidden" name="itemIds[]" value={i.id} />}
                  <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {i.photoId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/files/${i.photoId}`} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-muted-foreground">
                        <ImageOff className="size-4" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.sku} · {i.available} disponible(s)
                    </p>
                  </div>
                  {checked && (
                    <input
                      type="number"
                      name={`qty:${i.id}`}
                      min={1}
                      max={i.available}
                      value={selected[i.id]}
                      onChange={(e) => setSelected((s) => ({ ...s, [i.id]: Math.max(1, Math.min(i.available, Number(e.target.value) || 1)) }))}
                      onClick={(e) => e.stopPropagation()}
                      className="h-9 w-20 rounded-lg border bg-background px-2 text-center text-sm tabular"
                      aria-label={`Quantité pour ${i.name}`}
                    />
                  )}
                </label>
              );
            })}
          </div>
          <ItemsError />
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-2 text-base font-semibold">2. Destinataire</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="recipientName" label="Nom du destinataire" required autoComplete="name" />
            <TextField name="recipientCompany" label="Société" placeholder="Facultatif" />
            <TextField name="addressLine1" label="Adresse" required autoComplete="address-line1" className="sm:col-span-2" />
            <TextField name="addressLine2" label="Complément d'adresse" autoComplete="address-line2" className="sm:col-span-2" />
            <TextField name="postalCode" label="Code postal" required autoComplete="postal-code" />
            <TextField name="city" label="Ville" required autoComplete="address-level2" />
            <SelectField
              name="country"
              label="Pays"
              required
              defaultValue="FR"
              options={[
                { value: "FR", label: "France" },
                { value: "BE", label: "Belgique" },
                { value: "LU", label: "Luxembourg" },
                { value: "CH", label: "Suisse" },
                { value: "DE", label: "Allemagne" },
                { value: "ES", label: "Espagne" },
                { value: "IT", label: "Italie" },
                { value: "NL", label: "Pays-Bas" },
                { value: "PT", label: "Portugal" },
              ]}
            />
            <TextField name="recipientPhone" label="Téléphone" type="tel" placeholder="Recommandé pour les points relais" />
            <TextField name="recipientEmail" label="E-mail" type="email" placeholder="Facultatif" className="sm:col-span-2" />
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-2 text-base font-semibold">3. Transport et étiquette</legend>
          <SelectField name="requestedCarrier" label="Transporteur souhaité" placeholder="Au choix du préparateur" options={CARRIERS.map((c) => ({ value: c.code, label: c.label }))} />
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["CUSTOMER_PROVIDED", "J'ai un bordereau d'expédition", "Par exemple un bordereau Vinted ou une étiquette déjà payée."],
                ["PREPARER_PROVIDED", "Le préparateur crée l'étiquette", "Les frais de transport éventuels sont facturés séparément des crédits."],
              ] as const
            ).map(([value, title, text]) => (
              <label key={value} className={cn("flex cursor-pointer gap-3 rounded-xl border p-3.5", labelMode === value ? "border-brand bg-brand-soft/40" : "hover:bg-muted/40")}>
                <input type="radio" name="labelMode" value={value} checked={labelMode === value} onChange={() => setLabelMode(value)} className="mt-1 accent-[var(--brand)]" />
                <span>
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="text-xs text-muted-foreground">{text}</span>
                </span>
              </label>
            ))}
          </div>
          {labelMode === "CUSTOMER_PROVIDED" && (
            <div className="grid gap-1.5">
              <span className="text-[0.8rem] font-medium">Bordereau ou étiquette (PDF ou image) *</span>
              <FileUploader name="labelFileIds" purpose="SHIPPING_LABEL" max={1} accept="application/pdf,image/*" label="Ajouter le bordereau" hint="PDF, JPEG ou PNG — 10 Mo max." />
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-2 text-base font-semibold">4. Options et instructions</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {SHIPMENT_OPTIONS.map((o) => (
              <label key={o.code} className="flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm hover:bg-muted/40">
                <input type="checkbox" name="options[]" value={o.code} className="size-4 accent-[var(--brand)]" />
                {o.label}
              </label>
            ))}
          </div>
          <TextAreaField name="instructions" label="Instructions pour votre préparateur" rows={3} />
        </fieldset>
      </div>

      <aside className="h-fit space-y-4 rounded-2xl border bg-card p-5 shadow-soft lg:sticky lg:top-24">
        <p className="font-semibold">Récapitulatif</p>
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular">{count}</span> <span className="text-muted-foreground">article(s) sélectionné(s)</span>
        </p>
        <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-medium">
            <Info className="size-3.5" /> Coût de préparation
          </p>
          <p className="text-muted-foreground">Votre préparateur détermine la taille réelle du colis :</p>
          <ul className="space-y-1">
            {sizes.map((s) => (
              <li key={s.label} className="flex justify-between gap-2">
                <span>
                  {s.label} <span className="text-muted-foreground">({s.dims})</span>
                </span>
                <span className="font-medium whitespace-nowrap">
                  {s.creditCost} crédit{s.creditCost > 1 ? "s" : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Solde disponible : <span className="font-medium text-foreground">{available} crédit(s)</span>. Les crédits sont réservés à la classification et débités au dépôt chez le transporteur.
          </p>
          {available < 3 && (
            <a href="/client/credits#recharger" className="inline-flex font-medium text-brand underline-offset-2 hover:underline">
              Acheter des crédits supplémentaires
            </a>
          )}
        </div>
        <SubmitButton className="h-10 w-full" disabled={count === 0} pendingLabel="Envoi de la demande…">
          Demander l&apos;expédition
        </SubmitButton>
      </aside>
    </ActionForm>
  );
}

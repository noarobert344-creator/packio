"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BadgeEuro, CircleCheck, CircleX, ExternalLink, PackagePlus, Phone, Warehouse, Zap } from "lucide-react";
import { CopyButton } from "@/components/shared/copy-button";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/shared/form-field";
import { FileUploader } from "@/components/shared/file-uploader";
import { Button } from "@/components/ui/button";
import { CARRIERS } from "@/lib/labels";
import { createOrderAction } from "@/server/actions/customer";
import { cn } from "@/lib/utils";
import { ARRIVAL_OTHER } from "@/lib/compatibility";

export type OrderStorageInfo = {
  /** null = places illimitées */
  capacity: number | null;
  used: number;
  incoming: number;
  slotsPerCredit: number;
  extraSlotsDays: number;
  includedDays: number;
  availableCredits: number;
  shippingHours: number;
};

export type OrderSupplier = {
  id: string;
  code: string;
  name: string;
  websiteUrl: string | null;
  requiresPickupCode: boolean;
  compatibilityNotes: string | null;
  compatibility: Record<string, { ok: true } | { ok: false; reason: string }>;
  /** Types de commande pour lesquels le fournisseur est proposé. */
  orderModes: ("STOCK" | "DROPSHIP")[];
};

export function NewOrderForm({
  suppliers,
  locations,
  defaultSupplier,
  storage,
  defaultMode = "STOCK",
  linkedSale = null,
}: {
  suppliers: OrderSupplier[];
  locations: { id: string; label: string; detail: string; recipientName: string; phone: string | null }[];
  defaultSupplier?: string;
  storage: OrderStorageInfo;
  defaultMode?: "STOCK" | "DROPSHIP";
  /** Vente d'un compte lié déclarée « Vendu en dropshipping ». */
  linkedSale?: { id: string; title: string; platformLabel: string; externalOrderId: string; hasLabel: boolean } | null;
}) {
  const [mode, setModeState] = useState<"STOCK" | "DROPSHIP">(defaultMode);
  const modeSuppliers = useMemo(() => suppliers.filter((s) => s.orderModes.includes(mode)), [suppliers, mode]);
  const [quantity, setQuantity] = useState("1");
  const qty = Math.max(0, Number.parseInt(quantity, 10) || 0);
  const missing = storage.capacity === null || mode === "DROPSHIP" ? 0 : storage.used + storage.incoming + qty - storage.capacity;
  const creditsNeeded = missing > 0 ? Math.ceil(missing / storage.slotsPerCredit) : 0;
  const slotsAdded = creditsNeeded * storage.slotsPerCredit;
  const [supplierId, setSupplierId] = useState(
    () => suppliers.find((s) => s.code === defaultSupplier && s.orderModes.includes(defaultMode))?.id ?? suppliers.find((s) => s.orderModes.includes(defaultMode))?.id ?? "",
  );
  const supplier = modeSuppliers.find((s) => s.id === supplierId) ?? modeSuppliers[0];
  const setMode = (next: "STOCK" | "DROPSHIP") => {
    setModeState(next);
    if (!suppliers.find((s) => s.id === supplierId)?.orderModes.includes(next)) setSupplierId(suppliers.find((s) => s.orderModes.includes(next))?.id ?? "");
  };
  const compatible = useMemo(() => locations.filter((l) => supplier?.compatibility[l.id]?.ok), [locations, supplier]);
  const [locationId, setLocationId] = useState(compatible[0]?.id ?? (locations.length ? "" : ARRIVAL_OTHER));
  // « Autre point » choisi, ou aucun point du préparateur compatible avec ce fournisseur.
  const arrivalOther = locationId === ARRIVAL_OTHER || compatible.length === 0;
  const effectiveLocation = compatible.some((l) => l.id === locationId) ? locationId : (compatible[0]?.id ?? "");

  return (
    <ActionForm action={createOrderAction} className="grid gap-5">
      <input type="hidden" name="mode" value={mode} />
      <div role="radiogroup" aria-label="Type de commande" className="grid gap-3 sm:grid-cols-2">
        {(
          [
            { value: "STOCK", icon: Warehouse, title: "Pour mon stock", text: `L'article est stocké chez votre préparateur (${storage.includedDays} jours inclus), prêt à être expédié.` },
            { value: "DROPSHIP", icon: Zap, title: "Dropshipping (article déjà vendu)", text: `Vous avez vendu l'article : il est expédié à votre acheteur dès réception, sous ${storage.shippingHours} h.` },
          ] as const
        ).map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={mode === o.value}
            onClick={() => setMode(o.value)}
            className={cn(
              "flex gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === o.value ? "border-brand bg-brand-soft/60 ring-1 ring-brand" : "hover:border-foreground/20",
            )}
          >
            <o.icon className={cn("mt-0.5 size-5 shrink-0", mode === o.value ? "text-brand" : "text-muted-foreground")} />
            <span>
              <span className="block text-sm font-semibold">{o.title}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{o.text}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="supplierId"
          label="Fournisseur"
          required
          value={supplier?.id ?? ""}
          onChange={(e) => setSupplierId(e.target.value)}
          options={modeSuppliers.map((s) => ({ value: s.id, label: s.code === "OTHER" ? "Autre (à préciser)" : s.name }))}
          hint={
            mode === "DROPSHIP"
              ? "Dropshipping : Temu, SHEIN, AliExpress, ou « Autre »."
              : "Pour le stock : ZenMarket, Vinted, Vestiaire Collective, Whatnot, ou « Autre »."
          }
        />
        {supplier?.code === "OTHER" && (
          <TextField name="supplierLabel" label="Où avez-vous acheté l'article ?" required placeholder="Ex. : Leboncoin, Zalando, une boutique…" hint="Votre préparateur verra cette information." />
        )}
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
      <>
        <SelectField
          name="locationId"
          label="Où va arriver le colis ?"
          required
          value={arrivalOther ? ARRIVAL_OTHER : effectiveLocation}
          onChange={(e) => setLocationId(e.target.value)}
          options={[
            ...compatible.map((l) => ({ value: l.id, label: `${l.label} — ${l.detail}` })),
            { value: ARRIVAL_OTHER, label: "Un autre point relais ou locker (à préciser)" },
          ]}
          hint={compatible.length === 0 ? "Aucun point de votre préparateur n'est compatible avec ce fournisseur : précisez le point choisi lors de l'achat." : undefined}
        />
        <TextField
          name="arrivalNote"
          label={arrivalOther ? "Nom et adresse du point d'arrivée" : "Précision sur l'arrivée (facultatif)"}
          required={arrivalOther}
          placeholder={arrivalOther ? "Ex. : Locker Mondial Relay Gare Part-Dieu, 5 place Charles Béraudier, 69003 Lyon" : "Ex. : casier n° 12, livraison prévue en point relais, etc."}
          hint="Votre préparateur voit cette information sur la commande."
        />
        {supplier?.code === "VINTED" &&
          (() => {
            const loc = compatible.find((l) => l.id === effectiveLocation);
            return (
              <div className="grid gap-2 rounded-xl border border-brand/40 bg-brand-soft/60 p-4 text-sm">
                <p className="flex items-center gap-2 font-semibold">
                  <Phone className="size-4 text-brand" /> Sur Vinted, indiquez le numéro de votre préparateur
                </p>
                <p className="text-xs text-muted-foreground">
                  À l&apos;étape livraison, saisissez le destinataire « {loc?.recipientName} » et ce numéro de téléphone : c&apos;est votre préparateur qui reçoit le SMS avec le code de
                  retrait.
                </p>
                {loc?.phone ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-lg bg-background px-3 py-1.5 font-mono text-base font-semibold tracking-wide">{loc.phone}</span>
                    <CopyButton value={loc.phone} label="Copier le numéro" />
                  </div>
                ) : (
                  <p className="text-xs font-medium text-warning">Numéro non renseigné pour ce point de réception : contactez le support avant de commander.</p>
                )}
              </div>
            );
          })()}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="description" label="Description du produit" required placeholder="Ex. : Veste en jean Levi's taille M" className="sm:col-span-2" defaultValue={linkedSale?.title} />
          <TextField name="articleUrl" label="Lien de l'article" type="url" placeholder="https://…" className="sm:col-span-2" />
          <TextField name="supplierOrderNumber" label="Numéro de commande" placeholder="Facultatif" />
          <TextField name="quantity" label="Quantité" type="number" min={1} max={999} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
          <TextField name="trackingNumber" label="Numéro de suivi" placeholder="Si déjà disponible" />
          <SelectField name="carrier" label="Transporteur" placeholder="Inconnu pour le moment" options={CARRIERS.map((c) => ({ value: c.code, label: c.label }))} />
          <TextField name="expectedArrivalAt" label="Date d'arrivée estimée" type="date" />
        </div>
        {mode === "DROPSHIP" && (
          <div className="grid gap-4 rounded-xl border border-brand/30 bg-brand-soft/40 p-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Zap className="size-4 text-brand" /> Vente à expédier
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Vous gérez l&apos;échange avec votre acheteur sur la plateforme. Ajoutez le bordereau de la vente (ex. bordereau Vinted) : votre préparateur l&apos;imprime et
                expédie l&apos;article dès réception. Sans bordereau, indiquez l&apos;adresse de l&apos;acheteur. Aucune place de stock n&apos;est utilisée ; les crédits
                dépendent de la taille du colis.
              </p>
            </div>
            {linkedSale ? (
              <div className="rounded-lg border bg-background/70 p-3 text-sm">
                <input type="hidden" name="marketplaceSaleId" value={linkedSale.id} />
                <p className="font-medium">
                  Vente {linkedSale.platformLabel} : « {linkedSale.title} »
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">Commande n° {linkedSale.externalOrderId}</p>
                <p className="mt-2 text-xs text-success">
                  {linkedSale.hasLabel
                    ? "Bordereau déjà reçu : il est joint automatiquement à cette commande."
                    : "Le bordereau sera joint automatiquement dès que Packio Connect le reçoit."}
                </p>
              </div>
            ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                name="salePlatform"
                label="Plateforme de vente"
                defaultValue="VINTED"
                options={[
                  { value: "VINTED", label: "Vinted" },
                  { value: "VESTIAIRE", label: "Vestiaire Collective" },
                  { value: "OTHER", label: "Autre" },
                ]}
              />
              <TextField name="saleReference" label="Référence de la vente" placeholder="Ex. : n° de commande Vinted" />
            </div>
            )}
            <div className="grid gap-1.5">
              <span className="text-[0.8rem] font-medium">Bordereau d&apos;expédition{linkedSale ? " (facultatif)" : ""}</span>
              <FileUploader name="labelFileIds" purpose="SHIPPING_LABEL" max={1} accept="application/pdf,image/*" label="Ajouter le bordereau" hint="PDF, JPEG ou PNG — 10 Mo max." />
            </div>
            <details className="rounded-lg border bg-background/60 p-3 text-sm">
              <summary className="cursor-pointer font-medium">Pas de bordereau ? Adresse de l&apos;acheteur</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <TextField name="buyerName" label="Nom de l'acheteur" />
                <TextField name="buyerPhone" label="Téléphone" type="tel" />
                <TextField name="buyerAddressLine1" label="Adresse" className="sm:col-span-2" />
                <TextField name="buyerAddressLine2" label="Complément" className="sm:col-span-2" />
                <TextField name="buyerPostalCode" label="Code postal" />
                <TextField name="buyerCity" label="Ville" />
                <TextField name="buyerCountry" label="Pays (code)" defaultValue="FR" maxLength={2} />
              </div>
            </details>
          </div>
        )}
        {creditsNeeded > 0 && (
          <div className={cn("grid gap-3 rounded-xl border p-4 text-sm", storage.availableCredits < creditsNeeded ? "border-danger/30 bg-danger-soft" : "border-warning/30 bg-warning-soft")}>
            <p className="flex items-start gap-2">
              <PackagePlus className="mt-0.5 size-4 shrink-0" />
              <span>
                Cette commande dépasse vos places de stock ({storage.capacity} places, {storage.used} occupée{storage.used > 1 ? "s" : ""}
                {storage.incoming ? `, ${storage.incoming} en commande` : ""}). <strong>{creditsNeeded} crédit{creditsNeeded > 1 ? "s" : ""}</strong>{" "}
                {creditsNeeded > 1 ? "seront débités" : "sera débité"} pour {slotsAdded} places supplémentaires pendant {storage.extraSlotsDays} jours.
              </span>
            </p>
            {storage.availableCredits < creditsNeeded ? (
              <p className="flex items-center gap-2 font-medium text-danger">
                <BadgeEuro className="size-4" /> Solde insuffisant ({storage.availableCredits} crédit{storage.availableCredits > 1 ? "s" : ""}).{" "}
                <Link href="/client/credits#recharger" className="underline underline-offset-2">
                  Acheter des crédits
                </Link>
              </p>
            ) : (
              <CheckboxField
                name="acceptStorageCharge"
                required
                label={`J'accepte le débit de ${creditsNeeded} crédit${creditsNeeded > 1 ? "s" : ""} pour ${slotsAdded} places de stock supplémentaires.`}
              />
            )}
          </div>
        )}
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
          <SubmitButton size="lg" pendingLabel="Enregistrement…" disabled={creditsNeeded > storage.availableCredits}>
            {mode === "DROPSHIP" ? "Enregistrer la commande en dropshipping" : "Enregistrer la commande"}
          </SubmitButton>
        </div>
      </>
    </ActionForm>
  );
}

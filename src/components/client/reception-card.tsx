import { Building2, Clock, KeyRound, MapPin, Store } from "lucide-react";
import { CopyButton } from "@/components/shared/copy-button";
import { LOCATION_TYPE, networkLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

export type ReceptionLocation = {
  id: string;
  type: "BUSINESS_ADDRESS" | "LOCKER" | "RELAY_POINT";
  label: string;
  network: string | null;
  relayName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  country: string;
  externalId: string | null;
  recipientName: string;
  recipientPhone: string | null;
  openingHours: string | null;
  instructions: string | null;
  isPrimary: boolean;
};

export function formatReceptionAddress(l: ReceptionLocation, clientCode: string) {
  return [
    l.recipientName,
    l.type === "BUSINESS_ADDRESS" ? `Réf. client ${clientCode}` : null,
    l.recipientPhone ? `Tél. ${l.recipientPhone}` : null,
    l.relayName,
    l.addressLine1,
    l.addressLine2,
    `${l.postalCode} ${l.city}`,
    l.country === "FR" ? "France" : l.country,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Coordonnées de réception validées, prêtes à être copiées dans le formulaire du fournisseur. */
export function ReceptionCard({ location: l, clientCode }: { location: ReceptionLocation; clientCode: string }) {
  const Icon = l.type === "BUSINESS_ADDRESS" ? Building2 : l.type === "LOCKER" ? KeyRound : Store;
  const isPickup = l.type !== "BUSINESS_ADDRESS";
  return (
    <div className={cn("flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-soft", l.isPrimary && "border-brand/40")}>
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">
            {l.label}
            {l.isPrimary && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 align-middle text-[0.65rem] font-medium text-brand-foreground">Principal</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {LOCATION_TYPE[l.type]}
            {l.network ? ` · ${networkLabel(l.network)}` : ""}
            {l.externalId ? ` · ID ${l.externalId}` : ""}
          </p>
        </div>
      </div>
      <div className="rounded-xl bg-muted/50 p-3.5 font-mono text-[0.8rem] leading-relaxed whitespace-pre-line">{formatReceptionAddress(l, clientCode)}</div>
      <dl className="grid gap-2 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Destinataire à indiquer :</dt>
          <dd className="font-medium">{l.recipientName}</dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-muted-foreground">Téléphone à indiquer :</dt>
          <dd className="flex items-center gap-2 font-medium">
            {l.recipientPhone ?? <span className="text-warning">non renseigné, contactez le support</span>}
            {l.recipientPhone && <CopyButton value={l.recipientPhone} label="Copier" variant="ghost" size="sm" />}
          </dd>
        </div>
        {l.relayName && (
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Nom exact :</dt>
            <dd className="font-medium">{l.relayName}</dd>
          </div>
        )}
        {l.openingHours && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="size-3.5" /> {l.openingHours}
          </div>
        )}
      </dl>
      {isPickup ? (
        <p className="flex gap-2 rounded-xl bg-warning-soft p-3 text-xs text-warning">
          <KeyRound className="mt-0.5 size-3.5 shrink-0" />
          Dès que le colis est disponible, transmettez le code de retrait à votre préparateur depuis la page de la commande.
        </p>
      ) : (
        <p className="flex gap-2 rounded-xl bg-info-soft p-3 text-xs text-info">
          <MapPin className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Ajoutez votre code client <span className="font-semibold">{clientCode}</span> en complément d&apos;adresse ou dans le nom de société pour que votre colis soit identifié.
          </span>
        </p>
      )}
      {l.instructions && <p className="text-xs text-muted-foreground">{l.instructions}</p>}
      <div className="mt-auto flex flex-wrap gap-2">
        <CopyButton value={formatReceptionAddress(l, clientCode)} label={isPickup ? "Copier l'adresse du locker" : "Copier l'adresse du préparateur"} variant="default" />
        <CopyButton value={l.recipientName} label="Copier le destinataire" />
        <CopyButton value={clientCode} label="Copier mon code client" />
      </div>
    </div>
  );
}

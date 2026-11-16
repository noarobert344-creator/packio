"use client";

import { TriangleAlert } from "lucide-react";
import { CopyButton } from "@/components/shared/copy-button";

/**
 * Comment remplir l'adresse chez le fournisseur pour une livraison en poste
 * restante : le colis est gardé au bureau de poste, et le préparateur le retire
 * avec sa pièce d'identité. Sans la mention POSTE RESTANTE, il n'est pas gardé.
 */
export function PosteRestanteGuide({
  recipientName,
  officeName,
  addressLine1,
  postalCode,
  city,
  phone,
}: {
  recipientName: string;
  officeName: string | null;
  addressLine1: string;
  postalCode: string;
  city: string;
  phone: string | null;
}) {
  const fields: { label: string; value: string; note?: string; strong?: boolean }[] = [
    { label: "Nom et prénom", value: recipientName, note: "Exactement comme ici : c'est le nom de la pièce d'identité de votre préparateur." },
    { label: "Adresse (ligne 1)", value: "POSTE RESTANTE", note: "Obligatoire, en majuscules : sinon le colis n'est pas gardé au bureau de poste.", strong: true },
    { label: "Adresse (ligne 2)", value: [officeName, addressLine1].filter(Boolean).join(", ") },
    { label: "Code postal", value: postalCode },
    { label: "Ville", value: city },
    { label: "Pays", value: "France" },
    ...(phone ? [{ label: "Téléphone", value: phone }] : []),
  ];
  return (
    <div className="grid gap-3 rounded-xl border-2 border-warning/50 bg-warning-soft p-4 text-sm">
      <p className="flex items-start gap-2 font-semibold text-warning">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          Poste restante : écrivez bien « POSTE RESTANTE » dans l&apos;adresse. Ne mettez ni votre nom ni votre adresse : remplissez le formulaire du fournisseur
          exactement comme ci-dessous.
        </span>
      </p>
      <dl className="grid gap-2">
        {fields.map((f) => (
          <div key={f.label} className="flex items-start gap-3 rounded-lg bg-background/80 p-2.5">
            <div className="grid min-w-0 flex-1 gap-0.5 sm:grid-cols-[9.5rem_1fr] sm:gap-3">
              <dt className="text-xs text-muted-foreground sm:pt-0.5">{f.label}</dt>
              <dd className="min-w-0">
                <span className={f.strong ? "font-mono text-base font-bold tracking-wide text-foreground" : "font-medium break-words"}>{f.value}</span>
                {f.note && <span className="mt-0.5 block text-xs text-muted-foreground">{f.note}</span>}
              </dd>
            </div>
            <CopyButton value={f.value} label="Copier" variant="ghost" size="sm" />
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Le colis attend au bureau de poste et votre préparateur le retire au guichet avec sa pièce d&apos;identité. Pour ZenMarket, choisissez un envoi par la poste
        japonaise (EMS, ePacket ou courrier aérien) : DHL et FedEx ne livrent pas en poste restante.
      </p>
    </div>
  );
}

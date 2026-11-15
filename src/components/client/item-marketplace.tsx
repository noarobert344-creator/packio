import Link from "next/link";
import { ExternalLink, Store } from "lucide-react";
import { Section } from "@/components/shared/page-header";
import { ActionButton } from "@/components/shared/action-dialog";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { SelectField } from "@/components/shared/form-field";
import { listingsForItem } from "@/server/services/marketplace";
import { linkListingAction } from "@/server/actions/marketplace";
import { MARKETPLACE_PLATFORM } from "@/lib/labels";
import { formatMoney } from "@/lib/format";

/**
 * Annonces Vinted / Vestiaire rattachées à un article du stock (composant
 * serveur, à intégrer dans la fiche article du client).
 */
export async function ItemMarketplace({ customerId, itemId }: { customerId: string; itemId: string }) {
  const { linked, available } = await listingsForItem(customerId, itemId);
  return (
    <Section
      title="Annonces en ligne"
      description="Une vente sur une annonce rattachée crée automatiquement l'expédition, avec le bordereau de la plateforme."
    >
      {linked.length ? (
        <ul className="mb-4 divide-y rounded-xl border">
          {linked.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {l.url ? (
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
                      {l.title} <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    l.title
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {MARKETPLACE_PLATFORM[l.platform]} · {l.status === "sold" ? "vendue" : l.status}
                  {l.priceCents !== null ? ` · ${formatMoney(l.priceCents, l.currency)}` : ""}
                </p>
              </div>
              <ActionButton action={linkListingAction} fields={{ listingId: l.id, itemId: "" }} variant="ghost" size="sm">
                Détacher
              </ActionButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 flex items-start gap-2 text-sm text-muted-foreground">
          <Store className="mt-0.5 size-4 shrink-0" />
          <span>Aucune annonce rattachée. Astuce : citez le SKU de l&apos;article dans la description de l&apos;annonce pour un rattachement automatique.</span>
        </p>
      )}
      {available.length > 0 && (
        <ActionForm action={linkListingAction} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <input type="hidden" name="itemId" value={itemId} />
          <SelectField
            name="listingId"
            label="Rattacher une annonce synchronisée"
            required
            placeholder="Choisir une annonce"
            options={available.map((l) => ({ value: l.id, label: `${MARKETPLACE_PLATFORM[l.platform]} · ${l.title}${l.priceCents !== null ? ` (${formatMoney(l.priceCents, l.currency)})` : ""}` }))}
          />
          <SubmitButton variant="outline" pendingLabel="Rattachement…">
            Rattacher
          </SubmitButton>
        </ActionForm>
      )}
      <Link href="/client/ventes" className="mt-3 inline-flex text-sm font-medium text-brand hover:underline">
        Ventes et comptes liés
      </Link>
    </Section>
  );
}

import { Truck } from "lucide-react";
import { requirePreparer } from "@/server/auth/current";
import { listMyShipments, PAGE_SIZE, SHIPMENT_GROUPS, type ShipmentGroup } from "@/server/queries/preparer";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, Pagination, SearchInput } from "@/components/shared/list-controls";
import { ShipmentCard } from "@/components/preparer/cards";
import { one, oneOf, parsePage, type SearchParams } from "@/lib/params";

const GROUP_KEYS = Object.keys(SHIPMENT_GROUPS) as ShipmentGroup[];

/** Liste des colis à envoyer : stock (ventes et retours) ou dropshipping. */
export async function ShipmentsList({ searchParams, dropship }: { searchParams: SearchParams; dropship: boolean }) {
  const actor = await requirePreparer();
  const sp = await searchParams;
  const group = oneOf(sp.groupe, GROUP_KEYS) ?? "classifier";
  const q = one(sp.q);
  const page = parsePage(sp.page);
  const { items, total, groupCounts } = await listMyShipments(actor.preparerId, { group, q, page, dropship });
  const basePath = dropship ? "/preparateur/dropshipping/colis" : "/preparateur/expeditions";

  return (
    <div className="space-y-5">
      <PageHeader
        title={dropship ? "Colis à envoyer — dropshipping" : "Colis à envoyer"}
        description={
          dropship
            ? "Articles reçus des fournisseurs (Temu, SHEIN, AliExpress), à expédier directement à l'acheteur avec le bordereau de la vente, sous 48 h."
            : "Colis depuis le stock de vos clients (ventes et retours à domicile) : classifiez, préparez, déposez. Les crédits sont débités à la confirmation du dépôt."
        }
      />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterTabs param="groupe" options={GROUP_KEYS.map((g) => ({ value: g === "classifier" ? "" : g, label: SHIPMENT_GROUPS[g].label, count: groupCounts[g] }))} />
        <SearchInput placeholder="Référence, destinataire, suivi…" />
      </div>
      {items.length ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((s) => (
              <ShipmentCard key={s.id} shipment={{ ...s, itemCount: s.items.reduce((n, i) => n + i.quantity, 0) }} />
            ))}
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath={basePath} params={{ groupe: one(sp.groupe), q }} />
        </>
      ) : (
        <EmptyState
          icon={Truck}
          title="Aucun colis ici"
          description={q ? "Aucun résultat pour cette recherche." : dropship ? "Les colis en dropshipping apparaissent ici dès la réception de l'article." : "Les demandes d'expédition de vos clients apparaissent ici dès leur création."}
        />
      )}
    </div>
  );
}

import type { Metadata } from "next";
import { PackageCheck } from "lucide-react";
import { requirePreparer } from "@/server/auth/current";
import { listMyOrders, ORDER_GROUPS, PAGE_SIZE, type OrderGroup } from "@/server/queries/preparer";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, Pagination, SearchInput } from "@/components/shared/list-controls";
import { OrderCard } from "@/components/preparer/cards";
import { one, oneOf, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Réceptions" };

const GROUP_KEYS = Object.keys(ORDER_GROUPS) as OrderGroup[];

export default async function ReceptionsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePreparer();
  const sp = await searchParams;
  const group = oneOf(sp.groupe, GROUP_KEYS) ?? "recuperer";
  const q = one(sp.q);
  const page = parsePage(sp.page);
  const type = one(sp.type);
  const mode = type === "stock" ? "STOCK" : type === "dropshipping" ? "DROPSHIP" : undefined;
  const { items, total, groupCounts } = await listMyOrders(actor.preparerId, { group, q, page, mode });

  return (
    <div className="space-y-5">
      <PageHeader title="Réceptions" description="Commandes de vos clients attendues à vos points de réception : récupération, contrôle et mise en stock (ou expédition directe pour le dropshipping)." />
      <FilterTabs
        param="type"
        options={[
          { value: "", label: "Toutes" },
          { value: "stock", label: "Pour le stock" },
          { value: "dropshipping", label: "Dropshipping" },
        ]}
      />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterTabs param="groupe" options={GROUP_KEYS.map((g) => ({ value: g === "recuperer" ? "" : g, label: ORDER_GROUPS[g].label, count: groupCounts[g] }))} />
        <SearchInput placeholder="Référence, suivi, code client…" />
      </div>
      {items.length ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/preparateur/receptions" params={{ groupe: one(sp.groupe), q, type }} />
        </>
      ) : (
        <EmptyState icon={PackageCheck} title="Aucune commande ici" description={q ? "Aucun résultat pour cette recherche." : "Les nouvelles commandes de vos clients apparaîtront ici dès leur enregistrement."} />
      )}
    </div>
  );
}

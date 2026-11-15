import type { Metadata } from "next";
import Link from "next/link";
import { Boxes } from "lucide-react";
import type { InventoryStatus } from "@/generated/prisma/enums";
import { requirePreparer } from "@/server/auth/current";
import { listMyItems, PAGE_SIZE } from "@/server/queries/preparer";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusFrom } from "@/components/shared/status-badge";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { INVENTORY_STATUS } from "@/lib/labels";
import { one, oneOf, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Stock" };

const STATUSES = Object.keys(INVENTORY_STATUS) as InventoryStatus[];

function Thumb({ fileId }: { fileId?: string }) {
  return (
    <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
      {fileId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/files/${fileId}`} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <Boxes className="size-5 text-muted-foreground" />
      )}
    </span>
  );
}

export default async function PreparerStockPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePreparer();
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const q = one(sp.q);
  const customerId = one(sp.client);
  const status = oneOf(sp.statut, STATUSES);
  const { items, total, totals, clients } = await listMyItems(actor.preparerId, { customerId, status, q, page });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock"
        description={`${(totals._sum.quantityAvailable ?? 0) + (totals._sum.quantityReserved ?? 0)} article(s) stocké(s) chez vous, dont ${totals._sum.quantityReserved ?? 0} réservé(s) pour des expéditions.`}
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput placeholder="Nom, SKU, emplacement…" />
        <FilterSelect param="client" placeholder="Tous les clients" options={clients.map((c) => ({ value: c.id, label: `${c.referenceCode} — ${c.user.firstName} ${c.user.lastName}` }))} />
        <FilterSelect param="statut" placeholder="Tous les statuts" options={STATUSES.map((s) => ({ value: s, label: INVENTORY_STATUS[s].label }))} />
      </div>
      {items.length ? (
        <>
          <ul className="grid gap-2 md:hidden">
            {items.map((i) => (
              <li key={i.id}>
                <Link href={`/preparateur/stock/${i.id}`} className="flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-soft">
                  <Thumb fileId={i.files[0]?.id} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{i.customer.referenceCode}</span> · {i.storageLocation ?? "sans emplacement"}
                    </p>
                    <p className="text-xs text-muted-foreground tabular">
                      {i.quantityAvailable} dispo · {i.quantityReserved} réservé · {i.quantityShipped} expédié
                    </p>
                  </div>
                  <StatusFrom map={INVENTORY_STATUS} value={i.status} />
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-2xl border bg-card shadow-soft md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Article</th>
                    <th className="px-3 py-2.5 text-left font-medium">Client</th>
                    <th className="px-3 py-2.5 text-left font-medium">Emplacement</th>
                    <th className="px-3 py-2.5 text-right font-medium">Dispo</th>
                    <th className="px-3 py-2.5 text-right font-medium">Réservé</th>
                    <th className="px-3 py-2.5 text-right font-medium">Expédié</th>
                    <th className="px-4 py-2.5 text-left font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((i) => (
                    <tr key={i.id} className="hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <Link href={`/preparateur/stock/${i.id}`} className="flex items-center gap-3">
                          <Thumb fileId={i.files[0]?.id} />
                          <span className="min-w-0">
                            <span className="block font-medium">{i.name}</span>
                            <span className="font-mono text-xs text-muted-foreground">{i.sku}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs">{i.customer.referenceCode}</span>
                        <span className="block text-xs text-muted-foreground">
                          {i.customer.user.firstName} {i.customer.user.lastName}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs">{i.storageLocation ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular">{i.quantityAvailable}</td>
                      <td className="px-3 py-2.5 text-right tabular">{i.quantityReserved}</td>
                      <td className="px-3 py-2.5 text-right tabular">{i.quantityShipped}</td>
                      <td className="px-4 py-2.5">
                        <StatusFrom map={INVENTORY_STATUS} value={i.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/preparateur/stock" params={{ q, client: customerId, statut: status }} />
        </>
      ) : (
        <EmptyState icon={Boxes} title="Aucun article" description={q || customerId || status ? "Aucun article ne correspond à ces filtres." : "Les articles apparaissent ici après la mise en stock des commandes réceptionnées."} />
      )}
    </div>
  );
}

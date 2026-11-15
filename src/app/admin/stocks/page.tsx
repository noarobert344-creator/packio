import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, PackageCheck, PackageX, Truck, Warehouse } from "lucide-react";
import type { InventoryStatus } from "@/generated/prisma/enums";
import { requireAdmin } from "@/server/auth/current";
import { PAGE_SIZE, filterOptions, listInventory, preparerStorageUsage } from "@/server/queries/admin-ops";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomerLink, ExportLink, PreparerLink, UsageMeter } from "@/components/admin/ops/ui";
import { INVENTORY_STATUS, PREPARER_STATUS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { one, oneOf, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Stocks" };

const STATUSES = Object.keys(INVENTORY_STATUS) as InventoryStatus[];

export default async function AdminStocksPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("operations.read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const f = { q: one(sp.q), status: oneOf(sp.statut, STATUSES), preparerId: one(sp.preparateur), customer: one(sp.client) };
  const [{ items, total, totals }, usage, options] = await Promise.all([listInventory({ ...f, page }), preparerStorageUsage(), filterOptions()]);
  const s = totals._sum;

  return (
    <>
      <PageHeader title="Stocks" description="Articles stockés chez les préparateurs, pour l'ensemble des clients." actions={<ExportLink entity="stocks" />} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Unités disponibles" value={s.quantityAvailable ?? 0} icon={Boxes} tone="brand" hint={`${totals._count} référence(s)`} />
        <StatCard label="Unités réservées" value={s.quantityReserved ?? 0} icon={PackageCheck} hint="Pour des expéditions en cours" />
        <StatCard label="Unités expédiées" value={s.quantityShipped ?? 0} icon={Truck} tone="success" />
        <StatCard label="Abîmées / manquantes" value={`${s.quantityDamaged ?? 0} / ${s.quantityMissing ?? 0}`} icon={PackageX} tone={(s.quantityDamaged ?? 0) + (s.quantityMissing ?? 0) > 0 ? "danger" : "default"} />
      </div>

      <Section title="Occupation des préparateurs" description="Unités stockées (disponibles + réservées) rapportées à la capacité déclarée." className="mb-6">
        {usage.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun préparateur.</p>
        ) : (
          <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {usage.map((p) => (
              <li key={p.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/admin/preparateurs/${p.id}`} className="truncate font-medium hover:underline">
                    {p.name}
                  </Link>
                  <StatusFrom map={PREPARER_STATUS} value={p.status} />
                </div>
                <UsageMeter value={p.units} max={p.capacity} label="Capacité de stockage" />
                <p className="text-xs text-muted-foreground">
                  {p.city} · {p.items} référence(s)
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SearchInput placeholder="Article, SKU, emplacement…" />
        <SearchInput param="client" placeholder="Client (nom, code, e-mail)" />
        <FilterSelect param="statut" options={STATUSES.map((v) => ({ value: v, label: INVENTORY_STATUS[v].label }))} placeholder="Tous les statuts" />
        <FilterSelect param="preparateur" options={options.preparers} placeholder="Tous les préparateurs" />
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Warehouse} title="Aucun article" description="Aucun article ne correspond à ces critères." />
      ) : (
        <Section contentClassName="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Article</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Préparateur</TableHead>
                <TableHead className="text-right">Dispo.</TableHead>
                <TableHead className="text-right">Réservé</TableHead>
                <TableHead className="text-right">Expédié</TableHead>
                <TableHead>Emplacement</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="pr-5">Reçu le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="pl-5">
                    <Link href={`/admin/stocks/${it.id}`} className="flex items-center gap-3">
                      {it.files[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/files/${it.files[0].id}`} alt="" className="size-9 shrink-0 rounded-lg border object-cover" loading="lazy" />
                      ) : (
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Boxes className="size-4 text-muted-foreground" />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block max-w-56 truncate font-medium hover:underline">{it.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{it.sku}</span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <CustomerLink customer={it.customer} />
                  </TableCell>
                  <TableCell>
                    <PreparerLink preparer={it.preparer} />
                  </TableCell>
                  <TableCell className="text-right tabular">{it.quantityAvailable}</TableCell>
                  <TableCell className="text-right tabular">{it.quantityReserved}</TableCell>
                  <TableCell className="text-right tabular">{it.quantityShipped}</TableCell>
                  <TableCell className="text-muted-foreground">{it.storageLocation ?? "—"}</TableCell>
                  <TableCell>
                    <StatusFrom map={INVENTORY_STATUS} value={it.status} />
                  </TableCell>
                  <TableCell className="pr-5 text-muted-foreground">{formatDate(it.receivedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin/stocks" params={{ q: f.q, statut: f.status, preparateur: f.preparerId, client: f.customer }} />
    </>
  );
}

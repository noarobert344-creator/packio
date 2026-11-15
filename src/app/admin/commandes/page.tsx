import type { Metadata } from "next";
import Link from "next/link";
import { Package } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { ORDER_GROUPS, PAGE_SIZE, filterOptions, listOrders } from "@/server/queries/admin-ops";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, FilterTabs, Pagination, SearchInput } from "@/components/shared/list-controls";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomerLink, ExportLink, PreparerLink } from "@/components/admin/ops/ui";
import { SUPPLIER_ORDER_STATUS, carrierLabel } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { one, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Commandes" };

export default async function AdminOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("operations.read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const f = { q: one(sp.q), group: one(sp.groupe), supplierId: one(sp.fournisseur), preparerId: one(sp.preparateur) };
  const [{ items, total, groupCounts, all }, options] = await Promise.all([listOrders({ ...f, page }), filterOptions()]);

  return (
    <>
      <PageHeader
        title="Commandes fournisseurs"
        description="Toutes les commandes déclarées par les clients, de l'enregistrement à la mise en stock."
        actions={<ExportLink entity="commandes" />}
      />
      <div className="mb-4 space-y-3">
        <FilterTabs
          param="groupe"
          options={[{ value: "", label: "Toutes", count: all }, ...Object.entries(ORDER_GROUPS).map(([value, g]) => ({ value, label: g.label, count: groupCounts[value] }))]}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <SearchInput placeholder="Référence, suivi, client, article…" />
          <FilterSelect param="fournisseur" options={options.suppliers} placeholder="Tous les fournisseurs" />
          <FilterSelect param="preparateur" options={options.preparers} placeholder="Tous les préparateurs" />
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Package} title="Aucune commande" description="Aucune commande ne correspond à ces critères." />
      ) : (
        <Section contentClassName="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Référence</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Fournisseur</TableHead>
                <TableHead className="min-w-56">Article</TableHead>
                <TableHead>Préparateur</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Suivi</TableHead>
                <TableHead className="pr-5">Créée le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="pl-5 font-mono text-xs">
                    <Link href={`/admin/commandes/${o.id}`} className="font-medium hover:underline">
                      {o.reference}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <CustomerLink customer={o.customer} />
                  </TableCell>
                  <TableCell>{o.supplier.code === "OTHER" ? (o.supplierLabel ?? o.supplier.name) : o.supplier.name}</TableCell>
                  <TableCell className="max-w-72">
                    <span className="line-clamp-2 whitespace-normal">{o.description}</span>
                    <span className="text-xs text-muted-foreground">Qté {o.quantity}</span>
                  </TableCell>
                  <TableCell>
                    <PreparerLink preparer={o.preparer} />
                  </TableCell>
                  <TableCell>
                    <StatusFrom map={SUPPLIER_ORDER_STATUS} value={o.status} />
                  </TableCell>
                  <TableCell className="text-xs">
                    {o.trackingNumber ? (
                      <>
                        <span className="font-mono">{o.trackingNumber}</span>
                        <span className="block text-muted-foreground">{carrierLabel(o.carrier)}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-muted-foreground">{formatDate(o.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin/commandes" params={{ q: f.q, groupe: f.group, fournisseur: f.supplierId, preparateur: f.preparerId }} />
    </>
  );
}

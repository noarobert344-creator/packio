import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { PAGE_SIZE, SHIPMENT_GROUPS, filterOptions, listShipments } from "@/server/queries/admin-ops";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, FilterTabs, Pagination, SearchInput } from "@/components/shared/list-controls";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomerLink, ExportLink, PreparerLink } from "@/components/admin/ops/ui";
import { CREDIT_STATE, PARCEL_SIZE, SHIPMENT_STATUS, carrierLabel } from "@/lib/labels";
import { formatCredits, formatDate } from "@/lib/format";
import { one, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Expéditions" };

export default async function AdminShipmentsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("operations.read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const f = { q: one(sp.q), group: one(sp.groupe), preparerId: one(sp.preparateur) };
  const [{ items, total, groupCounts, all }, options] = await Promise.all([listShipments({ ...f, page }), filterOptions()]);

  return (
    <>
      <PageHeader title="Expéditions" description="Demandes d'expédition des clients, classification, débit des crédits et suivi transporteur." actions={<ExportLink entity="expeditions" />} />
      <div className="mb-4 space-y-3">
        <FilterTabs
          param="groupe"
          options={[{ value: "", label: "Toutes", count: all }, ...Object.entries(SHIPMENT_GROUPS).map(([value, g]) => ({ value, label: g.label, count: groupCounts[value] }))]}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <SearchInput placeholder="Référence, suivi, destinataire, client…" />
          <FilterSelect param="preparateur" options={options.preparers} placeholder="Tous les préparateurs" />
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={Truck} title="Aucune expédition" description="Aucune expédition ne correspond à ces critères." />
      ) : (
        <Section contentClassName="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Référence</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Destinataire</TableHead>
                <TableHead>Préparateur</TableHead>
                <TableHead>Colis</TableHead>
                <TableHead>Crédits</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Suivi</TableHead>
                <TableHead className="pr-5">Demandée le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="pl-5 font-mono text-xs">
                    <Link href={`/admin/expeditions/${s.id}`} className="font-medium hover:underline">
                      {s.reference}
                    </Link>
                    <span className="block font-sans text-muted-foreground">{s._count.items} article(s)</span>
                  </TableCell>
                  <TableCell>
                    <CustomerLink customer={s.customer} />
                  </TableCell>
                  <TableCell>
                    <span className="block">{s.recipientName}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.postalCode} {s.city}
                    </span>
                  </TableCell>
                  <TableCell>
                    <PreparerLink preparer={s.preparer} />
                  </TableCell>
                  <TableCell>{s.sizeCategory ? PARCEL_SIZE[s.sizeCategory].short : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-xs">
                    {s.creditCost !== null ? formatCredits(s.creditCost) : "—"}
                    <span className="block text-muted-foreground">{CREDIT_STATE[s.creditState].label}</span>
                  </TableCell>
                  <TableCell>
                    <StatusFrom map={SHIPMENT_STATUS} value={s.status} />
                  </TableCell>
                  <TableCell className="text-xs">
                    {s.trackingNumber ? (
                      <>
                        <span className="font-mono">{s.trackingNumber}</span>
                        <span className="block text-muted-foreground">{carrierLabel(s.carrier)}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-5 text-muted-foreground">{formatDate(s.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin/expeditions" params={{ q: f.q, groupe: f.group, preparateur: f.preparerId }} />
    </>
  );
}

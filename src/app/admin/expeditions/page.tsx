import type { Metadata } from "next";
import Link from "next/link";
import { Timer, Truck } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { PAGE_SIZE, SHIPMENT_GROUPS, filterOptions, listShipments } from "@/server/queries/admin-ops";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, FilterTabs, Pagination, SearchInput } from "@/components/shared/list-controls";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomerLink, ExportLink, PreparerLink } from "@/components/admin/ops/ui";
import { CREDIT_STATE, PARCEL_SIZE, SHIPMENT_KIND, SHIPMENT_STATUS, carrierLabel } from "@/lib/labels";
import { formatCredits, formatDate, formatDateTime } from "@/lib/format";
import { nowMs } from "@/server/lib/clock";
import { one, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Expéditions" };

export default async function AdminShipmentsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("operations.read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const late = one(sp.retard) === "1";
  const f = { q: one(sp.q), group: one(sp.groupe), preparerId: one(sp.preparateur), late };
  const [{ items, total, groupCounts, all, lateCount }, options] = await Promise.all([listShipments({ ...f, page }), filterOptions()]);
  const now = nowMs();

  return (
    <>
      <PageHeader title="Expéditions" description="Demandes d'expédition des clients, classification, débit des crédits et suivi transporteur." actions={<ExportLink entity="expeditions" />} />
      <div className="mb-4 space-y-3">
        <FilterTabs
          param="groupe"
          options={[{ value: "", label: "Toutes", count: all }, ...Object.entries(SHIPMENT_GROUPS).map(([value, g]) => ({ value, label: g.label, count: groupCounts[value] }))]}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Link
            href={late ? "/admin/expeditions" : "/admin/expeditions?retard=1"}
            className={
              late
                ? "inline-flex h-9 items-center gap-1.5 rounded-lg border border-danger/40 bg-danger-soft px-3 text-sm font-medium text-danger"
                : "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted"
            }
          >
            <Timer className="size-4" /> Hors délai 48 h ({lateCount})
          </Link>
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
                    {s.kind !== "SALE" && <span className="mt-1 block font-sans text-xs text-brand">{SHIPMENT_KIND[s.kind].label}</span>}
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
                    {s.dueAt && ["REQUESTED", "AWAITING_CLASSIFICATION", "CLASSIFIED", "PREPARING", "READY", "LABEL_READY"].includes(s.status) && (
                      <span className={s.dueAt.getTime() < now ? "mt-1 block text-xs font-medium text-danger" : "mt-1 block text-xs text-muted-foreground"}>
                        {s.dueAt.getTime() < now ? "En retard · " : "Avant le "}
                        {formatDateTime(s.dueAt)}
                      </span>
                    )}
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

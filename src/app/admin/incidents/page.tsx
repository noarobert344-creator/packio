import type { Metadata } from "next";
import Link from "next/link";
import { Siren } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { listIncidentsForAdmin, PAGE_SIZE } from "@/server/queries/admin-people";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, FilterTabs, Pagination, SearchInput } from "@/components/shared/list-controls";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableWrap } from "@/components/admin/people/display";
import { INCIDENT_PRIORITY, INCIDENT_STATUS, INCIDENT_TYPE } from "@/lib/labels";
import { formatDateTime, fullName } from "@/lib/format";
import { one, oneOf, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Incidents — Administration" };

const STATUSES = Object.keys(INCIDENT_STATUS) as (keyof typeof INCIDENT_STATUS)[];
const TYPES = Object.keys(INCIDENT_TYPE) as (keyof typeof INCIDENT_TYPE)[];
const PRIORITIES = Object.keys(INCIDENT_PRIORITY) as (keyof typeof INCIDENT_PRIORITY)[];

export default async function AdminIncidentsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("incidents.manage");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const q = one(sp.q);
  const status = oneOf(sp.statut, STATUSES);
  const type = oneOf(sp.type, TYPES);
  const priority = oneOf(sp.priorite, PRIORITIES);
  const { rows, total, counts } = await listIncidentsForAdmin({ q, status, type, priority, page });
  const all = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Incidents" description="Colis abîmés ou manquants, problèmes de locker, contestations de classification, écarts de stock…" />
      <FilterTabs
        param="statut"
        options={[{ value: "", label: "Tous", count: all }, ...STATUSES.map((s) => ({ value: s, label: INCIDENT_STATUS[s].label, count: counts[s] ?? 0 }))]}
      />
      <Section contentClassName="p-0">
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center">
          <SearchInput placeholder="Référence ou titre…" />
          <div className="flex flex-wrap gap-2">
            <FilterSelect className="min-w-0 flex-1 sm:flex-none" param="type" placeholder="Tous les types" options={TYPES.map((t) => ({ value: t, label: INCIDENT_TYPE[t] }))} />
            <FilterSelect className="min-w-0 flex-1 sm:flex-none" param="priorite" placeholder="Toutes priorités" options={PRIORITIES.map((p) => ({ value: p, label: INCIDENT_PRIORITY[p].label }))} />
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={Siren} title="Aucun incident" description="Aucun incident ne correspond à ces critères." />
          </div>
        ) : (
          <div className="px-5">
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Incident</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Préparateur</TableHead>
                    <TableHead>Priorité</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Pris en charge</TableHead>
                    <TableHead>Signalé le</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="max-w-72">
                        <Link href={`/admin/incidents/${i.id}`} className="font-medium hover:underline">
                          {i.reference}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">{i.title}</p>
                      </TableCell>
                      <TableCell className="text-sm">{INCIDENT_TYPE[i.type]}</TableCell>
                      <TableCell className="text-sm">{i.customer ? `${fullName(i.customer.user)} (${i.customer.referenceCode})` : "—"}</TableCell>
                      <TableCell className="text-sm">{i.preparer ? fullName(i.preparer.user) : "—"}</TableCell>
                      <TableCell>
                        <StatusFrom map={INCIDENT_PRIORITY} value={i.priority} />
                      </TableCell>
                      <TableCell>
                        <StatusFrom map={INCIDENT_STATUS} value={i.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{i.assignedTo ? fullName(i.assignedTo) : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDateTime(i.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          </div>
        )}
        <div className="px-5 pb-4">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin/incidents" params={{ q, statut: status, type, priorite: priority }} />
        </div>
      </Section>
    </div>
  );
}

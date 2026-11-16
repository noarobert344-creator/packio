import type { Metadata } from "next";
import Link from "next/link";
import { Download, Users } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { listCustomersForAdmin, PAGE_SIZE } from "@/server/queries/admin-people";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssignmentStateBadge, DemoBadge, TableWrap } from "@/components/admin/people/display";
import { ASSIGNMENT_STATE, CUSTOMER_STATUS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { one, oneOf, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Clients — Administration" };

const STATUSES = Object.keys(CUSTOMER_STATUS) as (keyof typeof CUSTOMER_STATUS)[];
const STATES = Object.keys(ASSIGNMENT_STATE) as (keyof typeof ASSIGNMENT_STATE)[];

export default async function AdminCustomersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin("customers.read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const q = one(sp.q);
  const status = oneOf(sp.statut, STATUSES);
  const assignment = oneOf(sp.attribution, STATES);
  const { rows, total } = await listCustomersForAdmin({ q, status, assignment, page });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Comptes clients, abonnements, attributions et soldes de crédits."
        actions={
          <Button asChild variant="outline">
            <a href="/api/admin/export/clients" download>
              <Download /> Exporter en CSV
            </a>
          </Button>
        }
      />
      <Section contentClassName="p-0">
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center">
          <SearchInput placeholder="Nom, e-mail, code client, société…" />
          <div className="flex flex-wrap gap-2">
            <FilterSelect className="min-w-0 flex-1 sm:flex-none" param="statut" placeholder="Tous les statuts" options={STATUSES.map((s) => ({ value: s, label: CUSTOMER_STATUS[s].label }))} />
            <FilterSelect className="min-w-0 flex-1 sm:flex-none" param="attribution" placeholder="Toutes les attributions" options={STATES.map((s) => ({ value: s, label: ASSIGNMENT_STATE[s].label }))} />
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={Users} title="Aucun client" description={q || status || assignment ? "Aucun client ne correspond à ces filtres." : "Les clients apparaîtront ici après leur inscription."} />
          </div>
        ) : (
          <div className="px-5">
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Offre</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Attribution</TableHead>
                    <TableHead>Préparateur</TableHead>
                    <TableHead className="text-right">Crédits dispo.</TableHead>
                    <TableHead>Inscription</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link href={`/admin/clients/${c.id}`} className="font-medium hover:underline">
                          {c.user.firstName} {c.user.lastName}
                        </Link>
                        <DemoBadge show={c.user.isDemo} />
                        <p className="text-xs text-muted-foreground">{c.companyName ?? c.user.email}</p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.referenceCode}</TableCell>
                      <TableCell className="text-sm">{c.subscriptions[0]?.plan.name ?? "—"}</TableCell>
                      <TableCell>
                        <StatusFrom map={CUSTOMER_STATUS} value={c.status} />
                      </TableCell>
                      <TableCell>
                        <AssignmentStateBadge customer={c} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.currentPreparer ? (
                          <span className="flex flex-col">
                            <Link href={`/admin/preparateurs/${c.currentPreparer.id}`} className="hover:underline">
                              {c.currentPreparer.user.firstName} {c.currentPreparer.user.lastName}
                            </Link>
                            <Link href={`/admin/clients/${c.id}?changer-preparateur=1`} className="text-xs text-brand hover:underline">
                              Changer
                            </Link>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular">{c.wallet ? c.wallet.monthlyBalance + c.wallet.purchasedBalance : 0}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(c.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          </div>
        )}
        <div className="px-5 pb-4">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin/clients" params={{ q, statut: status, attribution: assignment }} />
        </div>
      </Section>
    </div>
  );
}

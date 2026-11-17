import type { Metadata } from "next";
import Link from "next/link";
import { Download, Users } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import {
  countCustomersByView,
  CUSTOMER_VIEWS,
  listCustomersForAdmin,
  PAGE_SIZE,
  type CustomerView,
} from "@/server/queries/admin-people";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import {
  FilterSelect,
  FilterTabs,
  Pagination,
  SearchInput,
} from "@/components/shared/list-controls";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AssignmentStateBadge,
  DemoBadge,
  TableWrap,
} from "@/components/admin/people/display";
import { ActivateSubscriptionDialog } from "@/components/admin/people/activate-subscription-dialog";
import { can } from "@/server/auth/actor";
import { db } from "@/server/db";
import { ASSIGNMENT_STATE, CUSTOMER_STATUS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { one, oneOf, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Clients — Administration" };

const VIEWS = Object.keys(CUSTOMER_VIEWS).filter(
  (v) => v !== "actifs",
) as CustomerView[];
const STATES = Object.keys(
  ASSIGNMENT_STATE,
) as (keyof typeof ASSIGNMENT_STATE)[];

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const actor = await requireAdmin("customers.read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const q = one(sp.q);
  // Sans paramètre : vrais clients actifs uniquement.
  const view: CustomerView = oneOf(sp.vue, VIEWS) ?? "actifs";
  const assignment = oneOf(sp.attribution, STATES);
  const [{ rows, total }, counts, plans] = await Promise.all([
    listCustomersForAdmin({ q, view, assignment, page }),
    countCustomersByView(),
    db.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, monthlyCredits: true },
    }),
  ]);
  const canActivate = can(actor, "billing.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Clients avec un abonnement payé et actif. Les inscrits qui n'ont pas payé sont dans l'onglet « Inscrits sans paiement »."
        actions={
          <Button asChild variant="outline">
            <a href="/api/admin/export/clients" download>
              <Download /> Exporter en CSV
            </a>
          </Button>
        }
      />
      <Section contentClassName="p-0">
        <div className="space-y-3 border-b p-4">
          <FilterTabs
            param="vue"
            options={(Object.keys(CUSTOMER_VIEWS) as CustomerView[]).map(
              (v) => ({
                value: v === "actifs" ? "" : v,
                label: CUSTOMER_VIEWS[v].label,
                count: counts[v],
              }),
            )}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput placeholder="Nom, e-mail, code client, société…" />
            <FilterSelect
              className="min-w-0 sm:flex-none"
              param="attribution"
              placeholder="Toutes les attributions"
              options={STATES.map((s) => ({
                value: s,
                label: ASSIGNMENT_STATE[s].label,
              }))}
            />
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Users}
              title={view === "actifs" ? "Aucun client actif" : "Aucun client"}
              description={
                q || assignment
                  ? "Aucun client ne correspond à ces filtres."
                  : view === "actifs"
                    ? "Vos clients apparaîtront ici dès leur premier paiement."
                    : "Aucun client dans cette catégorie."
              }
            />
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
                    {canActivate && (
                      <TableHead className="text-right">Abonnement</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link
                          href={`/admin/clients/${c.id}`}
                          className="font-medium hover:underline"
                        >
                          {c.user.firstName} {c.user.lastName}
                        </Link>
                        <DemoBadge show={c.user.isDemo} />
                        <p className="text-xs text-muted-foreground">
                          {c.companyName ?? c.user.email}
                        </p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.referenceCode}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.subscriptions[0]?.plan.name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <StatusFrom map={CUSTOMER_STATUS} value={c.status} />
                      </TableCell>
                      <TableCell>
                        <AssignmentStateBadge customer={c} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.currentPreparer ? (
                          <span className="flex flex-col">
                            <Link
                              href={`/admin/preparateurs/${c.currentPreparer.id}`}
                              className="hover:underline"
                            >
                              {c.currentPreparer.user.firstName}{" "}
                              {c.currentPreparer.user.lastName}
                            </Link>
                            <Link
                              href={`/admin/clients/${c.id}?changer-preparateur=1`}
                              className="text-xs text-brand hover:underline"
                            >
                              Changer
                            </Link>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular">
                        {c.wallet
                          ? c.wallet.monthlyBalance + c.wallet.purchasedBalance
                          : 0}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(c.createdAt)}
                      </TableCell>
                      {canActivate && (
                        <TableCell className="text-right">
                          {c.status === "PENDING_PAYMENT" ||
                          c.status === "CANCELED" ? (
                            <ActivateSubscriptionDialog
                              customerId={c.id}
                              customerLabel={`${c.user.firstName} ${c.user.lastName} (${c.referenceCode})`}
                              plans={plans}
                              size="xs"
                            />
                          ) : null}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          </div>
        )}
        <div className="px-5 pb-4">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            basePath="/admin/clients"
            params={{
              q,
              vue: view === "actifs" ? undefined : view,
              attribution: assignment,
            }}
          />
        </div>
      </Section>
    </div>
  );
}

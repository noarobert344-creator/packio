import type { Metadata } from "next";
import Link from "next/link";
import { Siren } from "lucide-react";
import { requirePreparer } from "@/server/auth/current";
import { listMyIncidents, PAGE_SIZE } from "@/server/queries/preparer";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusFrom } from "@/components/shared/status-badge";
import { FilterTabs, Pagination } from "@/components/shared/list-controls";
import { ReportIncidentDialog } from "@/components/incidents/incident-dialog";
import { INCIDENT_PRIORITY, INCIDENT_STATUS, INCIDENT_TYPE } from "@/lib/labels";
import { formatRelative } from "@/lib/format";
import { one, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Incidents" };

export default async function PreparerIncidentsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePreparer();
  const sp = await searchParams;
  const status = one(sp.statut) === "fermes" ? "fermes" : undefined;
  const page = parsePage(sp.page);
  const { items, total, open, closed } = await listMyIncidents(actor.preparerId, { status, page });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Incidents"
        description="Problèmes signalés sur vos réceptions, votre stock ou vos expéditions, et leur suivi avec l'équipe Packio."
        actions={<ReportIncidentDialog types={["OTHER", "LOCKER_ISSUE", "STOCK_DISCREPANCY"]} label="Signaler un incident" />}
      />
      <FilterTabs
        param="statut"
        options={[
          { value: "", label: "En cours", count: open },
          { value: "fermes", label: "Résolus et clôturés", count: closed },
        ]}
      />
      {items.length ? (
        <>
          <ul className="grid gap-2">
            {items.map((i) => (
              <li key={i.id}>
                <Link href={`/preparateur/incidents/${i.id}`} className="flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-soft transition-colors hover:border-foreground/20 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{i.reference}</span> · {INCIDENT_TYPE[i.type]} · {formatRelative(i.createdAt)}
                    </p>
                    <p className="truncate font-medium">{i.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.customer ? `${i.customer.referenceCode} — ${i.customer.user.firstName} ${i.customer.user.lastName}` : "Sans client associé"}
                      {i.supplierOrder && ` · ${i.supplierOrder.reference}`}
                      {i.shipment && ` · ${i.shipment.reference}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {(i.priority === "HIGH" || i.priority === "URGENT") && <StatusFrom map={INCIDENT_PRIORITY} value={i.priority} />}
                    <StatusFrom map={INCIDENT_STATUS} value={i.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/preparateur/incidents" params={{ statut: status }} />
        </>
      ) : (
        <EmptyState icon={Siren} title={status ? "Aucun incident clôturé" : "Aucun incident en cours"} description="Signalez tout problème de locker, de stock ou d'expédition : l'équipe Packio le prend en charge." />
      )}
    </div>
  );
}

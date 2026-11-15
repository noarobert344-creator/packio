import type { Metadata } from "next";
import Link from "next/link";
import { Siren } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ReportIncidentDialog } from "@/components/incidents/incident-dialog";
import { requireCustomer } from "@/server/auth/current";
import { db } from "@/server/db";
import { INCIDENT_STATUS, INCIDENT_TYPE } from "@/lib/labels";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Incidents" };

export default async function ClientIncidentsPage() {
  const actor = await requireCustomer();
  const incidents = await db.incident.findMany({ where: { customerId: actor.customerId }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div className="space-y-6">
      <PageHeader title="Incidents" description="Signalements liés à vos commandes, votre stock ou vos expéditions, et leur traitement." actions={<ReportIncidentDialog types={["OTHER", "SHIPMENT_ISSUE", "LOCKER_ISSUE", "PAYMENT"]} />} />
      {incidents.length ? (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
          <ul className="divide-y">
            {incidents.map((i) => (
              <li key={i.id}>
                <Link href={`/client/incidents/${i.id}`} className="flex flex-col gap-2 px-5 py-4 hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{i.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.reference} · {INCIDENT_TYPE[i.type]} · {formatDate(i.createdAt)}
                    </p>
                  </div>
                  <StatusFrom map={INCIDENT_STATUS} value={i.status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState icon={Siren} title="Aucun incident" description="Tout se passe bien ! En cas de problème, signalez-le depuis la commande ou l'expédition concernée." />
      )}
    </div>
  );
}

import Link from "next/link";
import { Lock } from "lucide-react";
import type { getIncidentForActor } from "@/server/services/incidents";
import { INCIDENT_PRIORITY, INCIDENT_STATUS, INCIDENT_TYPE } from "@/lib/labels";
import { formatDateTime, fullName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { FileThumbs } from "@/components/shared/file-uploader";
import { IncidentReplyForm } from "./incident-reply-form";

type Incident = Awaited<ReturnType<typeof getIncidentForActor>>;

/** Fiche incident partagée par les trois espaces (liens adaptés à l'espace). */
export function IncidentDetail({
  incident,
  space,
  backHref,
}: {
  incident: Incident;
  space: "client" | "preparateur" | "admin";
  backHref: string;
}) {
  const isAdmin = space === "admin";
  const orderHref = space === "client" ? "/client/commandes/" : space === "preparateur" ? "/preparateur/receptions/" : "/admin/commandes/";
  const shipmentHref = `/${space}/expeditions/`;
  const closed = incident.status === "CLOSED";
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: backHref, label: "Incidents" }}
        eyebrow={incident.reference}
        title={incident.title}
        description={`${INCIDENT_TYPE[incident.type]} · signalé le ${formatDateTime(incident.createdAt)} par ${fullName(incident.reportedBy)}`}
        actions={
          <div className="flex gap-2">
            <StatusFrom map={INCIDENT_STATUS} value={incident.status} />
            {isAdmin && <StatusFrom map={INCIDENT_PRIORITY} value={incident.priority} />}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Section title="Description">
            <p className="text-sm whitespace-pre-wrap">{incident.description}</p>
            {incident.files.length > 0 && (
              <div className="mt-4">
                <FileThumbs files={incident.files} />
              </div>
            )}
            {incident.resolution && (
              <div className="mt-4 rounded-xl bg-success-soft p-3 text-sm text-success">
                <p className="font-medium">Résolution</p>
                <p className="whitespace-pre-wrap">{incident.resolution}</p>
              </div>
            )}
          </Section>
          <Section title="Échanges" description="Suivi du traitement de l'incident.">
            <ol className="space-y-4">
              {incident.updates.length === 0 && <li className="text-sm text-muted-foreground">Aucun échange pour le moment.</li>}
              {incident.updates.map((u) => (
                <li key={u.id} className={cn("rounded-xl border p-3.5", u.internal && "border-warning/40 bg-warning-soft/40")}>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {u.author.role === "ADMIN" ? `Équipe Packio (${u.author.firstName})` : fullName(u.author)}
                      {u.internal && (
                        <span className="ml-2 inline-flex items-center gap-1 text-warning">
                          <Lock className="size-3" /> Note interne
                        </span>
                      )}
                    </span>
                    <time>{formatDateTime(u.createdAt)}</time>
                  </div>
                  {u.statusTo && (
                    <p className="mb-1 text-xs">
                      Statut : <StatusFrom map={INCIDENT_STATUS} value={u.statusTo} />
                    </p>
                  )}
                  <p className="text-sm whitespace-pre-wrap">{u.body}</p>
                </li>
              ))}
            </ol>
            {!closed || isAdmin ? <IncidentReplyForm incidentId={incident.id} isAdmin={isAdmin} currentStatus={incident.status} /> : null}
          </Section>
        </div>
        <Section title="Informations" contentClassName="space-y-3 text-sm">
          {incident.customer && (
            <p>
              <span className="text-muted-foreground">Client : </span>
              {isAdmin ? <Link className="underline-offset-2 hover:underline" href={`/admin/clients/${incident.customer.id}`}>{fullName(incident.customer.user)}</Link> : fullName(incident.customer.user)} ({incident.customer.referenceCode})
            </p>
          )}
          {incident.preparer && (
            <p>
              <span className="text-muted-foreground">Préparateur : </span>
              {isAdmin ? <Link className="underline-offset-2 hover:underline" href={`/admin/preparateurs/${incident.preparer.id}`}>{fullName(incident.preparer.user)}</Link> : fullName(incident.preparer.user)}
            </p>
          )}
          {incident.supplierOrder && (
            <p>
              <span className="text-muted-foreground">Commande : </span>
              <Link className="underline-offset-2 hover:underline" href={`${orderHref}${incident.supplierOrder.id}`}>{incident.supplierOrder.reference}</Link>
            </p>
          )}
          {incident.shipment && (
            <p>
              <span className="text-muted-foreground">Expédition : </span>
              <Link className="underline-offset-2 hover:underline" href={`${shipmentHref}${incident.shipment.id}`}>{incident.shipment.reference}</Link>
            </p>
          )}
          {incident.inventoryItem && (
            <p>
              <span className="text-muted-foreground">Article : </span>
              {incident.inventoryItem.name} ({incident.inventoryItem.sku})
            </p>
          )}
          {incident.assignedTo && (
            <p>
              <span className="text-muted-foreground">Pris en charge par : </span>
              {fullName(incident.assignedTo)}
            </p>
          )}
          {incident.resolvedAt && (
            <p>
              <span className="text-muted-foreground">Résolu le : </span>
              {formatDateTime(incident.resolvedAt)}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}

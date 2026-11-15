import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth/current";
import { getIncidentForActor } from "@/server/services/incidents";
import { getSizeRules } from "@/server/services/shipments";
import { listAdminUsers } from "@/server/queries/admin-people";
import { DomainError } from "@/server/errors";
import { db } from "@/server/db";
import { IncidentDetail } from "@/components/incidents/incident-detail";
import { Section } from "@/components/shared/page-header";
import { IncidentAdminControls, ReclassifyDialog } from "@/components/admin/people/misc-actions";
import { PARCEL_SIZE } from "@/lib/labels";
import { formatCredits } from "@/lib/format";

export const metadata: Metadata = { title: "Incident — Administration" };

export default async function AdminIncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin("incidents.manage");
  const { id } = await params;
  const incident = await getIncidentForActor(actor, id).catch((err) => {
    if (err instanceof DomainError) notFound();
    throw err;
  });
  const [admins, rules, shipment] = await Promise.all([
    listAdminUsers(),
    getSizeRules(),
    incident.shipment ? db.outboundShipment.findUnique({ where: { id: incident.shipment.id }, select: { sizeCategory: true, creditCost: true, creditState: true } }) : null,
  ]);
  const costs = Object.fromEntries(rules.map((r) => [r.size, r.creditCost]));
  const isDispute = incident.type === "CLASSIFICATION_DISPUTE" && incident.shipment;

  return (
    <div className="space-y-6">
      <IncidentDetail incident={incident} space="admin" backHref="/admin/incidents" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Section title="Pilotage" description="Prise en charge et priorité.">
            <IncidentAdminControls
              incidentId={incident.id}
              assignedToId={incident.assignedTo?.id ?? null}
              priority={incident.priority}
              admins={admins.map((a) => ({ id: a.id, name: `${a.firstName} ${a.lastName}${a.staffRole ? ` — ${a.staffRole.name}` : ""}` }))}
            />
          </Section>
          {isDispute && incident.shipment && (
            <Section title="Contestation de classification">
              <div className="grid gap-3 text-sm">
                <p>
                  Classification actuelle :{" "}
                  <span className="font-medium">{shipment?.sizeCategory ? PARCEL_SIZE[shipment.sizeCategory].label : "—"}</span>
                  {shipment?.creditCost !== null && shipment?.creditCost !== undefined && ` · ${formatCredits(shipment.creditCost)}`}
                  {shipment?.creditState === "CAPTURED" && <span className="text-muted-foreground"> (déjà débités)</span>}
                </p>
                <ReclassifyDialog incidentId={incident.id} shipmentId={incident.shipment.id} current={shipment?.sizeCategory ?? null} costs={costs} />
              </div>
            </Section>
          )}
      </div>
    </div>
  );
}

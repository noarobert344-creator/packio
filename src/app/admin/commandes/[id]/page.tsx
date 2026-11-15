import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth/current";
import { getOrderForActor } from "@/server/services/orders";
import { NotFoundError } from "@/server/errors";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge, StatusFrom } from "@/components/shared/status-badge";
import { StepProgress, Timeline } from "@/components/shared/timeline";
import { FileThumbs } from "@/components/shared/file-uploader";
import { InfoList } from "@/components/admin/ops/ui";
import { PickupCode } from "@/components/admin/ops/client";
import { INCIDENT_STATUS, LOCATION_TYPE, SUPPLIER_ORDER_FLOW, SUPPLIER_ORDER_STATUS, carrierLabel, networkLabel } from "@/lib/labels";
import { formatDate, formatDateTime, fullName } from "@/lib/format";

export const metadata: Metadata = { title: "Commande" };

const PARCEL_STATUS = { EXPECTED: "Attendu", AT_LOCKER: "Au locker", PICKED_UP: "Récupéré", RECEIVED: "Réceptionné", ISSUE: "Problème" } as const;

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin("operations.read");
  const { id } = await params;
  const order = await getOrderForActor(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const failed = order.status === "INCIDENT" || order.status === "RETURNED_TO_SUPPLIER" || order.status === "CANCELLED";
  const supplierName = order.supplier.code === "OTHER" ? (order.supplierLabel ?? order.supplier.name) : order.supplier.name;

  return (
    <>
      <PageHeader
        back={{ href: "/admin/commandes", label: "Commandes" }}
        eyebrow={order.reference}
        title={order.description}
        description={`${supplierName} · quantité ${order.quantity} · créée le ${formatDateTime(order.createdAt)}`}
        actions={<StatusFrom map={SUPPLIER_ORDER_STATUS} value={order.status} />}
      />
      <div className="mb-6 rounded-2xl border bg-card p-4 shadow-soft">
        <StepProgress steps={SUPPLIER_ORDER_FLOW.map((s) => ({ key: s, label: SUPPLIER_ORDER_STATUS[s].label }))} current={failed ? "QUALITY_CHECK" : order.status} failed={failed} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Section title="Détails de la commande">
            <InfoList
              items={[
                { label: "Client", value: <Link className="hover:underline" href={`/admin/clients/${order.customerId}`}>{fullName(order.customer.user)} ({order.customer.referenceCode})</Link> },
                { label: "Préparateur", value: <Link className="hover:underline" href={`/admin/preparateurs/${order.preparerId}`}>{fullName(order.preparer.user)}</Link> },
                { label: "Fournisseur", value: supplierName },
                { label: "N° de commande fournisseur", value: order.supplierOrderNumber },
                { label: "Lien de l'article", value: order.articleUrl ? <a href={order.articleUrl} target="_blank" rel="noreferrer noopener" className="break-all text-brand hover:underline">{order.articleUrl}</a> : null },
                { label: "Transporteur / suivi", value: order.trackingNumber ? `${carrierLabel(order.carrier)} — ${order.trackingNumber}` : null },
                { label: "Code de retrait", value: order.pickupCode ? <PickupCode code={order.pickupCode} /> : null },
                { label: "Arrivée estimée", value: order.expectedArrivalAt ? formatDate(order.expectedArrivalAt) : null },
                { label: "Compatibilité confirmée par le client", value: order.supplier.code === "OTHER" ? (order.compatibilityConfirmed ? "Oui" : "Non") : "Vérifiée par les règles fournisseur" },
                { label: "Instructions", value: order.instructions },
              ]}
            />
          </Section>
          <Section title="Colis physiques" description="Une commande peut arriver en plusieurs colis.">
            <ul className="divide-y">
              {order.parcels.map((p, i) => (
                <li key={p.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <p className="font-medium">Colis {i + 1}{p.trackingNumber ? ` · ${p.trackingNumber}` : ""}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.pickedUpAt ? `Récupéré le ${formatDateTime(p.pickedUpAt)}` : "Non récupéré"}
                      {p.receivedAt ? ` · réceptionné le ${formatDateTime(p.receivedAt)}` : ""}
                      {p.quantityReceived !== null ? ` · ${p.quantityReceived} reçu(s)` : ""}
                      {p.conditionOk === false ? " · défaut constaté" : ""}
                    </p>
                    {p.conditionNotes && <p className="text-xs text-muted-foreground">{p.conditionNotes}</p>}
                  </div>
                  <StatusBadge tone={p.status === "ISSUE" ? "danger" : p.status === "RECEIVED" ? "success" : "neutral"} label={PARCEL_STATUS[p.status]} />
                </li>
              ))}
            </ul>
          </Section>
          {order.files.length > 0 && (
            <Section title="Photos et documents">
              <FileThumbs files={order.files} size="lg" />
            </Section>
          )}
          {order.inventoryItems.length > 0 && (
            <Section title="Articles mis en stock">
              <ul className="divide-y text-sm">
                {order.inventoryItems.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <Link href={`/admin/stocks/${it.id}`} className="hover:underline">
                      {it.name} <span className="font-mono text-xs text-muted-foreground">{it.sku}</span>
                    </Link>
                    <span className="text-muted-foreground tabular">
                      {it.quantityAvailable} dispo / {it.quantityReceived} reçu(s)
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
        <div className="space-y-6">
          <Section title="Point de réception">
            <div className="space-y-1 text-sm">
              <p className="font-medium">{order.location.label}</p>
              <p className="text-muted-foreground">{LOCATION_TYPE[order.location.type]}{order.location.network ? ` · ${networkLabel(order.location.network)}` : ""}</p>
              {order.location.relayName && <p>{order.location.relayName}</p>}
              <p>
                {order.location.addressLine1}
                {order.location.addressLine2 ? `, ${order.location.addressLine2}` : ""}
              </p>
              <p>
                {order.location.postalCode} {order.location.city}
              </p>
              <p className="text-xs text-muted-foreground">Destinataire : {order.location.recipientName}</p>
            </div>
          </Section>
          {order.incidents.length > 0 && (
            <Section title="Incidents">
              <ul className="space-y-2 text-sm">
                {order.incidents.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/incidents/${i.id}`} className="truncate hover:underline">
                      {i.reference} — {i.title}
                    </Link>
                    <StatusFrom map={INCIDENT_STATUS} value={i.status} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Historique">
            <Timeline
              entries={order.events.map((e) => ({
                id: e.id,
                label: SUPPLIER_ORDER_STATUS[e.status].label,
                tone: SUPPLIER_ORDER_STATUS[e.status].tone,
                at: e.createdAt,
                actor: e.actor ? `${fullName(e.actor)}${e.actor.role === "ADMIN" ? " (Packio)" : ""}` : "Système",
                note: e.note,
              }))}
            />
          </Section>
        </div>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Info, MapPin, MessagesSquare, Zap } from "lucide-react";
import { requirePreparer } from "@/server/auth/current";
import { getOrderForActor } from "@/server/services/orders";
import { getShipmentConversationId } from "@/server/queries/preparer";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { StepProgress, Timeline } from "@/components/shared/timeline";
import { FileThumbs } from "@/components/shared/file-uploader";
import { CopyButton } from "@/components/shared/copy-button";
import { Button } from "@/components/ui/button";
import { ClientCode, PickupCode } from "@/components/preparer/cards";
import { OrderActionsPanel } from "@/components/preparer/order-actions";
import { INCIDENT_STATUS, LOCATION_TYPE, SUPPLIER_ORDER_FLOW, SUPPLIER_ORDER_STATUS, carrierLabel, networkLabel } from "@/lib/labels";
import { trackingUrl } from "@/lib/tracking";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Réception" };

export default async function ReceptionPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePreparer();
  const { id } = await params;
  const order = await getOrderForActor(actor, id).catch(() => null);
  if (!order || order.preparerId !== actor.preparerId) notFound();
  const conversationId = await getShipmentConversationId(actor.preparerId, order.customerId);
  const supplierName = order.supplier.code === "OTHER" ? (order.supplierLabel ?? "Autre fournisseur") : order.supplier.name;
  const loc = order.location;
  const address = [loc.relayName, loc.addressLine1, loc.addressLine2, `${loc.postalCode} ${loc.city}`].filter(Boolean).join(", ");
  const tracking = trackingUrl(order.carrier, order.trackingNumber);
  const flowStatus = SUPPLIER_ORDER_FLOW.includes(order.status) ? order.status : order.status === "INCIDENT" ? "QUALITY_CHECK" : "IN_STOCK";
  const directDelivery = loc.type === "BUSINESS_ADDRESS";

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/preparateur/receptions", label: "Réceptions" }}
        eyebrow={order.reference}
        title={order.description}
        description={`${supplierName} · quantité ${order.quantity} · enregistrée le ${formatDate(order.createdAt)}`}
        actions={
          <>
            <StatusFrom map={SUPPLIER_ORDER_STATUS} value={order.status} />
            {conversationId && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/preparateur/messages?c=${conversationId}`}>
                  <MessagesSquare /> Contacter le client
                </Link>
              </Button>
            )}
          </>
        }
      />
      {order.mode === "DROPSHIP" && (
        <div className="flex flex-col gap-2 rounded-2xl border border-brand/30 bg-brand-soft p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <Zap className="mt-0.5 size-4 shrink-0 text-brand" />
            <span>
              <span className="font-semibold">Dropshipping : article déjà vendu.</span> À la mise en stock, une expédition express est créée automatiquement
              {order.buyerName ? ` pour ${order.buyerName}` : ""}
              {order.saleReference ? ` (vente ${order.saleReference})` : ""}, à déposer sous 48 h avec le bordereau fourni par le client.
            </span>
          </p>
          {order.dropshipShipmentId && (
            <Button asChild size="sm">
              <Link href={`/preparateur/expeditions/${order.dropshipShipmentId}`}>Ouvrir l&apos;expédition</Link>
            </Button>
          )}
        </div>
      )}
      <div className="rounded-2xl border bg-card p-4 shadow-soft">
        <StepProgress steps={SUPPLIER_ORDER_FLOW.map((s) => ({ key: s, label: SUPPLIER_ORDER_STATUS[s].label }))} current={flowStatus} failed={order.status === "INCIDENT" || order.status === "RETURNED_TO_SUPPLIER" || order.status === "CANCELLED"} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="order-2 space-y-6 lg:order-1">
          <Section title="Identifier le colis" contentClassName="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <ClientCode customer={order.customer} className="text-sm" />
            </div>
            <p className="text-sm text-muted-foreground">Le code client figure en complément du nom du destinataire sur le colis.</p>
            {!directDelivery && (order.pickupCode || ["REGISTERED", "SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER"].includes(order.status)) && <PickupCode code={order.pickupCode} />}
          </Section>

          <Section title="Point de réception" contentClassName="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 size-4 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {loc.label} · {LOCATION_TYPE[loc.type]}
                  {loc.network && <span className="text-muted-foreground"> — {networkLabel(loc.network)}</span>}
                </p>
                <p className="text-muted-foreground">{address}</p>
                {loc.externalId && <p className="text-xs text-muted-foreground">Identifiant : {loc.externalId}</p>}
                {loc.openingHours && <p className="text-xs text-muted-foreground">Horaires : {loc.openingHours}</p>}
              </div>
              <CopyButton value={address} label="Adresse" />
            </div>
          </Section>

          <Section title="Détails de la commande" contentClassName="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Fournisseur : </span>
              {supplierName}
            </p>
            <p>
              <span className="text-muted-foreground">N° de commande : </span>
              {order.supplierOrderNumber ?? "—"}
            </p>
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">Suivi : </span>
              {order.trackingNumber ? (
                <>
                  {carrierLabel(order.carrier)} · <span className="font-mono">{order.trackingNumber}</span>
                  {tracking && (
                    <a href={tracking} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-brand hover:underline">
                      Suivre <ExternalLink className="size-3" />
                    </a>
                  )}
                </>
              ) : (
                "non communiqué"
              )}
            </p>
            {order.expectedArrivalAt && (
              <p>
                <span className="text-muted-foreground">Arrivée estimée : </span>
                {formatDate(order.expectedArrivalAt)}
              </p>
            )}
            {order.articleUrl && (
              <p className="min-w-0 sm:col-span-2">
                <span className="text-muted-foreground">Lien de l&apos;article : </span>
                <a href={order.articleUrl} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 truncate text-brand hover:underline">
                  {order.articleUrl} <ExternalLink className="size-3 shrink-0" />
                </a>
              </p>
            )}
            {order.instructions && (
              <div className="flex gap-2 rounded-xl bg-info-soft p-3 text-info sm:col-span-2">
                <Info className="mt-0.5 size-4 shrink-0" />
                <p className="whitespace-pre-wrap">{order.instructions}</p>
              </div>
            )}
            {order.files.length > 0 && (
              <div className="sm:col-span-2">
                <p className="mb-2 text-muted-foreground">Photos</p>
                <FileThumbs files={order.files} />
              </div>
            )}
          </Section>

          {order.parcels.length > 0 && (
            <Section title="Colis physiques" contentClassName="p-0">
              <ul className="divide-y text-sm">
                {order.parcels.map((p, i) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <span>
                      Colis {i + 1}
                      {p.trackingNumber && <span className="ml-2 font-mono text-xs text-muted-foreground">{p.trackingNumber}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.receivedAt
                        ? `Reçu le ${formatDateTime(p.receivedAt)} · ${p.quantityReceived ?? "?"} article(s) · ${p.conditionOk === false ? "défaut" : "conforme"}`
                        : p.pickedUpAt
                          ? `Récupéré le ${formatDateTime(p.pickedUpAt)}`
                          : "En attente"}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {order.inventoryItems.length > 0 && (
            <Section title="Articles mis en stock" contentClassName="p-0">
              <ul className="divide-y text-sm">
                {order.inventoryItems.map((it) => (
                  <li key={it.id}>
                    <Link href={`/preparateur/stock/${it.id}`} className="flex items-center justify-between gap-2 px-5 py-3 hover:bg-muted/40">
                      <span>
                        {it.name} <span className="font-mono text-xs text-muted-foreground">{it.sku}</span>
                      </span>
                      <span className="text-xs text-muted-foreground tabular">
                        {it.quantityAvailable} dispo / {it.quantityReceived} reçu(s)
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {order.incidents.length > 0 && (
            <Section title="Incidents" contentClassName="p-0">
              <ul className="divide-y text-sm">
                {order.incidents.map((inc) => (
                  <li key={inc.id}>
                    <Link href={`/preparateur/incidents/${inc.id}`} className="flex items-center justify-between gap-2 px-5 py-3 hover:bg-muted/40">
                      <span className="truncate">
                        <span className="font-mono text-xs text-muted-foreground">{inc.reference}</span> {inc.title}
                      </span>
                      <StatusFrom map={INCIDENT_STATUS} value={inc.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Historique">
            <Timeline
              entries={[...order.events].reverse().map((e) => ({
                id: e.id,
                label: SUPPLIER_ORDER_STATUS[e.status].label,
                tone: SUPPLIER_ORDER_STATUS[e.status].tone,
                at: e.createdAt,
                actor: e.actor ? (e.actor.role === "ADMIN" ? "Équipe Packio" : `${e.actor.firstName} ${e.actor.lastName}`) : null,
                note: e.note,
              }))}
            />
          </Section>
        </div>
        <div className="order-1 lg:order-2">
          <div className="lg:sticky lg:top-24">
            <OrderActionsPanel
              orderId={order.id}
              customerId={order.customerId}
              status={order.status}
              quantity={order.quantity}
              description={order.description}
              directDelivery={directDelivery}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

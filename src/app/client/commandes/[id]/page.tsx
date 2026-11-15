import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, MessagesSquare, PackagePlus, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { StepProgress, Timeline } from "@/components/shared/timeline";
import { FileThumbs } from "@/components/shared/file-uploader";
import { OrderActions } from "@/components/client/order-actions";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { getOrderForActor } from "@/server/services/orders";
import { db } from "@/server/db";
import { INCIDENT_STATUS, LOCATION_TYPE, SUPPLIER_ORDER_FLOW, SUPPLIER_ORDER_STATUS, carrierLabel } from "@/lib/labels";
import { trackingUrl } from "@/lib/tracking";
import { formatDate, fullName } from "@/lib/format";

export const metadata: Metadata = { title: "Commande" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireSubscribedCustomer();
  const { id } = await params;
  const order = await getOrderForActor(actor, id).catch(() => null);
  if (!order) notFound();
  const conversation = await db.conversation.findFirst({ where: { type: "CUSTOMER_PREPARER", customerId: order.customerId, preparerId: order.preparerId, status: "OPEN" } });
  const track = trackingUrl(order.carrier, order.trackingNumber);
  const failed = order.status === "INCIDENT" || order.status === "RETURNED_TO_SUPPLIER" || order.status === "CANCELLED";
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/client/commandes", label: "Mes commandes" }}
        eyebrow={order.reference}
        title={order.description}
        description={`${order.supplier.code === "OTHER" ? order.supplierLabel : order.supplier.name} · ${order.quantity} article(s) · enregistrée le ${formatDate(order.createdAt)}`}
        actions={<StatusFrom map={SUPPLIER_ORDER_STATUS} value={order.status} />}
      />
      {order.mode === "DROPSHIP" && (
        <div className="flex flex-col gap-2 rounded-2xl border border-brand/30 bg-brand-soft p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2">
            <Zap className="mt-0.5 size-4 shrink-0 text-brand" />
            <span>
              Commande en dropshipping{order.saleReference ? ` (vente ${order.saleReference})` : ""} : votre préparateur expédie l&apos;article à votre acheteur dès réception, sous 48 h.
            </span>
          </p>
          {order.dropshipShipmentId && (
            <Link href={`/client/expeditions/${order.dropshipShipmentId}`} className="font-medium text-brand underline-offset-2 hover:underline">
              Suivre l&apos;expédition
            </Link>
          )}
        </div>
      )}
      {order.storageCreditsCharged > 0 && (
        <p className="flex items-center gap-2 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          <PackagePlus className="size-4" /> {order.storageCreditsCharged} crédit{order.storageCreditsCharged > 1 ? "s" : ""} débité{order.storageCreditsCharged > 1 ? "s" : ""} pour des places de stock
          supplémentaires lors de cette commande.
        </p>
      )}
      <Section>
        <StepProgress steps={SUPPLIER_ORDER_FLOW.map((s) => ({ key: s, label: SUPPLIER_ORDER_STATUS[s].label }))} current={failed ? "REGISTERED" : order.status} failed={failed} />
        {failed && <p className="mt-3 text-sm text-danger">{SUPPLIER_ORDER_STATUS[order.status].label}</p>}
        <div className="mt-5">
          <OrderActions order={{ id: order.id, status: order.status, trackingNumber: order.trackingNumber, carrier: order.carrier, pickupCode: order.pickupCode, isPickup: order.location.type !== "BUSINESS_ADDRESS" }} />
        </div>
      </Section>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Section title="Historique" description="Chaque étape est horodatée et attribuée à son responsable.">
            <Timeline
              entries={order.events.map((e) => ({
                id: e.id,
                label: SUPPLIER_ORDER_STATUS[e.status].label,
                tone: SUPPLIER_ORDER_STATUS[e.status].tone,
                at: e.createdAt,
                actor: e.actor ? (e.actor.role === "CUSTOMER" ? "vous" : e.actor.role === "PREPARER" ? `${fullName(e.actor)} (préparateur)` : "l'équipe Packio") : "Packio",
                note: e.note,
              }))}
            />
          </Section>
          {order.files.length > 0 && (
            <Section title="Photos et documents">
              <FileThumbs files={order.files} size="lg" />
            </Section>
          )}
          {order.inventoryItems.length > 0 && (
            <Section title="Articles mis en stock" contentClassName="p-0">
              <ul className="divide-y">
                {order.inventoryItems.map((i) => (
                  <li key={i.id}>
                    <Link href={`/client/stock/${i.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-muted/40">
                      <span className="text-sm font-medium">{i.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {i.sku} · {i.quantityAvailable} disponible(s)
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
        <div className="space-y-6">
          <Section title="Détails" contentClassName="space-y-3 text-sm">
            <Detail label="Point de réception" value={`${order.location.label} (${LOCATION_TYPE[order.location.type]})`} />
            {order.supplierOrderNumber && <Detail label="N° de commande fournisseur" value={order.supplierOrderNumber} />}
            <Detail
              label="Suivi"
              value={
                order.trackingNumber ? (
                  track ? (
                    <a href={track} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                      {carrierLabel(order.carrier)} {order.trackingNumber} <ExternalLink className="size-3" />
                    </a>
                  ) : (
                    `${carrierLabel(order.carrier)} ${order.trackingNumber}`
                  )
                ) : (
                  "Non renseigné"
                )
              }
            />
            {order.pickupCode && <Detail label="Code de retrait transmis" value={<span className="font-mono">{order.pickupCode}</span>} />}
            {order.expectedArrivalAt && <Detail label="Arrivée estimée" value={formatDate(order.expectedArrivalAt)} />}
            {order.articleUrl && (
              <Detail
                label="Article"
                value={
                  <a href={order.articleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all underline-offset-2 hover:underline">
                    Ouvrir le lien <ExternalLink className="size-3" />
                  </a>
                }
              />
            )}
            {order.instructions && <Detail label="Instructions" value={order.instructions} />}
            <Detail label="Préparateur" value={fullName(order.preparer.user)} />
          </Section>
          {order.incidents.length > 0 && (
            <Section title="Incidents" contentClassName="space-y-2">
              {order.incidents.map((i) => (
                <Link key={i.id} href={`/client/incidents/${i.id}`} className="flex items-center justify-between gap-2 rounded-xl border p-3 text-sm hover:bg-muted/40">
                  <span className="truncate">{i.reference}</span>
                  <StatusFrom map={INCIDENT_STATUS} value={i.status} />
                </Link>
              ))}
            </Section>
          )}
          {conversation && (
            <Button asChild variant="outline" className="w-full">
              <Link href={`/client/messages?c=${conversation.id}`}>
                <MessagesSquare /> Écrire à mon préparateur
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap">{value}</span>
    </div>
  );
}

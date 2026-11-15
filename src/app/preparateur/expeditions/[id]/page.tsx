import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Boxes, Download, ExternalLink, Hourglass, Info, MessagesSquare } from "lucide-react";
import { requirePreparer } from "@/server/auth/current";
import { getShipmentForActor, getSizeRules } from "@/server/services/shipments";
import { getShipmentConversationId } from "@/server/queries/preparer";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { StepProgress, Timeline } from "@/components/shared/timeline";
import { FileThumbs } from "@/components/shared/file-uploader";
import { CopyButton } from "@/components/shared/copy-button";
import { Button } from "@/components/ui/button";
import { ClientCode } from "@/components/preparer/cards";
import { ClassificationForm, ShipmentIncidentDialog, ShipmentStepPanel } from "@/components/preparer/shipment-actions";
import { CREDIT_STATE, INCIDENT_STATUS, PARCEL_SIZE, SHIPMENT_FLOW, SHIPMENT_STATUS, carrierLabel, shipmentOptionLabel } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Expédition" };

const CLASSIFIABLE = ["REQUESTED", "AWAITING_CLASSIFICATION", "CLASSIFIED", "AWAITING_CREDITS"];

export default async function PreparerShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePreparer();
  const { id } = await params;
  const shipment = await getShipmentForActor(actor, id).catch(() => null);
  if (!shipment || shipment.preparerId !== actor.preparerId) notFound();
  const [rules, conversationId] = await Promise.all([getSizeRules(), getShipmentConversationId(actor.preparerId, shipment.customerId)]);
  const address = [
    shipment.recipientName,
    shipment.recipientCompany,
    shipment.addressLine1,
    shipment.addressLine2,
    `${shipment.postalCode} ${shipment.city}`,
    shipment.country,
    shipment.recipientPhone,
  ]
    .filter(Boolean)
    .join("\n");
  const labels = shipment.files.filter((f) => f.purpose === "SHIPPING_LABEL");
  const prepPhotos = shipment.files.filter((f) => f.purpose === "PREPARATION_PHOTO");
  const flowCurrent = shipment.status === "AWAITING_CREDITS" ? "CLASSIFIED" : SHIPMENT_FLOW.includes(shipment.status) ? shipment.status : "DROPPED_OFF";
  const units = shipment.items.reduce((n, i) => n + i.quantity, 0);
  const classifiable = CLASSIFIABLE.includes(shipment.status);
  const sizeRules = rules.map((r) => ({
    size: r.size,
    label: r.label,
    description: r.description,
    creditCost: r.creditCost,
    maxLengthCm: r.maxLengthCm,
    maxWidthCm: r.maxWidthCm,
    maxHeightCm: r.maxHeightCm,
    maxWeightGrams: r.maxWeightGrams,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/preparateur/expeditions", label: "Expéditions" }}
        eyebrow={shipment.reference}
        title={`${units} article${units > 1 ? "s" : ""} pour ${shipment.recipientName}`}
        description={`Demandée le ${formatDateTime(shipment.createdAt)} · transporteur souhaité : ${carrierLabel(shipment.requestedCarrier)}`}
        actions={
          <>
            <StatusFrom map={SHIPMENT_STATUS} value={shipment.status} />
            {shipment.creditState !== "NONE" && <StatusFrom map={CREDIT_STATE} value={shipment.creditState} />}
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
      {shipment.status !== "CANCELLED" && (
        <div className="rounded-2xl border bg-card p-4 shadow-soft">
          <StepProgress steps={SHIPMENT_FLOW.map((s) => ({ key: s, label: SHIPMENT_STATUS[s].label }))} current={flowCurrent} failed={shipment.status === "INCIDENT" || shipment.status === "AWAITING_CREDITS"} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="order-2 space-y-6 lg:order-1">
          <Section title="Liste de préparation" description="Articles à rassembler, avec leur emplacement." contentClassName="p-0">
            <ul className="divide-y">
              {shipment.items.map((line) => (
                <li key={line.id}>
                  <Link href={`/preparateur/stock/${line.inventoryItem.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40">
                    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                      {line.inventoryItem.files[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/files/${line.inventoryItem.files[0].id}`} alt="" className="size-full object-cover" loading="lazy" />
                      ) : (
                        <Boxes className="size-5 text-muted-foreground" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{line.inventoryItem.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{line.inventoryItem.sku}</p>
                    </div>
                    <span className="rounded-lg bg-muted px-2 py-1 font-mono text-xs">{line.inventoryItem.storageLocation ?? "—"}</span>
                    <span className="w-10 text-right text-lg font-semibold tabular">×{line.quantity}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Destinataire" actions={<CopyButton value={address} label="Copier l'adresse" />} contentClassName="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <address className="not-italic whitespace-pre-line">{address}</address>
            <div className="space-y-2">
              <ClientCode customer={shipment.customer} />
              <p>
                <span className="text-muted-foreground">Transporteur souhaité : </span>
                {carrierLabel(shipment.requestedCarrier)}
              </p>
              <p>
                <span className="text-muted-foreground">Étiquette : </span>
                {shipment.labelMode === "CUSTOMER_PROVIDED" ? "fournie par le client" : "à créer par le préparateur"}
              </p>
              {shipment.recipientEmail && (
                <p>
                  <span className="text-muted-foreground">E-mail : </span>
                  {shipment.recipientEmail}
                </p>
              )}
            </div>
            {shipment.options.length > 0 && (
              <div className="flex flex-wrap gap-1.5 sm:col-span-2">
                {shipment.options.map((o) => (
                  <span key={o} className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">
                    {shipmentOptionLabel(o)}
                  </span>
                ))}
              </div>
            )}
            {shipment.instructions && (
              <div className="flex gap-2 rounded-xl bg-info-soft p-3 text-info sm:col-span-2">
                <Info className="mt-0.5 size-4 shrink-0" />
                <p className="whitespace-pre-wrap">{shipment.instructions}</p>
              </div>
            )}
            {labels.length > 0 && (
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                {labels.map((l) => (
                  <Button key={l.id} asChild variant="outline" size="sm">
                    <a href={`/api/files/${l.id}?telecharger=1`}>
                      <Download /> {l.filename}
                    </a>
                  </Button>
                ))}
              </div>
            )}
          </Section>

          {(shipment.trackingNumber || shipment.sizeCategory) && (
            <Section title="Colis et suivi" contentClassName="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {shipment.sizeCategory && (
                <p>
                  <span className="text-muted-foreground">Catégorie : </span>
                  {PARCEL_SIZE[shipment.sizeCategory].label} · {shipment.creditCost ?? 0} crédit(s)
                </p>
              )}
              {(shipment.weightGrams || shipment.lengthCm) && (
                <p>
                  <span className="text-muted-foreground">Mesures : </span>
                  {[shipment.weightGrams ? `${shipment.weightGrams} g` : null, shipment.lengthCm ? `${shipment.lengthCm}×${shipment.widthCm}×${shipment.heightCm} cm` : null].filter(Boolean).join(" · ")}
                </p>
              )}
              {shipment.trackingNumber && (
                <p className="sm:col-span-2">
                  <span className="text-muted-foreground">Suivi : </span>
                  {carrierLabel(shipment.carrier)} · <span className="font-mono">{shipment.trackingNumber}</span>
                  {shipment.trackingUrl && (
                    <a href={shipment.trackingUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-brand hover:underline">
                      Suivre <ExternalLink className="size-3" />
                    </a>
                  )}
                </p>
              )}
              {shipment.shippingFeeCents !== null && (
                <p>
                  <span className="text-muted-foreground">Frais de transport : </span>
                  {formatMoney(shipment.shippingFeeCents)} {shipment.shippingFeeNote && `(${shipment.shippingFeeNote})`}
                </p>
              )}
              {shipment.droppedOffAt && (
                <p>
                  <span className="text-muted-foreground">Déposé le : </span>
                  {formatDateTime(shipment.droppedOffAt)}
                </p>
              )}
              {prepPhotos.length > 0 && (
                <div className="sm:col-span-2">
                  <FileThumbs files={prepPhotos} />
                </div>
              )}
            </Section>
          )}

          {shipment.classifications.length > 0 && (
            <Section title="Historique des classifications" contentClassName="p-0">
              <ul className="divide-y text-sm">
                {shipment.classifications.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                    <span className={c.supersededAt ? "text-muted-foreground line-through" : "font-medium"}>
                      {PARCEL_SIZE[c.size].label} · {c.creditCost} crédit(s)
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(c.createdAt)} · {c.classifiedBy.role === "ADMIN" ? "Équipe Packio" : `${c.classifiedBy.firstName} ${c.classifiedBy.lastName}`}
                      {c.note && ` — ${c.note}`}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {shipment.incidents.length > 0 && (
            <Section title="Incidents" contentClassName="p-0">
              <ul className="divide-y text-sm">
                {shipment.incidents.map((inc) => (
                  <li key={inc.id}>
                    <Link href={`/preparateur/incidents/${inc.id}`} className="flex items-center justify-between gap-2 px-5 py-3 hover:bg-muted/40">
                      <span className="font-mono text-xs">{inc.reference}</span>
                      <StatusFrom map={INCIDENT_STATUS} value={inc.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Historique">
            <Timeline
              entries={[...shipment.events].reverse().map((e) => ({
                id: e.id,
                label: SHIPMENT_STATUS[e.status].label,
                tone: SHIPMENT_STATUS[e.status].tone,
                at: e.createdAt,
                actor: e.actor ? (e.actor.role === "ADMIN" ? "Équipe Packio" : `${e.actor.firstName} ${e.actor.lastName}`) : null,
                note: e.note,
              }))}
            />
          </Section>
        </div>

        <div className="order-1 lg:order-2">
          <div className="grid gap-3 lg:sticky lg:top-24">
            {shipment.status === "AWAITING_CREDITS" && (
              <div className="flex gap-3 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
                <Hourglass className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium">En attente de recharge du client</p>
                  <p className="text-danger/80">
                    Le solde du client est insuffisant pour {shipment.creditCost} crédit(s). L&apos;expédition reprendra automatiquement après sa recharge : ne la préparez pas d&apos;ici là.
                  </p>
                </div>
              </div>
            )}
            {classifiable && (
              <ClassificationForm
                shipmentId={shipment.id}
                rules={sizeRules}
                reclassify={shipment.status === "CLASSIFIED" || shipment.status === "AWAITING_CREDITS"}
                current={{ size: shipment.sizeCategory, weightGrams: shipment.weightGrams, lengthCm: shipment.lengthCm, widthCm: shipment.widthCm, heightCm: shipment.heightCm }}
              />
            )}
            <ShipmentStepPanel
              shipmentId={shipment.id}
              customerId={shipment.customerId}
              status={shipment.status}
              creditCost={shipment.creditCost}
              requestedCarrier={shipment.requestedCarrier}
              customerLabelAvailable={labels.length > 0}
            />
            {shipment.status === "CANCELLED" && (
              <div className="rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground">
                Expédition annulée le {formatDate(shipment.cancelledAt)}
                {shipment.cancelReason && ` — ${shipment.cancelReason}`}. Les articles réservés ont été remis en stock.
              </div>
            )}
            {!["CANCELLED", "DELIVERED"].includes(shipment.status) && <ShipmentIncidentDialog shipmentId={shipment.id} customerId={shipment.customerId} />}
          </div>
        </div>
      </div>
    </div>
  );
}

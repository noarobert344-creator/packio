import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, ExternalLink, Ruler, Truck } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { can } from "@/server/auth/actor";
import { getShipmentForActor, getSizeRules } from "@/server/services/shipments";
import { NotFoundError } from "@/server/errors";
import { cancelShipmentAdminAction, reclassifyShipmentAction, updateTransitAdminAction } from "@/server/actions/admin/ops";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { StepProgress, Timeline } from "@/components/shared/timeline";
import { FileThumbs } from "@/components/shared/file-uploader";
import { ActionButton, ActionDialog } from "@/components/shared/action-dialog";
import { SelectField, TextAreaField } from "@/components/shared/form-field";
import { CopyButton } from "@/components/shared/copy-button";
import { ReportIncidentDialog } from "@/components/incidents/incident-dialog";
import { Button } from "@/components/ui/button";
import { InfoList, Notice } from "@/components/admin/ops/ui";
import {
  CREDIT_STATE,
  INCIDENT_STATUS,
  PARCEL_SIZE,
  SHIPMENT_CANCELLABLE_BY_CUSTOMER,
  SHIPMENT_FLOW,
  SHIPMENT_STATUS,
  carrierLabel,
  shipmentOptionLabel,
} from "@/lib/labels";
import { formatAddress, formatCredits, formatDateTime, formatMoney, fullName } from "@/lib/format";

export const metadata: Metadata = { title: "Expédition" };

const ADMIN_CANCELLABLE = [...SHIPMENT_CANCELLABLE_BY_CUSTOMER, "PREPARING", "READY", "LABEL_READY"];

export default async function AdminShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin("operations.read");
  const { id } = await params;
  const shipment = await getShipmentForActor(actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const rules = await getSizeRules();
  const manage = can(actor, "operations.manage");
  const currentFlow = shipment.status === "AWAITING_CREDITS" ? "CLASSIFIED" : shipment.status;
  const failed = shipment.status === "INCIDENT" || shipment.status === "CANCELLED" || shipment.status === "AWAITING_CREDITS";
  const address = formatAddress(shipment);
  const canReclassify =
    ["AWAITING_CLASSIFICATION", "CLASSIFIED", "AWAITING_CREDITS"].includes(shipment.status) || (shipment.creditState === "CAPTURED" && !!shipment.creditCost);

  return (
    <>
      <PageHeader
        back={{ href: "/admin/expeditions", label: "Expéditions" }}
        eyebrow={shipment.reference}
        title={`Expédition pour ${shipment.recipientName}`}
        description={`Demandée le ${formatDateTime(shipment.createdAt)} par ${fullName(shipment.customer.user)} (${shipment.customer.referenceCode})`}
        actions={
          <>
            <StatusFrom map={SHIPMENT_STATUS} value={shipment.status} />
            {manage && (
              <>
                {canReclassify && (
                  <ActionDialog
                    trigger={
                      <Button variant="outline" size="sm">
                        <Ruler /> Corriger la classification
                      </Button>
                    }
                    title="Corriger la classification"
                    description={
                      shipment.creditState === "CAPTURED"
                        ? "Les crédits sont déjà débités : seule une correction à la baisse est possible, la différence sera recréditée au client."
                        : "La réservation de crédits sera ajustée selon la nouvelle catégorie."
                    }
                    action={reclassifyShipmentAction}
                    submitLabel="Corriger"
                  >
                    <input type="hidden" name="shipmentId" value={shipment.id} />
                    <SelectField
                      name="size"
                      label="Nouvelle catégorie"
                      required
                      defaultValue={shipment.sizeCategory ?? ""}
                      placeholder="Choisir"
                      options={rules.map((r) => ({ value: r.size, label: `${r.label} — ${formatCredits(r.creditCost)}` }))}
                    />
                    <TextAreaField name="reason" label="Justification" required rows={3} hint="Visible dans l'historique et le journal d'audit." />
                  </ActionDialog>
                )}
                {shipment.status === "DROPPED_OFF" && (
                  <ActionButton action={updateTransitAdminAction} fields={{ shipmentId: shipment.id, status: "IN_TRANSIT" }} variant="outline" size="sm">
                    <Truck /> Marquer en transit
                  </ActionButton>
                )}
                {["DROPPED_OFF", "IN_TRANSIT", "INCIDENT"].includes(shipment.status) && (
                  <ActionButton action={updateTransitAdminAction} fields={{ shipmentId: shipment.id, status: "DELIVERED" }} variant="outline" size="sm">
                    Marquer livrée
                  </ActionButton>
                )}
                {ADMIN_CANCELLABLE.includes(shipment.status) && (
                  <ActionDialog
                    trigger={
                      <Button variant="destructive" size="sm">
                        <Ban /> Annuler
                      </Button>
                    }
                    title="Annuler l'expédition"
                    description="Les crédits réservés et le stock réservé seront libérés. Le client et le préparateur sont notifiés."
                    action={cancelShipmentAdminAction}
                    submitLabel="Annuler l'expédition"
                    destructive
                  >
                    <input type="hidden" name="shipmentId" value={shipment.id} />
                    <TextAreaField name="reason" label="Motif" required rows={3} />
                  </ActionDialog>
                )}
                <ReportIncidentDialog
                  types={["SHIPMENT_ISSUE", "CLASSIFICATION_DISPUTE", "OTHER"]}
                  context={{ shipmentId: shipment.id }}
                  customerId={shipment.customerId}
                  defaultTitle={`${shipment.reference} — `}
                  label="Signaler un incident"
                />
              </>
            )}
          </>
        }
      />
      <div className="mb-6 rounded-2xl border bg-card p-4 shadow-soft">
        <StepProgress steps={SHIPMENT_FLOW.map((s) => ({ key: s, label: SHIPMENT_STATUS[s].label }))} current={currentFlow} failed={failed} />
      </div>
      {shipment.status === "AWAITING_CREDITS" && (
        <Notice tone="warning" className="mb-6">
          Le solde du client est insuffisant pour {formatCredits(shipment.creditCost)}. L&apos;expédition reprendra automatiquement après une recharge ou un crédit manuel depuis la{" "}
          <Link href={`/admin/clients/${shipment.customerId}`}>fiche client</Link>.
        </Notice>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Section title="Articles">
            <ul className="divide-y">
              {shipment.items.map((it) => (
                <li key={it.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  {it.inventoryItem.files[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${it.inventoryItem.files[0].id}`} alt="" className="size-10 rounded-lg border object-cover" />
                  ) : (
                    <span className="size-10 rounded-lg bg-muted" />
                  )}
                  <div className="min-w-0 flex-1 text-sm">
                    <Link href={`/admin/stocks/${it.inventoryItem.id}`} className="font-medium hover:underline">
                      {it.inventoryItem.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {it.inventoryItem.sku}
                      {it.inventoryItem.storageLocation ? ` · emplacement ${it.inventoryItem.storageLocation}` : ""}
                    </p>
                  </div>
                  <span className="text-sm font-medium tabular">×{it.quantity}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Destinataire et livraison">
            <InfoList
              items={[
                { label: "Destinataire", value: `${shipment.recipientName}${shipment.recipientCompany ? ` — ${shipment.recipientCompany}` : ""}` },
                {
                  label: "Adresse",
                  value: (
                    <span className="flex items-start gap-2">
                      <span>{address}</span>
                      <CopyButton value={`${shipment.recipientName}\n${address}`} label="" variant="ghost" size="icon-xs" successMessage="Adresse copiée" />
                    </span>
                  ),
                },
                { label: "Téléphone", value: shipment.recipientPhone },
                { label: "E-mail", value: shipment.recipientEmail },
                { label: "Transporteur souhaité", value: shipment.requestedCarrier ? carrierLabel(shipment.requestedCarrier) : null },
                { label: "Étiquette", value: shipment.labelMode === "CUSTOMER_PROVIDED" ? "Fournie par le client" : "Créée par le préparateur" },
                { label: "Options", value: shipment.options.length ? shipment.options.map(shipmentOptionLabel).join(", ") : "Aucune" },
                { label: "Instructions", value: shipment.instructions },
              ]}
            />
          </Section>
          {shipment.files.length > 0 && (
            <Section title="Étiquettes et photos de préparation">
              <FileThumbs files={shipment.files} size="lg" />
            </Section>
          )}
          <Section title="Historique des classifications" description="La taille est déterminée exclusivement par le préparateur, selon les règles de l'administration.">
            {shipment.classifications.length === 0 ? (
              <p className="text-sm text-muted-foreground">Pas encore classifiée.</p>
            ) : (
              <ul className="space-y-3">
                {shipment.classifications.map((c) => (
                  <li key={c.id} className="flex flex-col gap-1 rounded-xl border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">
                        {PARCEL_SIZE[c.size].label} · {formatCredits(c.creditCost)}
                        {c.supersededAt && <span className="ml-2 text-xs font-normal text-muted-foreground">(remplacée)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fullName(c.classifiedBy)}
                        {c.classifiedBy.role === "ADMIN" ? " (Packio)" : ""} · {formatDateTime(c.createdAt)}
                        {c.weightGrams ? ` · ${c.weightGrams} g` : ""}
                        {c.lengthCm ? ` · ${c.lengthCm}×${c.widthCm}×${c.heightCm} cm` : ""}
                      </p>
                      {c.note && <p className="text-xs text-muted-foreground">{c.note}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div className="space-y-6">
          <Section title="Crédits et frais">
            <InfoList
              className="sm:grid-cols-1"
              items={[
                { label: "Catégorie", value: shipment.sizeCategory ? PARCEL_SIZE[shipment.sizeCategory].label : "Non classifiée" },
                { label: "Coût de préparation", value: shipment.creditCost !== null ? formatCredits(shipment.creditCost) : "—" },
                { label: "État des crédits", value: <StatusFrom map={CREDIT_STATE} value={shipment.creditState} /> },
                {
                  label: "Frais de transport (hors crédits)",
                  value: shipment.shippingFeeCents !== null ? `${formatMoney(shipment.shippingFeeCents)}${shipment.shippingFeeNote ? ` — ${shipment.shippingFeeNote}` : ""}` : "Aucun frais déclaré",
                },
              ]}
            />
          </Section>
          <Section title="Suivi transporteur">
            {shipment.trackingNumber ? (
              <div className="space-y-2 text-sm">
                <p>
                  {carrierLabel(shipment.carrier)} · <span className="font-mono">{shipment.trackingNumber}</span>
                </p>
                {shipment.droppedOffAt && <p className="text-xs text-muted-foreground">Déposé le {formatDateTime(shipment.droppedOffAt)}</p>}
                {shipment.deliveredAt && <p className="text-xs text-muted-foreground">Livré le {formatDateTime(shipment.deliveredAt)}</p>}
                {shipment.trackingUrl && (
                  <Button asChild variant="outline" size="sm">
                    <a href={shipment.trackingUrl} target="_blank" rel="noreferrer noopener">
                      <ExternalLink /> Suivre le colis
                    </a>
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Le numéro de suivi sera ajouté au dépôt du colis.</p>
            )}
          </Section>
          <Section title="Intervenants">
            <InfoList
              className="sm:grid-cols-1"
              items={[
                { label: "Client", value: <Link className="hover:underline" href={`/admin/clients/${shipment.customerId}`}>{fullName(shipment.customer.user)} — {shipment.customer.user.email}</Link> },
                { label: "Préparateur", value: <Link className="hover:underline" href={`/admin/preparateurs/${shipment.preparerId}`}>{fullName(shipment.preparer.user)}</Link> },
                { label: "Motif d'annulation", value: shipment.cancelReason, hidden: !shipment.cancelReason },
              ]}
            />
          </Section>
          {shipment.incidents.length > 0 && (
            <Section title="Incidents">
              <ul className="space-y-2 text-sm">
                {shipment.incidents.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/incidents/${i.id}`} className="hover:underline">
                      {i.reference}
                    </Link>
                    <StatusFrom map={INCIDENT_STATUS} value={i.status} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Historique">
            <Timeline
              entries={shipment.events.map((e) => ({
                id: e.id,
                label: SHIPMENT_STATUS[e.status].label,
                tone: SHIPMENT_STATUS[e.status].tone,
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

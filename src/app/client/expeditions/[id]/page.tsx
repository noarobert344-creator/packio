import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Coins, ExternalLink, MessagesSquare, Scale, Timer, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge, StatusFrom } from "@/components/shared/status-badge";
import { StepProgress, Timeline } from "@/components/shared/timeline";
import { FileThumbs } from "@/components/shared/file-uploader";
import { ActionDialog } from "@/components/shared/action-dialog";
import { TextAreaField } from "@/components/shared/form-field";
import { ReportIncidentDialog } from "@/components/incidents/incident-dialog";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { getShipmentForActor } from "@/server/services/shipments";
import { db } from "@/server/db";
import { cancelShipmentAction, disputeClassificationAction } from "@/server/actions/customer";
import { CREDIT_STATE, INCIDENT_STATUS, PARCEL_SIZE, SHIPMENT_CANCELLABLE_BY_CUSTOMER, SHIPMENT_FLOW, SHIPMENT_KIND, SHIPMENT_STATUS, carrierLabel, shipmentOptionLabel } from "@/lib/labels";
import { formatAddress, formatCredits, formatDateTime, formatMoney, fullName } from "@/lib/format";

export const metadata: Metadata = { title: "Expédition" };

export default async function ShipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireSubscribedCustomer();
  const { id } = await params;
  const s = await getShipmentForActor(actor, id).catch(() => null);
  if (!s) notFound();
  const conversation = await db.conversation.findFirst({ where: { type: "CUSTOMER_PREPARER", customerId: s.customerId, preparerId: s.preparerId, status: "OPEN" } });
  const failed = s.status === "CANCELLED" || s.status === "INCIDENT";
  const flowCurrent = s.status === "AWAITING_CREDITS" ? "CLASSIFIED" : failed ? "REQUESTED" : s.status;
  const preparationPhotos = s.files.filter((f) => f.purpose === "PREPARATION_PHOTO");
  const labels = s.files.filter((f) => f.purpose === "SHIPPING_LABEL");
  const canCancel = SHIPMENT_CANCELLABLE_BY_CUSTOMER.includes(s.status);
  const disputeOpen = s.incidents.some((i) => i.type === "CLASSIFICATION_DISPUTE" && (i.status === "OPEN" || i.status === "IN_PROGRESS"));

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/client/expeditions", label: "Mes expéditions" }}
        eyebrow={s.reference}
        title={s.kind === "RETURN_TO_CUSTOMER" ? "Retour à votre domicile" : `Expédition vers ${s.recipientName}`}
        description={`Demandée le ${formatDateTime(s.createdAt)} · préparée par ${fullName(s.preparer.user)}`}
        actions={
          <>
            {s.kind !== "SALE" && <StatusFrom map={SHIPMENT_KIND} value={s.kind} />}
            <StatusFrom map={SHIPMENT_STATUS} value={s.status} />
          </>
        }
      />
      {s.dueAt && ["REQUESTED", "AWAITING_CLASSIFICATION", "CLASSIFIED", "PREPARING", "READY", "LABEL_READY"].includes(s.status) && (
        <p className="flex items-center gap-2 rounded-xl bg-muted px-4 py-3 text-sm">
          <Timer className="size-4 text-brand" /> Expédition prévue avant le <span className="font-medium">{formatDateTime(s.dueAt)}</span>.
        </p>
      )}
      {s.status === "AWAITING_CREDITS" && (
        <div className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
          <p>Solde insuffisant : {formatCredits(s.creditCost)} requis. L&apos;expédition reprendra automatiquement après votre recharge.</p>
          <Button asChild size="sm" variant="destructive">
            <Link href="/client/credits#recharger">Acheter des crédits</Link>
          </Button>
        </div>
      )}
      <Section>
        <StepProgress steps={SHIPMENT_FLOW.map((st) => ({ key: st, label: SHIPMENT_STATUS[st].label }))} current={flowCurrent} failed={failed} />
        <div className="mt-5 flex flex-wrap gap-2">
          {s.trackingUrl && (
            <Button asChild>
              <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer">
                Suivre le colis <ExternalLink />
              </a>
            </Button>
          )}
          {conversation && (
            <Button asChild variant="outline">
              <Link href={`/client/messages?c=${conversation.id}`}>
                <MessagesSquare /> Écrire au préparateur
              </Link>
            </Button>
          )}
          {s.sizeCategory && !disputeOpen && s.status !== "CANCELLED" && (
            <ActionDialog
              trigger={
                <Button variant="outline">
                  <Scale /> Contester la classification
                </Button>
              }
              title="Contester la classification"
              description={`Votre colis a été classé « ${PARCEL_SIZE[s.sizeCategory].label} ». L'équipe Packio examinera votre demande et les photos de préparation.`}
              action={disputeClassificationAction}
              submitLabel="Envoyer la contestation"
            >
              <input type="hidden" name="shipmentId" value={s.id} />
              <TextAreaField name="reason" label="Motif" required rows={4} placeholder="Ex. : il s'agit d'un seul t-shirt, le colis devrait être petit." />
            </ActionDialog>
          )}
          {canCancel && (
            <ActionDialog
              trigger={
                <Button variant="ghost">
                  <XCircle /> Annuler l&apos;expédition
                </Button>
              }
              title="Annuler cette expédition ?"
              description="Les articles redeviennent disponibles et les crédits réservés sont libérés."
              action={cancelShipmentAction}
              submitLabel="Annuler l'expédition"
              destructive
            >
              <input type="hidden" name="shipmentId" value={s.id} />
              <TextAreaField name="reason" label="Motif (facultatif)" rows={2} />
            </ActionDialog>
          )}
          <ReportIncidentDialog types={["SHIPMENT_ISSUE", "OTHER"]} context={{ shipmentId: s.id }} defaultTitle={`Problème sur ${s.reference}`} />
        </div>
      </Section>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Section title="Articles" contentClassName="p-0">
            <ul className="divide-y">
              {s.items.map((i) => (
                <li key={i.id}>
                  <Link href={`/client/stock/${i.inventoryItem.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40">
                    <span className="truncate text-sm font-medium">{i.inventoryItem.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ×{i.quantity}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Suivi détaillé">
            <Timeline
              entries={s.events.map((e) => ({
                id: e.id,
                label: SHIPMENT_STATUS[e.status].label,
                tone: SHIPMENT_STATUS[e.status].tone,
                at: e.createdAt,
                actor: e.actor ? (e.actor.role === "CUSTOMER" ? "vous" : e.actor.role === "PREPARER" ? `${fullName(e.actor)} (préparateur)` : "l'équipe Packio") : null,
                note: e.note,
              }))}
            />
          </Section>
          {(preparationPhotos.length > 0 || labels.length > 0) && (
            <Section title="Photos de préparation et documents">
              <FileThumbs files={[...preparationPhotos, ...labels]} size="lg" />
            </Section>
          )}
        </div>
        <div className="space-y-6">
          <Section title="Coût de préparation" contentClassName="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Catégorie</span>
              <span className="font-medium">{s.sizeCategory ? PARCEL_SIZE[s.sizeCategory].label : "En attente du préparateur"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Coins className="size-4" /> Crédits
              </span>
              <span className="font-medium">{s.creditCost !== null ? formatCredits(s.creditCost) : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">État</span>
              <StatusBadge tone={CREDIT_STATE[s.creditState].tone} label={CREDIT_STATE[s.creditState].label} />
            </div>
            {(s.weightGrams || s.lengthCm) && (
              <p className="text-xs text-muted-foreground">
                {s.weightGrams ? `${(s.weightGrams / 1000).toLocaleString("fr-FR")} kg` : ""}
                {s.lengthCm ? ` · ${s.lengthCm}×${s.widthCm}×${s.heightCm} cm` : ""}
              </p>
            )}
            <div className="border-t pt-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Frais de transport</span>
                <span className="font-medium">{s.shippingFeeCents ? formatMoney(s.shippingFeeCents) : s.labelMode === "CUSTOMER_PROVIDED" ? "Bordereau fourni" : "—"}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Distincts des crédits de préparation.</p>
            </div>
            {s.classifications.length > 1 && (
              <div className="border-t pt-3">
                <p className="mb-1 text-xs font-medium">Historique des classifications</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {s.classifications.map((c) => (
                    <li key={c.id} className={c.supersededAt ? "line-through" : ""}>
                      {PARCEL_SIZE[c.size].label} · {formatCredits(c.creditCost)} · {formatDateTime(c.createdAt)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>
          <Section title="Destinataire" contentClassName="space-y-1 text-sm">
            <p className="font-medium">{s.recipientName}</p>
            {s.recipientCompany && <p>{s.recipientCompany}</p>}
            <p className="text-muted-foreground">{formatAddress(s)}</p>
            {s.recipientPhone && <p className="text-muted-foreground">{s.recipientPhone}</p>}
            <p className="pt-2 text-xs text-muted-foreground">
              Transporteur : {carrierLabel(s.carrier ?? s.requestedCarrier)}
              {s.trackingNumber ? ` · ${s.trackingNumber}` : ""}
            </p>
            {s.options.length > 0 && <p className="text-xs text-muted-foreground">Options : {s.options.map(shipmentOptionLabel).join(", ")}</p>}
            {s.instructions && <p className="pt-1 text-xs">« {s.instructions} »</p>}
          </Section>
          {s.incidents.length > 0 && (
            <Section title="Incidents" contentClassName="space-y-2">
              {s.incidents.map((i) => (
                <Link key={i.id} href={`/client/incidents/${i.id}`} className="flex items-center justify-between gap-2 rounded-xl border p-3 text-sm hover:bg-muted/40">
                  <span>{i.reference}</span>
                  <StatusFrom map={INCIDENT_STATUS} value={i.status} />
                </Link>
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

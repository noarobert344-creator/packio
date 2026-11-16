import { nowMs } from "@/server/lib/clock";
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, MapPin, MessagesSquare, Package, Truck, Phone } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge, StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { AssignmentWaiting } from "@/components/client/assignment-waiting";
import { ReceptionCard } from "@/components/client/reception-card";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { db } from "@/server/db";
import { SHIPMENT_STATUS, SUPPLIER_ORDER_STATUS } from "@/lib/labels";
import { formatDate, initials } from "@/lib/format";
import type { WeeklyAvailability } from "@/server/services/preparers";

export const metadata: Metadata = { title: "Mon préparateur" };

const DAYS: [keyof WeeklyAvailability, string][] = [
  ["mon", "Lun"],
  ["tue", "Mar"],
  ["wed", "Mer"],
  ["thu", "Jeu"],
  ["fri", "Ven"],
  ["sat", "Sam"],
  ["sun", "Dim"],
];

export default async function MyPreparerPage() {
  const { customer } = await requireSubscribedCustomer();
  if (!customer.currentPreparerId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Mon préparateur" description="Votre préparateur attitré apparaîtra ici dès son attribution." />
        {customer.assignmentState !== "NOT_REQUESTED" && customer.assignmentState !== "ASSIGNED" ? (
          <AssignmentWaiting serverNow={nowMs()} requestedAt={customer.assignmentRequestedAt?.toISOString() ?? null} dueAt={customer.assignmentDueAt?.toISOString() ?? null} state={customer.assignmentState} />
        ) : (
          <EmptyState icon={Truck} title="Aucun préparateur attribué" description="Contactez le support Packio si votre abonnement est actif." />
        )}
      </div>
    );
  }
  const now = new Date();
  const [preparer, conversation, ordersCount, orders, shipments] = await Promise.all([
    db.preparerProfile.findUniqueOrThrow({
      where: { id: customer.currentPreparerId },
      include: {
        user: { select: { firstName: true, lastName: true, avatarFileId: true, phone: true } },
        locations: { where: { isActive: true, validatedAt: { not: null } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        absences: { where: { cancelledAt: null, endsAt: { gte: now } }, orderBy: { startsAt: "asc" }, take: 3 },
      },
    }),
    db.conversation.findFirst({ where: { type: "CUSTOMER_PREPARER", customerId: customer.id, preparerId: customer.currentPreparerId } }),
    db.supplierOrder.count({ where: { customerId: customer.id, preparerId: customer.currentPreparerId } }),
    db.supplierOrder.findMany({ where: { customerId: customer.id, preparerId: customer.currentPreparerId, status: { in: ["PICKED_UP", "RECEIVED", "QUALITY_CHECK", "IN_STOCK"] } }, orderBy: { statusChangedAt: "desc" }, take: 10 }),
    db.outboundShipment.findMany({ where: { customerId: customer.id, preparerId: customer.currentPreparerId, droppedOffAt: { not: null } }, orderBy: { droppedOffAt: "desc" }, take: 10 }),
  ]);
  const currentAbsence = preparer.absences.find((a) => a.startsAt <= now);
  const availability = (preparer.availability ?? null) as WeeklyAvailability | null;
  const status =
    preparer.status === "SUSPENDED" ? { tone: "danger" as const, label: "Indisponible" } : currentAbsence ? { tone: "warning" as const, label: `Absent jusqu'au ${formatDate(currentAbsence.endsAt)}` } : preparer.status === "UNAVAILABLE" ? { tone: "warning" as const, label: "Indisponible temporairement" } : { tone: "success" as const, label: "Disponible" };

  const history = [
    ...orders.map((o) => ({ id: o.id, at: o.statusChangedAt, href: `/client/commandes/${o.id}`, icon: Package, label: o.description, ref: o.reference, badge: <StatusFrom map={SUPPLIER_ORDER_STATUS} value={o.status} /> })),
    ...shipments.map((s) => ({ id: s.id, at: s.droppedOffAt!, href: `/client/expeditions/${s.id}`, icon: Truck, label: `Expédition vers ${s.recipientName}`, ref: s.reference, badge: <StatusFrom map={SHIPMENT_STATUS} value={s.status} /> })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="space-y-8">
      <PageHeader title="Mon préparateur" description="Votre interlocuteur logistique attitré et ses points de réception validés par Packio." />
      <section className="flex flex-col gap-6 rounded-2xl border bg-card p-6 shadow-soft sm:flex-row sm:items-center">
        <Avatar className="size-20">
          {preparer.user.avatarFileId && <AvatarImage src={`/api/files/${preparer.user.avatarFileId}`} alt="" />}
          <AvatarFallback className="bg-brand-soft text-xl font-semibold text-brand">{initials(preparer.user.firstName, preparer.user.lastName)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">
              {preparer.user.firstName} {preparer.user.lastName}
            </h2>
            <StatusBadge tone={status.tone} label={status.label} />
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" /> {preparer.city}
              {preparer.country !== "FR" ? `, ${preparer.country}` : ""}
            </span>
            {preparer.user.phone && (
              <a href={`tel:${preparer.user.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                <Phone className="size-4" /> {preparer.user.phone}
              </a>
            )}
          </p>
          <p className="text-sm">
            <span className="font-semibold tabular">{ordersCount}</span> <span className="text-muted-foreground">colis confiés depuis l&apos;attribution</span>
          </p>
        </div>
        {conversation && (
          <Button asChild size="lg">
            <Link href={`/client/messages?c=${conversation.id}`}>
              <MessagesSquare /> Envoyer un message
            </Link>
          </Button>
        )}
      </section>

      {availability && (
        <Section title="Disponibilités" description={preparer.availabilityNote ?? undefined}>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {DAYS.map(([k, label]) => (
              <div key={k} className="rounded-xl border p-2.5 text-center">
                <p className="text-xs font-medium">{label}</p>
                <p className="mt-1 text-[0.7rem] text-muted-foreground tabular">{availability[k]?.open ? `${availability[k].from}–${availability[k].to}` : "Fermé"}</p>
              </div>
            ))}
          </div>
          {preparer.absences.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm">
              {preparer.absences.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-warning">
                  <CalendarClock className="size-4" /> Absence du {formatDate(a.startsAt)} au {formatDate(a.endsAt)}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Adresses de réception validées</h2>
          <p className="text-sm text-muted-foreground">Seules les coordonnées validées par Packio sont affichées. Utilisez-les comme adresse de livraison chez vos fournisseurs.</p>
        </div>
        {preparer.locations.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {preparer.locations.map((l) => (
              <ReceptionCard key={l.id} location={{ ...l, recipientPhone: l.recipientPhone ?? preparer.user.phone }} clientCode={customer.referenceCode} />
            ))}
          </div>
        ) : (
          <EmptyState icon={MapPin} title="Aucun point de réception validé" description="Votre préparateur n'a pas encore de point de réception validé. L'équipe Packio en est informée." />
        )}
      </div>

      <Section title="Historique des colis traités" contentClassName="p-0">
        {history.length ? (
          <ul className="divide-y">
            {history.map((h) => (
              <li key={h.id}>
                <Link href={h.href} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40">
                  <h.icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{h.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {h.ref} · {formatDate(h.at)}
                    </p>
                  </div>
                  {h.badge}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-5">
            <EmptyState icon={Package} title="Aucun colis traité pour le moment" />
          </div>
        )}
      </Section>
    </div>
  );
}

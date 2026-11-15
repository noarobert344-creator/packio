import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Boxes, CalendarOff, Camera, CheckCircle2, Headset, MapPin, PackageCheck, PackageOpen, Ruler, Siren, Timer, Truck, Users, Warehouse, Hourglass } from "lucide-react";
import { db } from "@/server/db";
import { requirePreparer } from "@/server/auth/current";
import { getPreparerDashboard } from "@/server/services/stats";
import { getTodayLists } from "@/server/queries/preparer";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusFrom } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { ClientCode, PickupCode } from "@/components/preparer/cards";
import { SHIPMENT_STATUS, SUPPLIER_ORDER_STATUS, carrierLabel } from "@/lib/labels";
import { formatDate, formatRelative } from "@/lib/format";

export const metadata: Metadata = { title: "Tableau de bord préparateur" };

export default async function PreparerDashboardPage() {
  const actor = await requirePreparer();
  const now = new Date();
  const [stats, today, me, late] = await Promise.all([
    getPreparerDashboard(actor.preparerId),
    getTodayLists(actor.preparerId),
    db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { avatarFileId: true } }),
    db.outboundShipment.count({
      where: { preparerId: actor.preparerId, dueAt: { lt: now }, status: { in: ["REQUESTED", "AWAITING_CLASSIFICATION", "CLASSIFIED", "PREPARING", "READY", "LABEL_READY"] } },
    }),
  ]);
  const currentAbsence = today.absences.find((a) => a.startsAt <= now && a.endsAt >= now);
  const upcoming = today.absences.filter((a) => a.startsAt > now);

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Bonjour ${actor.firstName}`}
        description="Vos réceptions, votre stock et vos expéditions du jour, en un coup d'œil."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/preparateur/disponibilites#absences">
                <CalendarOff /> Déclarer une absence
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/preparateur/messages?support=1">
                <Headset /> Contacter le support
              </Link>
            </Button>
          </>
        }
      />

      {!me.avatarFileId && (
        <div className="flex flex-col gap-3 rounded-2xl border border-brand/30 bg-brand-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm">
            <Camera className="mt-0.5 size-4 shrink-0 text-brand" />
            <span>
              <span className="font-semibold">Ajoutez votre photo de profil.</span> Vos clients la voient dans leur espace, sur la page « Mon préparateur » et dans la messagerie.
            </span>
          </p>
          <Button asChild size="sm">
            <Link href="/preparateur/parametres">Ajouter ma photo</Link>
          </Button>
        </div>
      )}

      {late > 0 && (
        <Link
          href="/preparateur/expeditions"
          className="flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm font-medium text-danger"
        >
          <Timer className="size-4 shrink-0" /> {late} expédition{late > 1 ? "s" : ""} hors du délai de 48 h : à déposer en priorité.
        </Link>
      )}

      {(currentAbsence || upcoming.length > 0) && (
        <div className="flex flex-col gap-1 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 font-medium">
            <CalendarOff className="size-4 shrink-0" />
            {currentAbsence
              ? `Absence en cours jusqu'au ${formatDate(currentAbsence.endsAt, "d MMMM")}${currentAbsence.reason ? ` — ${currentAbsence.reason}` : ""}`
              : `Absence prévue du ${formatDate(upcoming[0].startsAt, "d MMMM")} au ${formatDate(upcoming[0].endsAt, "d MMMM")}`}
          </p>
          <Link href="/preparateur/disponibilites#absences" className="text-xs underline underline-offset-2">
            Gérer mes absences
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Clients attribués" value={stats.clients} icon={Users} href="/preparateur/clients" />
        <StatCard label="Commandes à récupérer" value={stats.toPickUp} icon={MapPin} tone={stats.toPickUp ? "brand" : "default"} href="/preparateur/receptions" />
        <StatCard label="Colis à réceptionner" value={stats.toReceive} icon={PackageCheck} tone={stats.toReceive ? "brand" : "default"} href="/preparateur/receptions?groupe=receptionner" />
        <StatCard label="Articles stockés" value={stats.storedUnits} icon={Warehouse} href="/preparateur/stock" />
        <StatCard label="Expéditions en attente" value={stats.awaiting} icon={Hourglass} tone={stats.awaiting ? "warning" : "default"} hint="Classification ou crédits" href="/preparateur/expeditions" />
        <StatCard label="Colis à préparer" value={stats.toPrepare} icon={PackageOpen} tone={stats.toPrepare ? "brand" : "default"} href="/preparateur/expeditions" />
        <StatCard label="Expéditions terminées" value={stats.done} icon={CheckCircle2} tone="success" hint="30 derniers jours" href="/preparateur/expeditions?groupe=expediees" />
        <StatCard label="Incidents ouverts" value={stats.incidents} icon={Siren} tone={stats.incidents ? "danger" : "default"} href="/preparateur/incidents" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Section
          title="Colis à récupérer"
          description="Disponibles au locker ou en cours d'acheminement."
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/preparateur/receptions">
                Tout voir <ArrowRight />
              </Link>
            </Button>
          }
          contentClassName="p-0"
        >
          {today.atLocker.length ? (
            <ul className="divide-y">
              {today.atLocker.map((o) => (
                <li key={o.id}>
                  <Link href={`/preparateur/receptions/${o.id}`} className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-muted/50">
                    <div className="flex items-center justify-between gap-2">
                      <ClientCode customer={o.customer} />
                      <StatusFrom map={SUPPLIER_ORDER_STATUS} value={o.status} />
                    </div>
                    <p className="line-clamp-1 text-sm font-medium">{o.description}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3.5" /> {o.location.relayName ?? o.location.label}
                      </span>
                      <PickupCode code={o.pickupCode} size="sm" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucun colis à récupérer pour le moment.</p>
          )}
        </Section>

        <Section
          title="À classifier"
          description="Déterminez la taille réelle du colis."
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/preparateur/expeditions">
                Tout voir <ArrowRight />
              </Link>
            </Button>
          }
          contentClassName="p-0"
        >
          {today.toClassify.length ? (
            <ul className="divide-y">
              {today.toClassify.map((s) => (
                <li key={s.id}>
                  <Link href={`/preparateur/expeditions/${s.id}`} className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-muted/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{s.reference}</span>
                      <span className="text-xs text-muted-foreground">{formatRelative(s.createdAt)}</span>
                    </div>
                    <p className="text-sm font-medium">
                      {s._count.items} article{s._count.items > 1 ? "s" : ""} → {s.city}
                    </p>
                    <div className="flex items-center gap-2">
                      <ClientCode customer={s.customer} />
                      <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand">
                        <Ruler className="size-3.5" /> Classifier
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucune expédition à classifier.</p>
          )}
        </Section>

        <Section
          title="À préparer et déposer"
          description="Crédits réservés, prêtes à partir."
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/preparateur/expeditions">
                Tout voir <ArrowRight />
              </Link>
            </Button>
          }
          contentClassName="p-0"
        >
          {today.toPrepare.length ? (
            <ul className="divide-y">
              {today.toPrepare.map((s) => (
                <li key={s.id}>
                  <Link href={`/preparateur/expeditions/${s.id}`} className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-muted/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{s.reference}</span>
                      <StatusFrom map={SHIPMENT_STATUS} value={s.status} />
                    </div>
                    <p className="text-sm font-medium">
                      {s.recipientName} · {s.city}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ClientCode customer={s.customer} />
                      <span className="ml-auto flex items-center gap-1">
                        <Truck className="size-3.5" /> {carrierLabel(s.requestedCarrier)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Rien à préparer pour l&apos;instant.</p>
          )}
        </Section>
      </div>

      {stats.clients === 0 && (
        <div className="flex items-start gap-3 rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground">
          <Boxes className="mt-0.5 size-4 shrink-0" />
          <p>Aucun client ne vous est encore attribué. L&apos;équipe Packio vous notifiera dès qu&apos;un client vous sera confié.</p>
        </div>
      )}
    </div>
  );
}

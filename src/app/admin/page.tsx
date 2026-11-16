import type { Metadata } from "next";
import Link from "next/link";
import { Activity, ArrowRight, Boxes, CircleAlert, Coins, CreditCard, Package, ShieldAlert, Truck, Users, Wallet } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { can } from "@/server/auth/actor";
import { getAdminOverview } from "@/server/services/stats";
import { listRecentAudit } from "@/server/queries/admin-people";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssignDialog } from "@/components/admin/people/assignment-dialogs";
import { AssignmentStateBadge, TableWrap } from "@/components/admin/people/display";
import { SlaCountdown } from "@/components/admin/people/sla-countdown";
import { CapacityBar } from "@/components/admin/people/capacity-bar";
import { PREPARER_STATUS, SHIPMENT_STATUS, SHIPMENT_FLOW } from "@/lib/labels";
import { formatDateTime, formatMoney, formatRelative } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Vue d'ensemble — Administration" };

export default async function AdminOverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdmin();
  const sp = await searchParams;
  const [overview, audit] = await Promise.all([getAdminOverview(), can(actor, "audit.read") ? listRecentAudit(10) : Promise.resolve([])]);
  const canAssign = can(actor, "assignments.manage");
  const lateCount = overview.waiting.filter((w) => w.sla.isLate).length;
  const activeShipments = ["REQUESTED", "AWAITING_CLASSIFICATION", "CLASSIFIED", "AWAITING_CREDITS", "PREPARING", "READY", "LABEL_READY"].reduce(
    (s, k) => s + (overview.shipmentsByStatus[k] ?? 0),
    0,
  );
  const capacityOptions = overview.preparers.map((p) => ({ ...p }));
  const noPreparer = !overview.preparers.some((p) => p.available);

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Bonjour ${actor.firstName}`}
        description="Pilotage de la plateforme : revenus, attributions, logistique et incidents en temps réel."
        actions={
          canAssign && overview.waiting.length > 0 ? (
            <Button asChild>
              <Link href="/admin/attributions">
                {overview.waiting.length} attribution{overview.waiting.length > 1 ? "s" : ""} en attente <ArrowRight />
              </Link>
            </Button>
          ) : null
        }
      />

      {one(sp.refus) === "permission" && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning-soft p-4 text-sm text-warning">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <p>Votre rôle d&apos;administration ne donne pas accès à la page demandée. Contactez un super administrateur si nécessaire.</p>
        </div>
      )}

      {lateCount > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 font-medium">
            <CircleAlert className="size-4" /> {lateCount} client{lateCount > 1 ? "s attendent" : " attend"} un préparateur depuis plus de 24 h.
          </p>
          <Button asChild size="sm" variant="outline" className="bg-background">
            <Link href="/admin/attributions">Traiter maintenant</Link>
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Revenu mensuel récurrent" value={formatMoney(overview.mrrCents)} icon={Wallet} tone="brand" hint={`${overview.activeSubscriptions} abonnement(s) actif(s)`} href="/admin/abonnements" />
        <StatCard label="Revenus du mois (net)" value={formatMoney(overview.revenueMonthCents)} icon={CreditCard} hint={overview.pastDue ? `${overview.pastDue} impayé(s)` : "Aucun impayé"} href="/admin/paiements" />
        <StatCard label="Nouveaux clients ce mois" value={overview.newCustomers} icon={Users} href="/admin/clients" />
        <StatCard label="Crédits consommés ce mois" value={overview.creditsConsumedMonth} icon={Coins} href="/admin/credits" />
        <StatCard label="Expéditions en cours" value={activeShipments} icon={Truck} href="/admin/expeditions" />
        <StatCard label="Commandes en acheminement" value={overview.ordersInTransit} icon={Package} href="/admin/commandes" />
        <StatCard label="Incidents ouverts" value={overview.openIncidents} icon={CircleAlert} tone={overview.openIncidents ? "danger" : "default"} href="/admin/incidents" />
        <StatCard
          label="Attributions en attente"
          value={overview.waiting.length}
          icon={Activity}
          tone={lateCount ? "danger" : overview.waiting.length ? "warning" : "success"}
          hint={lateCount ? `${lateCount} en retard` : "Délai cible : 24 h"}
          href="/admin/attributions"
        />
      </div>

      <Section
        title="Attributions en attente"
        description="Attribution exclusivement manuelle : choisissez le préparateur et confirmez."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/attributions">
              Tout voir <ArrowRight />
            </Link>
          </Button>
        }
      >
        {noPreparer && overview.waiting.length > 0 && (
          <p className="mb-4 rounded-xl bg-danger-soft p-3 text-sm text-danger">
            Aucun préparateur n&apos;est disponible : <Link href="/admin/preparateurs" className="font-medium underline">ajoutez un préparateur ou augmentez une capacité</Link>.
          </p>
        )}
        {overview.waiting.length === 0 ? (
          <EmptyState icon={Users} title="Aucun client en attente" description="Toutes les demandes d'attribution ont été traitées." />
        ) : (
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Souscription</TableHead>
                  <TableHead>Échéance 24 h</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.waiting.slice(0, 8).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/admin/clients/${c.id}`} className="font-medium hover:underline">
                        {c.user.firstName} {c.user.lastName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{c.referenceCode}</p>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDateTime(c.assignmentRequestedAt)}</TableCell>
                    <TableCell>
                      <SlaCountdown dueAt={c.assignmentDueAt?.toISOString() ?? null} requestedAt={c.assignmentRequestedAt?.toISOString() ?? null} />
                    </TableCell>
                    <TableCell>
                      <AssignmentStateBadge customer={c} />
                    </TableCell>
                    <TableCell className="text-right">
                      {canAssign && c.assignmentState !== "REASSIGNING" ? (
                        <AssignDialog customerId={c.id} customerName={`${c.user.firstName} ${c.user.lastName}`} options={capacityOptions} size="sm" label="Attribuer" canEditParcels={can(actor, "preparers.manage")} />
                      ) : (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/admin/clients/${c.id}`}>Ouvrir</Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Section
          title="Capacité des préparateurs"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/preparateurs">
                Gérer <ArrowRight />
              </Link>
            </Button>
          }
        >
          {overview.preparers.length === 0 ? (
            <EmptyState icon={Users} title="Aucun préparateur" description="Ajoutez votre premier préparateur pour commencer les attributions." />
          ) : (
            <ul className="divide-y">
              {overview.preparers.map((p) => (
                <li key={p.id} className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[1fr_8rem_8rem] sm:items-center">
                  <div className="min-w-0">
                    <Link href={`/admin/preparateurs/${p.id}`} className="text-sm font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{p.city}</span>
                      <StatusBadge tone={PREPARER_STATUS[p.status as keyof typeof PREPARER_STATUS]?.tone ?? "neutral"} label={PREPARER_STATUS[p.status as keyof typeof PREPARER_STATUS]?.label ?? p.status} />
                      {!p.available && p.status === "ACTIVE" && p.unavailableReason && <span className="text-warning">{p.unavailableReason}</span>}
                    </div>
                  </div>
                  <CapacityBar label="Clients" value={p.activeClients} max={p.maxClients} />
                  <CapacityBar label="Stock" value={p.storedUnits} max={p.storageCapacity} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Expéditions par statut"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/expeditions">
                Détail <ArrowRight />
              </Link>
            </Button>
          }
        >
          <ul className="space-y-2.5">
            {[...SHIPMENT_FLOW, "AWAITING_CREDITS" as const, "INCIDENT" as const].map((status) => {
              const count = overview.shipmentsByStatus[status] ?? 0;
              return (
                <li key={status} className="flex items-center justify-between gap-3 text-sm">
                  <StatusBadge tone={SHIPMENT_STATUS[status].tone} label={SHIPMENT_STATUS[status].label} />
                  <span className="font-medium tabular">{count}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      </div>

      {can(actor, "audit.read") && (
        <Section
          title="Activité récente"
          description="Dernières actions sensibles enregistrées dans le journal d'audit."
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/audit">
                Journal complet <ArrowRight />
              </Link>
            </Button>
          }
        >
          {audit.length === 0 ? (
            <EmptyState icon={Boxes} title="Aucune activité" />
          ) : (
            <ul className="divide-y">
              {audit.map((a) => (
                <li key={a.id} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{a.action}</code>
                      {a.summary && <span className="ml-2 text-muted-foreground">{a.summary}</span>}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {a.actor ? `${a.actor.firstName} ${a.actor.lastName}` : "Système"} · {formatRelative(a.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}

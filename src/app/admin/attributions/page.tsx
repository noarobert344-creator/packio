import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert, Clock, Gauge, Hourglass, Users } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { getAssignmentStats, listRecentAssignments, listWaitingCustomers } from "@/server/queries/admin-people";
import { computeSla, listPreparerCapacities } from "@/server/services/assignments";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssignDialog, NotifyDelayDialog } from "@/components/admin/people/assignment-dialogs";
import { AssignmentStateBadge, DemoBadge, TableWrap } from "@/components/admin/people/display";
import { SlaCountdown } from "@/components/admin/people/sla-countdown";
import { formatDateTime, formatDuration, fullName } from "@/lib/format";

export const metadata: Metadata = { title: "Attributions — Administration" };

export default async function AdminAssignmentsPage() {
  await requireAdmin("assignments.manage");
  const [waiting, capacities, stats, recent] = await Promise.all([listWaitingCustomers(), listPreparerCapacities(), getAssignmentStats(30), listRecentAssignments(15)]);
  const now = new Date();
  const withSla = waiting.map((c) => ({ ...c, sla: computeSla(c, now) }));
  const late = withSla.filter((c) => c.sla.isLate).length;
  const noneAvailable = !capacities.some((p) => p.available);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attributions"
        description="File d'attente des clients à attribuer. L'attribution est exclusivement manuelle et doit intervenir sous 24 h après la souscription."
      />

      {noneAvailable && (
        <div className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 font-medium">
            <CircleAlert className="size-4 shrink-0" /> Aucun préparateur n&apos;est disponible actuellement (capacité atteinte, absence, suspension ou point de réception non validé).
          </p>
          <Button asChild size="sm" variant="outline" className="bg-background">
            <Link href="/admin/preparateurs">Gérer les préparateurs</Link>
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="En attente" value={waiting.length} icon={Hourglass} tone={waiting.length ? "warning" : "success"} />
        <StatCard label="En retard (> 24 h)" value={late} icon={CircleAlert} tone={late ? "danger" : "default"} />
        <StatCard
          label="Délai moyen d'attribution"
          value={stats.avgWaitMinutes !== null ? formatDuration(stats.avgWaitMinutes) : "—"}
          icon={Clock}
          hint={stats.count ? `Sur ${stats.count} attribution(s), 30 derniers jours` : "Aucune attribution sur 30 jours"}
        />
        <StatCard label="Attribués sous 24 h" value={stats.withinSlaPercent !== null ? `${stats.withinSlaPercent} %` : "—"} icon={Gauge} tone="brand" hint="30 derniers jours" />
      </div>

      <Section title="File d'attente" description="Triée par échéance : les clients les plus urgents en premier.">
        {withSla.length === 0 ? (
          <EmptyState icon={Users} title="Aucun client en attente" description="Toutes les demandes d'attribution ont été traitées." />
        ) : (
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Offre</TableHead>
                  <TableHead>Souscription / demande</TableHead>
                  <TableHead>Échéance</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withSla.map((c) => {
                  const name = fullName(c.user);
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link href={`/admin/clients/${c.id}`} className="font-medium hover:underline">
                          {name}
                        </Link>
                        <DemoBadge show={c.user.isDemo} />
                        <p className="text-xs text-muted-foreground">
                          {c.referenceCode}
                          {c.currentPreparer && ` · actuel : ${fullName(c.currentPreparer.user)}`}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">{c.subscriptions[0]?.plan.name ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDateTime(c.assignmentRequestedAt)}</TableCell>
                      <TableCell>
                        <SlaCountdown dueAt={c.assignmentDueAt?.toISOString() ?? null} requestedAt={c.assignmentRequestedAt?.toISOString() ?? null} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <AssignmentStateBadge customer={c} />
                          {c.assignmentDelayNotifiedAt && <span className="text-[0.7rem] text-muted-foreground">Client informé</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          {c.currentPreparer ? (
                            <Button asChild size="sm">
                              <Link href={`/admin/clients/${c.id}`}>Réattribuer</Link>
                            </Button>
                          ) : (
                            <AssignDialog customerId={c.id} customerName={name} options={capacities} size="sm" label="Attribuer" />
                          )}
                          <NotifyDelayDialog customerId={c.id} size="sm" />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableWrap>
        )}
      </Section>

      <Section title="Historique récent" description="Les affectations terminées restent conservées pour la traçabilité des colis.">
        {recent.length === 0 ? (
          <EmptyState icon={Users} title="Aucune attribution pour le moment" />
        ) : (
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Préparateur</TableHead>
                  <TableHead>Attribué par</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Délai</TableHead>
                  <TableHead>État</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link href={`/admin/clients/${a.customerId}`} className="text-sm font-medium hover:underline">
                        {fullName(a.customer.user)}
                      </Link>
                      <p className="text-xs text-muted-foreground">{a.customer.referenceCode}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={`/admin/preparateurs/${a.preparerId}`} className="hover:underline">
                        {fullName(a.preparer.user)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{fullName(a.assignedBy)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDateTime(a.assignedAt)}</TableCell>
                    <TableCell className="text-sm tabular">
                      {a.waitMinutes !== null ? (
                        <span className={a.waitMinutes > 24 * 60 ? "text-danger" : undefined}>{formatDuration(a.waitMinutes)}</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {a.status === "ACTIVE" ? <StatusBadge tone="success" label="Active" /> : <StatusBadge tone="neutral" label={`Terminée${a.endReason ? ` — ${a.endReason}` : ""}`} />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        )}
      </Section>
    </div>
  );
}

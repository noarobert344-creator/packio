import type { Metadata } from "next";
import Link from "next/link";
import { Coins, Gauge, Hourglass, Timer } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { getOperationsSeries, getRevenueSeries } from "@/server/services/stats";
import { getAccountingSeries } from "@/server/queries/stats";
import { CsvLink } from "@/components/shared/stats-ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { assignmentSlaStats, creditsConsumedTotal, shipmentsBySize, topPreparers } from "@/server/queries/admin-ops";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { HorizontalBars, LineChart, StackedColumns, VizStyle } from "@/components/admin/ops/charts";
import { PARCEL_SIZE } from "@/lib/labels";
import { formatDate, formatDuration, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Statistiques" };

const SIZE_ORDER = ["SMALL", "MEDIUM", "LARGE"] as const;

function monthLabel(key: string) {
  return formatDate(new Date(`${key}-01T12:00:00`), "MMM yy");
}

export default async function AdminStatsPage() {
  await requireAdmin("stats.read");
  const [revenue, operations, sla, sizes, consumed, top, planMix, accounting] = await Promise.all([
    getRevenueSeries(6),
    getOperationsSeries(30),
    assignmentSlaStats(90),
    shipmentsBySize(),
    creditsConsumedTotal(),
    topPreparers(5),
    db.subscription.groupBy({ by: ["planId"], where: { status: { in: ["ACTIVE", "TRIALING"] } }, _count: true }),
    getAccountingSeries(6),
  ]);
  const plans = await db.plan.findMany({ where: { id: { in: planMix.map((p) => p.planId) } }, select: { id: true, name: true, sortOrder: true } });
  const revenueTotal = revenue.reduce((s, r) => s + r.subscriptions + r.credits, 0);
  const received = operations.reduce((s, d) => s + d.received, 0);
  const shipped = operations.reduce((s, d) => s + d.shipped, 0);

  return (
    <>
      <VizStyle />
      <PageHeader title="Statistiques" description="Revenus, volumes logistiques et délais d'attribution, calculés à partir des données réelles de la plateforme." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Délai moyen d'attribution" value={sla.avgMinutes !== null ? formatDuration(sla.avgMinutes) : "—"} icon={Timer} tone="brand" hint={`${sla.count} attribution(s) sur ${sla.days} jours`} />
        <StatCard label="Délai médian" value={sla.medianMinutes !== null ? formatDuration(sla.medianMinutes) : "—"} icon={Hourglass} />
        <StatCard
          label="Attribués sous 24 h"
          value={sla.withinRate !== null ? `${Math.round(sla.withinRate * 100)} %` : "—"}
          icon={Gauge}
          tone={sla.withinRate === null ? "default" : sla.withinRate >= 0.95 ? "success" : "warning"}
        />
        <StatCard label="Crédits consommés (total)" value={consumed} icon={Coins} hint="Débits définitifs au dépôt" />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Section>
          <StackedColumns
            title="Revenus encaissés par mois"
            description={`6 derniers mois, remboursements déduits — total ${formatMoney(revenueTotal)}`}
            data={revenue.map((r) => ({ label: monthLabel(r.month), values: { subscriptions: r.subscriptions, credits: r.credits } }))}
            series={[
              { key: "subscriptions", label: "Abonnements", color: "1" },
              { key: "credits", label: "Recharges de crédits", color: "2" },
            ]}
            valueKind="money"
          />
        </Section>
        <Section>
          <LineChart
            title="Colis reçus et expédiés par jour"
            description={`30 derniers jours — ${received} commande(s) mise(s) en stock, ${shipped} colis déposé(s)`}
            data={operations.map((d) => ({ x: d.day, label: formatDate(new Date(`${d.day}T12:00:00`), "d MMM"), values: { received: d.received, shipped: d.shipped } }))}
            series={[
              { key: "received", label: "Mises en stock", color: "1" },
              { key: "shipped", label: "Colis déposés", color: "2" },
            ]}
          />
        </Section>
        <Section>
          <HorizontalBars
            title="Répartition des abonnements actifs"
            description="Nombre d'abonnés par offre"
            data={plans
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((p) => ({ label: p.name, value: planMix.find((m) => m.planId === p.id)?._count ?? 0 }))}
          />
        </Section>
        <Section>
          <HorizontalBars
            title="Expéditions par catégorie de colis"
            description="Hors annulations — crédits de préparation associés"
            data={SIZE_ORDER.map((size) => {
              const row = sizes.find((s) => s.size === size);
              return { label: PARCEL_SIZE[size].label, value: row?.count ?? 0, hint: `${row?.credits ?? 0} crédit(s)` };
            })}
          />
        </Section>
      </div>
      <Section
        title="Comptabilité mensuelle"
        description="Encaissements Whop (TTC), remboursements et crédits consommés. Le détail ligne à ligne se télécharge en CSV."
        className="mt-6"
        contentClassName="p-0"
        actions={
          <div className="flex flex-wrap gap-2">
            <CsvLink href="/api/admin/export/paiements" label="Paiements" />
            <CsvLink href="/api/admin/export/credits" label="Crédits" />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Mois</TableHead>
                <TableHead className="text-right">Paiements</TableHead>
                <TableHead className="text-right">Abonnements</TableHead>
                <TableHead className="text-right">Recharges</TableHead>
                <TableHead className="text-right">Remboursements</TableHead>
                <TableHead className="text-right">Net encaissé</TableHead>
                <TableHead className="pr-5 text-right">Crédits consommés</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...accounting].reverse().map((r) => (
                <TableRow key={r.month}>
                  <TableCell className="pl-5 capitalize">{formatDate(new Date(`${r.month}-01T12:00:00`), "MMMM yyyy")}</TableCell>
                  <TableCell className="text-right tabular">{r.payments}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(r.subscriptionCents)}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(r.creditPackCents)}</TableCell>
                  <TableCell className="text-right tabular">{r.refundedCents ? `−${formatMoney(r.refundedCents)}` : formatMoney(0)}</TableCell>
                  <TableCell className="text-right font-medium tabular">{formatMoney(r.netCents)}</TableCell>
                  <TableCell className="pr-5 text-right tabular">{r.creditsConsumed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
      <Section title="Préparateurs les plus actifs" description="Colis traités (réceptions mises en stock et expéditions déposées)." className="mt-6">
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun préparateur.</p>
        ) : (
          <ol className="divide-y">
            {top.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="w-5 text-sm text-muted-foreground tabular">{i + 1}</span>
                <Link href={`/admin/preparateurs/${p.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                  {p.user.firstName} {p.user.lastName}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{p.city}</span>
                </Link>
                <span className="text-xs text-muted-foreground">{p._count.assignments} client(s)</span>
                <span className="w-24 text-right text-sm font-semibold tabular">{p.parcelsProcessed} colis</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}

import type { Metadata } from "next";
import { Coins, PackageCheck, Truck, Users } from "lucide-react";
import { requirePreparer } from "@/server/auth/current";
import { getPreparerActivity } from "@/server/queries/stats";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { CsvLink, monthLabel } from "@/components/shared/stats-ui";
import { StackedColumns, VizStyle } from "@/components/admin/ops/charts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Statistiques" };

export default async function PreparerStatsPage() {
  const actor = await requirePreparer();
  const { rows, totals, activeClients } = await getPreparerActivity(actor.preparerId);
  return (
    <div className="space-y-6">
      <VizStyle />
      <PageHeader
        title="Statistiques et comptabilité"
        description="Votre activité des 6 derniers mois : colis reçus, colis déposés et crédits de préparation débités à vos clients."
        actions={<CsvLink href="/api/exports/colis" label="Colis déposés (CSV)" />}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Clients actifs" value={activeClients} icon={Users} tone="brand" />
        <StatCard label="Colis reçus" value={totals.received} icon={PackageCheck} hint="Mis en stock ou en dropshipping" />
        <StatCard label="Colis déposés" value={totals.shipped} icon={Truck} hint={`dont ${totals.dropship} en dropshipping`} />
        <StatCard label="Crédits de préparation" value={totals.credits} icon={Coins} hint="Débités au dépôt des colis" />
      </div>
      <Section>
        <StackedColumns
          title="Colis déposés par mois"
          description="Envois depuis le stock (retours compris) et dropshipping"
          data={rows.map((r) => ({ label: monthLabel(r.month, "MMM yy"), values: { stock: r.shippedStock + r.returns, dropship: r.shippedDropship } }))}
          series={[
            { key: "stock", label: "Stock", color: "1" },
            { key: "dropship", label: "Dropshipping", color: "2" },
          ]}
        />
      </Section>
      <Section title="Détail mensuel" contentClassName="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Mois</TableHead>
                <TableHead className="text-right">Reçus (stock)</TableHead>
                <TableHead className="text-right">Reçus (dropshipping)</TableHead>
                <TableHead className="text-right">Déposés (stock)</TableHead>
                <TableHead className="text-right">Déposés (dropshipping)</TableHead>
                <TableHead className="text-right">Retours</TableHead>
                <TableHead className="pr-5 text-right">Crédits</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...rows].reverse().map((r) => (
                <TableRow key={r.month}>
                  <TableCell className="pl-5 capitalize">{monthLabel(r.month)}</TableCell>
                  <TableCell className="text-right tabular">{r.receivedStock}</TableCell>
                  <TableCell className="text-right tabular">{r.receivedDropship}</TableCell>
                  <TableCell className="text-right tabular">{r.shippedStock}</TableCell>
                  <TableCell className="text-right tabular">{r.shippedDropship}</TableCell>
                  <TableCell className="text-right tabular">{r.returns}</TableCell>
                  <TableCell className="pr-5 text-right font-medium tabular">{r.credits}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
    </div>
  );
}

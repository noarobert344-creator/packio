import type { Metadata } from "next";
import { Coins, Receipt, ShoppingBag, Truck } from "lucide-react";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { getCustomerStats } from "@/server/queries/stats";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { CsvLink, monthLabel } from "@/components/shared/stats-ui";
import { StackedColumns, VizStyle } from "@/components/admin/ops/charts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Statistiques" };

export default async function CustomerStatsPage() {
  const { customer } = await requireSubscribedCustomer();
  const { rows, totals } = await getCustomerStats(customer.id);
  return (
    <div className="space-y-6">
      <VizStyle />
      <PageHeader
        title="Statistiques et comptabilité"
        description="Vos ventes, vos colis, vos crédits et vos dépenses Packio sur les 6 derniers mois. Les exports CSV s'ouvrent dans Excel ou Google Sheets."
        actions={
          <div className="flex flex-wrap gap-2">
            <CsvLink href="/api/exports/ventes" label="Ventes" />
            <CsvLink href="/api/exports/paiements" label="Paiements" />
            <CsvLink href="/api/exports/credits" label="Crédits" />
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ventes (6 mois)" value={totals.sales} icon={ShoppingBag} tone="brand" hint={`${formatMoney(totals.salesCents)} de chiffre d'affaires`} />
        <StatCard label="Colis expédiés" value={totals.shipped} icon={Truck} hint="Stock et dropshipping" />
        <StatCard label="Crédits utilisés" value={totals.creditsUsed} icon={Coins} />
        <StatCard label="Dépenses Packio" value={formatMoney(totals.spentCents)} icon={Receipt} hint="Abonnement et recharges, remboursements déduits" />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Section>
          <StackedColumns
            title="Ventes par mois"
            description="Vinted et Vestiaire Collective, selon leur traitement"
            data={rows.map((r) => ({ label: monthLabel(r.month, "MMM yy"), values: { packio: r.salesPackio, dropship: r.salesDropship } }))}
            series={[
              { key: "packio", label: "Depuis le stock (Packio)", color: "1" },
              { key: "dropship", label: "Dropshipping", color: "2" },
            ]}
          />
        </Section>
        <Section>
          <StackedColumns
            title="Dépenses par mois"
            description="Montants payés à Packio, remboursements déduits"
            data={rows.map((r) => ({ label: monthLabel(r.month, "MMM yy"), values: { subscription: r.subscriptionCents, credits: r.creditPackCents } }))}
            series={[
              { key: "subscription", label: "Abonnement", color: "1" },
              { key: "credits", label: "Recharges de crédits", color: "2" },
            ]}
            valueKind="money"
          />
        </Section>
      </div>
      <Section title="Détail mensuel" contentClassName="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Mois</TableHead>
                <TableHead className="text-right">Ventes</TableHead>
                <TableHead className="text-right">Chiffre d&apos;affaires</TableHead>
                <TableHead className="text-right">Colis (stock)</TableHead>
                <TableHead className="text-right">Colis (dropshipping)</TableHead>
                <TableHead className="text-right">Retours</TableHead>
                <TableHead className="text-right">Crédits utilisés</TableHead>
                <TableHead className="pr-5 text-right">Dépenses Packio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...rows].reverse().map((r) => (
                <TableRow key={r.month}>
                  <TableCell className="pl-5 capitalize">{monthLabel(r.month)}</TableCell>
                  <TableCell className="text-right tabular">{r.salesPackio + r.salesDropship + r.salesOther}</TableCell>
                  <TableCell className="text-right tabular">{formatMoney(r.salesCents)}</TableCell>
                  <TableCell className="text-right tabular">{r.shippedStock}</TableCell>
                  <TableCell className="text-right tabular">{r.shippedDropship}</TableCell>
                  <TableCell className="text-right tabular">{r.returns}</TableCell>
                  <TableCell className="text-right tabular">{r.creditsUsed}</TableCell>
                  <TableCell className="pr-5 text-right font-medium tabular">{formatMoney(r.subscriptionCents + r.creditPackCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
    </div>
  );
}

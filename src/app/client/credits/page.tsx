import type { Metadata } from "next";
import {
  CalendarClock,
  CheckCircle2,
  Coins,
  Lock,
  ShoppingCart,
  Wallet,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { Pagination } from "@/components/shared/list-controls";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { db } from "@/server/db";
import {
  getWalletOverview,
  listCreditTransactions,
} from "@/server/services/credits";
import { getSetting } from "@/server/services/settings";
import { getSizeRules } from "@/server/services/shipments";
import { buyCreditsAction } from "@/server/actions/customer";
import { CREDIT_TX_TYPE } from "@/lib/labels";
import { CREDIT_PACK_SIZES } from "@/lib/credit-packs";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { one, parsePage, type SearchParams } from "@/lib/params";
import { AutoRefresh } from "@/components/shared/auto-refresh";

export const metadata: Metadata = { title: "Mes crédits" };

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { customer } = await requireSubscribedCustomer();
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const [overview, ledger, packs, policy, rules] = await Promise.all([
    getWalletOverview(customer.id),
    listCreditTransactions(customer.id, { take: 25, skip: (page - 1) * 25 }),
    db.creditPack.findMany({
      where: { isActive: true, credits: { in: [...CREDIT_PACK_SIZES] } },
      orderBy: { credits: "asc" },
    }),
    getSetting("credits"),
    getSizeRules(),
  ]);
  const w = overview.wallet;
  const bestPackId =
    packs.length > 1
      ? [...packs].sort(
          (a, b) => a.priceCents / a.credits - b.priceCents / b.credits,
        )[0].id
      : null;
  return (
    <div className="space-y-8">
      <PageHeader
        title="Mes crédits"
        description="Les crédits paient la préparation de vos colis. Les frais de transport éventuels sont facturés séparément."
        actions={
          <Button asChild>
            <a href="#recharger">
              <ShoppingCart /> Acheter des crédits
            </a>
          </Button>
        }
      />
      {one(sp.recharge) === "confirmee" && (
        <p className="flex items-center gap-2 rounded-xl bg-success-soft px-4 py-3 text-sm text-success">
          <CheckCircle2 className="size-4" /> Recharge confirmée. Les crédits
          peuvent mettre quelques secondes à apparaître.
          <AutoRefresh everyMs={3000} maxTries={10} />
        </p>
      )}
      {one(sp.recharge) === "annulee" && (
        <p className="flex items-center gap-2 rounded-xl bg-muted px-4 py-3 text-sm">
          <XCircle className="size-4" /> Achat annulé : aucun montant n&apos;a
          été débité.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard
          label="Solde disponible"
          value={overview.available}
          icon={Wallet}
          tone="brand"
        />
        <StatCard
          label="Crédits mensuels"
          value={w.monthlyBalance}
          icon={CalendarClock}
        />
        <StatCard
          label="Crédits achetés"
          value={w.purchasedBalance}
          icon={ShoppingCart}
        />
        <StatCard
          label="Crédits réservés"
          value={w.reservedBalance}
          icon={Lock}
          hint="En attente de dépôt"
        />
        <StatCard
          label="Crédits consommés"
          value={w.consumedTotal}
          icon={Coins}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Section
          title="Acheter des crédits supplémentaires"
          description="En plus des crédits mensuels de votre abonnement. Ajoutés dès le paiement confirmé ; les expéditions en attente de crédits reprennent automatiquement."
          className="scroll-mt-24"
          contentClassName="space-y-4"
        >
          <span id="recharger" className="block scroll-mt-28" aria-hidden />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {packs.map((p) => {
              const best = p.id === bestPackId;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "relative flex flex-col gap-3 rounded-xl border p-4",
                    best && "border-brand ring-1 ring-brand",
                  )}
                >
                  {best && (
                    <span className="absolute -top-2.5 left-4 rounded-full bg-brand px-2 py-0.5 text-[0.65rem] font-medium text-brand-foreground">
                      Meilleur prix
                    </span>
                  )}
                  <p>
                    <span className="text-3xl font-semibold tracking-tight tabular">
                      {p.credits}
                    </span>{" "}
                    <span className="text-sm text-muted-foreground">
                      crédits
                    </span>
                  </p>
                  <div>
                    <p className="text-lg font-semibold tabular">
                      {formatMoney(p.priceCents, p.currency)} HT
                    </p>
                    <p className="text-xs text-muted-foreground">
                      soit{" "}
                      {formatMoney(
                        Math.round(p.priceCents / p.credits),
                        p.currency,
                      )}{" "}
                      le crédit
                    </p>
                  </div>
                  <ActionForm
                    action={buyCreditsAction}
                    silent
                    className="mt-auto"
                  >
                    <input type="hidden" name="packId" value={p.id} />
                    <SubmitButton
                      className="w-full"
                      variant={best ? "default" : "outline"}
                      pendingLabel="Redirection…"
                    >
                      <ShoppingCart /> Acheter
                    </SubmitButton>
                  </ActionForm>
                </div>
              );
            })}
          </div>
        </Section>
        <Section title="Règles" contentClassName="space-y-3 text-sm">
          <ul className="space-y-1.5">
            {rules.map((r) => (
              <li key={r.id} className="flex justify-between">
                <span>{r.label}</span>
                <span className="font-medium">
                  {r.creditCost} crédit{r.creditCost > 1 ? "s" : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {policy.monthly.mode === "EXPIRE"
              ? "Les crédits mensuels non utilisés expirent au renouvellement de l'abonnement."
              : `Les crédits mensuels non utilisés sont reportés pendant ${policy.monthly.rolloverMonths} mois (dans la limite de ${policy.monthly.rolloverCapPercent} % de votre allocation mensuelle).`}{" "}
            {policy.purchased.mode === "NEVER"
              ? "Les crédits achetés n'expirent pas tant que votre compte est actif."
              : `Les crédits achetés expirent ${policy.purchased.days} jours après l'achat.`}{" "}
            Les crédits mensuels sont utilisés en priorité.
          </p>
          {overview.upcomingExpirations.length > 0 && (
            <div className="rounded-xl bg-warning-soft p-3 text-xs text-warning">
              <p className="mb-1 font-medium">Prochaines expirations</p>
              {overview.upcomingExpirations.map((e, i) => (
                <p key={i}>
                  {e.amount} crédit(s){" "}
                  {e.bucket === "MONTHLY" ? "mensuels" : "achetés"} le{" "}
                  {formatDate(e.expiresAt)}
                </p>
              ))}
            </div>
          )}
        </Section>
      </div>
      <Section
        title="Historique détaillé"
        description="Registre de toutes les opérations sur votre portefeuille."
        contentClassName="p-0"
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Date</TableHead>
                <TableHead>Opération</TableHead>
                <TableHead>Détail</TableHead>
                <TableHead className="text-right">Variation</TableHead>
                <TableHead className="pr-5 text-right">Solde après</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.items.map((t) => {
                const shown = t.amount;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="pl-5 text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(t.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {CREDIT_TX_TYPE[t.type]}
                    </TableCell>
                    <TableCell className="max-w-sm text-xs text-muted-foreground">
                      {t.description}
                      {t.reason ? ` — ${t.reason}` : ""}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium tabular",
                        t.type === "CAPTURE"
                          ? "text-muted-foreground"
                          : shown > 0
                            ? "text-success"
                            : shown < 0
                              ? "text-danger"
                              : "",
                      )}
                    >
                      {t.type === "CAPTURE"
                        ? `${t.reservedDelta} débité`
                        : shown > 0
                          ? `+${shown}`
                          : shown}
                    </TableCell>
                    <TableCell className="pr-5 text-right text-xs whitespace-nowrap tabular text-muted-foreground">
                      {t.monthlyAfter + t.purchasedAfter} dispo. ·{" "}
                      {t.reservedAfter} rés.
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="px-5 pb-4">
          <Pagination
            page={page}
            pageSize={25}
            total={ledger.total}
            basePath="/client/credits"
            params={{}}
          />
        </div>
      </Section>
    </div>
  );
}

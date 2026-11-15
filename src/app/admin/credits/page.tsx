import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { CalendarClock, Coins, Lock, ShoppingBag, Wallet } from "lucide-react";
import type { CreditTransactionType } from "@/generated/prisma/enums";
import { requireAdmin } from "@/server/auth/current";
import { can } from "@/server/auth/actor";
import { getSetting } from "@/server/services/settings";
import { PAGE_SIZE, creditTotals, listCreditTransactions, searchCustomersForAdjust } from "@/server/queries/admin-ops";
import { adjustCreditsAction, saveCreditPolicyAction, saveCustomCreditPurchaseAction } from "@/server/actions/admin/ops";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { ActionDialog } from "@/components/shared/action-dialog";
import { CheckboxField, RequestIdInput, SelectField, TextAreaField, TextField } from "@/components/shared/form-field";
import { FilterSelect, Pagination, SearchInput } from "@/components/shared/list-controls";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomerLink, ExportLink } from "@/components/admin/ops/ui";
import { CREDIT_TX_TYPE } from "@/lib/labels";
import { formatDateTime, fullName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { one, oneOf, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Crédits" };

const TX_TYPES = Object.keys(CREDIT_TX_TYPE) as CreditTransactionType[];

export default async function AdminCreditsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdmin("billing.read");
  const canManage = can(actor, "credits.manage");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const type = oneOf(sp.type, TX_TYPES);
  const customer = one(sp.client);
  const adjustQuery = one(sp.ajuster);
  const canBilling = can(actor, "billing.manage");
  const [totals, policy, ledger, candidates, purchase] = await Promise.all([
    creditTotals(),
    getSetting("credits"),
    listCreditTransactions({ type, customer, page }),
    canManage && adjustQuery ? searchCustomersForAdjust(adjustQuery) : Promise.resolve([]),
    getSetting("creditPurchase"),
  ]);

  return (
    <>
      <PageHeader
        title="Crédits"
        description="Politique d'expiration, soldes des portefeuilles et registre transactionnel de toutes les opérations de crédits."
        actions={<ExportLink entity="credits" />}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Crédits mensuels disponibles" value={totals.monthly} icon={CalendarClock} tone="brand" hint={`${totals.wallets} portefeuille(s)`} />
        <StatCard label="Crédits achetés disponibles" value={totals.purchased} icon={ShoppingBag} />
        <StatCard label="Crédits réservés" value={totals.reserved} icon={Lock} hint="Expéditions en attente de dépôt" />
        <StatCard label="Crédits consommés (total)" value={totals.consumed} icon={Coins} tone="success" />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Section title="Politique des crédits" description="S'applique aux prochaines allocations mensuelles et aux prochains achats ; les lots existants conservent leur échéance.">
          <ActionForm action={saveCreditPolicyAction} className="grid gap-5">
            <fieldset disabled={!canManage} className="grid gap-3">
              <legend className="mb-1 text-sm font-semibold">Crédits mensuels de l&apos;abonnement</legend>
              <SelectField
                name="monthlyMode"
                label="Crédits non utilisés au renouvellement"
                defaultValue={policy.monthly.mode}
                options={[
                  { value: "EXPIRE", label: "Expirent au renouvellement" },
                  { value: "ROLLOVER", label: "Sont reportés (avec plafond)" },
                ]}
              />
              <div className="grid grid-cols-2 gap-3">
                <TextField name="rolloverMonths" label="Durée du report (mois)" type="number" min={1} max={12} defaultValue={policy.monthly.rolloverMonths} hint="Mode report uniquement" />
                <TextField name="rolloverCapPercent" label="Plafond du report (%)" type="number" min={0} max={1000} defaultValue={policy.monthly.rolloverCapPercent} hint="En % de l'allocation mensuelle" />
              </div>
            </fieldset>
            <fieldset disabled={!canManage} className="grid gap-3 border-t pt-4">
              <legend className="mb-1 text-sm font-semibold">Crédits achetés séparément</legend>
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  name="purchasedMode"
                  label="Validité"
                  defaultValue={policy.purchased.mode}
                  options={[
                    { value: "NEVER", label: "Sans expiration" },
                    { value: "EXPIRE_AFTER_DAYS", label: "Expirent après un délai" },
                  ]}
                />
                <TextField name="purchasedDays" label="Délai (jours)" type="number" min={1} max={3650} defaultValue={policy.purchased.days} hint="Si expiration activée" />
              </div>
            </fieldset>
            <p className="text-xs text-muted-foreground">
              Ordre de consommation : crédits mensuels d&apos;abord, puis achetés, par échéance la plus proche. Chaque opération est inscrite dans le registre (ajout seul).
            </p>
            {canManage && (
              <div>
                <SubmitButton pendingLabel="Enregistrement…">Enregistrer la politique</SubmitButton>
              </div>
            )}
          </ActionForm>
        </Section>

        <Section title="Ajuster un solde" description="Créditer, débiter ou corriger un portefeuille avec justification obligatoire et journal d'audit.">
          {!canManage ? (
            <p className="text-sm text-muted-foreground">Votre rôle ne permet pas d&apos;ajuster les soldes.</p>
          ) : (
            <div className="grid gap-4">
              <SearchInput param="ajuster" placeholder="Rechercher un client (nom, e-mail, code)" className="sm:w-full" />
              {!adjustQuery && <p className="text-sm text-muted-foreground">Recherchez un client pour créditer ou débiter son portefeuille. Les crédits ajoutés relancent automatiquement ses expéditions en attente de crédits.</p>}
              {adjustQuery && candidates.length === 0 && <p className="text-sm text-muted-foreground">Aucun client trouvé.</p>}
              <ul className="divide-y rounded-xl border empty:hidden">
                {candidates.map((c) => (
                  <li key={c.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 text-sm">
                      <Link href={`/admin/clients/${c.id}`} className="font-medium hover:underline">
                        {fullName(c.user)}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.referenceCode} · {c.user.email} · {c.wallet ? `${c.wallet.monthlyBalance + c.wallet.purchasedBalance} dispo, ${c.wallet.reservedBalance} réservé(s)` : "pas de portefeuille"}
                      </p>
                    </div>
                    <ActionDialog
                      trigger={
                        <Button size="sm" variant="outline">
                          <Wallet /> Ajuster
                        </Button>
                      }
                      title={`Ajuster le solde de ${fullName(c.user)}`}
                      description="L'opération est idempotente, tracée dans le registre et le journal d'audit."
                      action={adjustCreditsAction}
                      submitLabel="Valider l'opération"
                    >
                      <input type="hidden" name="customerId" value={c.id} />
                      <RequestIdInput value={randomUUID()} />
                      <div className="grid grid-cols-2 gap-3">
                        <SelectField name="direction" label="Opération" defaultValue="CREDIT" options={[{ value: "CREDIT", label: "Créditer" }, { value: "DEBIT", label: "Débiter" }]} />
                        <TextField name="amount" label="Nombre de crédits" type="number" min={1} required />
                      </div>
                      <SelectField
                        name="bucket"
                        label="Type de crédits"
                        defaultValue="PURCHASED"
                        options={[
                          { value: "PURCHASED", label: "Crédits hors abonnement (politique « achetés »)" },
                          { value: "MONTHLY", label: "Crédits mensuels" },
                        ]}
                      />
                      <TextAreaField name="reason" label="Justification" required rows={3} hint="Obligatoire — visible dans l'historique du client." />
                    </ActionDialog>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </div>

      <Section
        title="Achat de crédits en quantité libre"
        description="Permet aux clients d'acheter le nombre exact de crédits dont ils ont besoin, en plus des recharges par lots (gérées dans Abonnements). Le prix est appliqué côté serveur au moment du paiement."
        className="mb-6"
      >
        <ActionForm action={saveCustomCreditPurchaseAction} className="grid gap-4">
          <fieldset disabled={!canBilling} className="grid gap-4">
            <CheckboxField name="customEnabled" label="Proposer l'achat en quantité libre aux clients" defaultChecked={purchase.customEnabled} />
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField name="unitPrice" label="Prix TTC par crédit (€)" inputMode="decimal" defaultValue={(purchase.unitPriceCents / 100).toFixed(2).replace(".", ",")} required />
              <TextField name="minCredits" label="Minimum par achat" type="number" min={1} max={10000} defaultValue={purchase.minCredits} required />
              <TextField name="maxCredits" label="Maximum par achat" type="number" min={1} max={10000} defaultValue={purchase.maxCredits} required />
            </div>
          </fieldset>
          {canBilling && (
            <div>
              <SubmitButton pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
            </div>
          )}
        </ActionForm>
      </Section>

      <Section
        title="Registre des opérations"
        description="Toutes les écritures de crédits, de la plus récente à la plus ancienne."
        actions={
          <div className="flex flex-col gap-2 sm:flex-row">
            <SearchInput param="client" placeholder="Filtrer par client" />
            <FilterSelect param="type" options={TX_TYPES.map((t) => ({ value: t, label: CREDIT_TX_TYPE[t] }))} placeholder="Tous les types" />
          </div>
        }
        contentClassName="p-0"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Date</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Opération</TableHead>
              <TableHead className="text-right">Disponible</TableHead>
              <TableHead className="text-right">Réservé</TableHead>
              <TableHead className="text-right">Solde après</TableHead>
              <TableHead className="min-w-64">Détail</TableHead>
              <TableHead className="pr-5">Par</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledger.items.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="pl-5 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(t.createdAt)}</TableCell>
                <TableCell>
                  <CustomerLink customer={t.wallet.customer} />
                </TableCell>
                <TableCell className="font-medium">{CREDIT_TX_TYPE[t.type]}</TableCell>
                <TableCell className={cn("text-right tabular", t.amount > 0 ? "text-success" : t.amount < 0 ? "text-danger" : "text-muted-foreground")}>
                  {t.amount > 0 ? `+${t.amount}` : t.amount}
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular">{t.reservedDelta > 0 ? `+${t.reservedDelta}` : t.reservedDelta}</TableCell>
                <TableCell className="text-right text-xs tabular">
                  {t.monthlyAfter + t.purchasedAfter} <span className="text-muted-foreground">(+{t.reservedAfter} rés.)</span>
                </TableCell>
                <TableCell className="max-w-80 text-xs whitespace-normal">
                  {t.description}
                  {t.shipment && (
                    <Link href={`/admin/expeditions/${t.shipment.id}`} className="ml-1 text-brand hover:underline">
                      {t.shipment.reference}
                    </Link>
                  )}
                  {t.reason && <span className="block text-muted-foreground">Motif : {t.reason}</span>}
                </TableCell>
                <TableCell className="pr-5 text-xs">{t.actor ? fullName(t.actor) : "Système"}</TableCell>
              </TableRow>
            ))}
            {ledger.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  Aucune opération.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="px-5 pb-4">
          <Pagination page={page} pageSize={PAGE_SIZE} total={ledger.total} basePath="/admin/credits" params={{ type, client: customer, ajuster: adjustQuery }} />
        </div>
      </Section>
    </>
  );
}

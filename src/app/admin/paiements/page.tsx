import type { Metadata } from "next";
import { BadgeEuro, CircleAlert, Receipt, Undo2 } from "lucide-react";
import type { PaymentKind, PaymentStatus, WebhookEventStatus } from "@/generated/prisma/enums";
import { requireAdmin } from "@/server/auth/current";
import { can } from "@/server/auth/actor";
import { PAGE_SIZE, listInvoices, listPayments, listWebhookEvents, paymentKpis } from "@/server/queries/admin-ops";
import { refundPaymentAction } from "@/server/actions/admin/ops";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge, StatusFrom } from "@/components/shared/status-badge";
import { ActionDialog } from "@/components/shared/action-dialog";
import { CheckboxField, TextAreaField, TextField } from "@/components/shared/form-field";
import { FilterSelect, FilterTabs, Pagination, SearchInput } from "@/components/shared/list-controls";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomerLink, ExportLink } from "@/components/admin/ops/ui";
import { PAYMENT_STATUS, type Tone } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { one, oneOf, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Paiements" };

const STATUSES = Object.keys(PAYMENT_STATUS) as PaymentStatus[];
const KINDS: { value: PaymentKind; label: string }[] = [
  { value: "SUBSCRIPTION", label: "Abonnement" },
  { value: "CREDIT_PACK", label: "Recharge de crédits" },
  { value: "OTHER", label: "Autre" },
];
const WEBHOOK_STATUS: Record<WebhookEventStatus, { label: string; tone: Tone }> = {
  PROCESSING: { label: "En cours", tone: "info" },
  PROCESSED: { label: "Traité", tone: "success" },
  FAILED: { label: "Échec", tone: "danger" },
  IGNORED: { label: "Ignoré", tone: "neutral" },
};
const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  paid: { label: "Payée", tone: "success" },
  open: { label: "À payer", tone: "warning" },
  draft: { label: "Brouillon", tone: "neutral" },
  void: { label: "Annulée", tone: "neutral" },
  uncollectible: { label: "Irrécouvrable", tone: "danger" },
};

export default async function AdminPaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdmin("billing.read");
  const canRefund = can(actor, "billing.manage");
  const sp = await searchParams;
  const tab = oneOf(sp.onglet, ["factures", "echecs", "webhooks"] as const) ?? "";
  const page = parsePage(sp.page);
  const q = one(sp.q);
  const status = oneOf(sp.statut, STATUSES);
  const kind = oneOf(sp.type, KINDS.map((k) => k.value));
  const kpis = await paymentKpis(30);

  return (
    <>
      <PageHeader title="Paiements" description="Encaissements, factures, échecs de paiement et journal des webhooks Whop." actions={<ExportLink entity="paiements" />} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Encaissé sur 30 jours" value={formatMoney(kpis.grossCents)} icon={BadgeEuro} tone="brand" hint={`${kpis.count} paiement(s)`} />
        <StatCard label="Remboursé sur 30 jours" value={formatMoney(kpis.refundedCents)} icon={Undo2} />
        <StatCard label="Net sur 30 jours" value={formatMoney(kpis.grossCents - kpis.refundedCents)} icon={Receipt} tone="success" />
        <StatCard label="Échecs sur 30 jours" value={kpis.failed} icon={CircleAlert} tone={kpis.failed ? "danger" : "default"} href="/admin/paiements?onglet=echecs" />
      </div>
      <div className="mb-4">
        <FilterTabs
          param="onglet"
          options={[
            { value: "", label: "Paiements" },
            { value: "factures", label: "Factures" },
            { value: "echecs", label: "Échecs de paiement" },
            { value: "webhooks", label: "Webhooks Whop" },
          ]}
        />
      </div>
      {tab === "factures" ? (
        <InvoicesTab q={q} page={page} />
      ) : tab === "webhooks" ? (
        <WebhooksTab page={page} status={oneOf(sp.statut, Object.keys(WEBHOOK_STATUS) as WebhookEventStatus[])} />
      ) : (
        <PaymentsTab q={q} page={page} status={tab === "echecs" ? "FAILED" : status} kind={kind} failuresOnly={tab === "echecs"} canRefund={canRefund} />
      )}
    </>
  );
}

async function PaymentsTab({ q, page, status, kind, failuresOnly, canRefund }: { q?: string; page: number; status?: PaymentStatus; kind?: PaymentKind; failuresOnly: boolean; canRefund: boolean }) {
  const { items, total } = await listPayments({ q, page, status, kind });
  return (
    <Section
      actions={
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchInput placeholder="Client, description, identifiant…" />
          {!failuresOnly && <FilterSelect param="statut" options={STATUSES.map((s) => ({ value: s, label: PAYMENT_STATUS[s].label }))} placeholder="Tous les statuts" />}
          <FilterSelect param="type" options={KINDS} placeholder="Tous les types" />
        </div>
      }
      title={failuresOnly ? "Échecs de paiement" : "Paiements"}
      description={failuresOnly ? "Le client est notifié et invité à mettre à jour son moyen de paiement  ; Whop relance automatiquement le paiement." : undefined}
      contentClassName="p-0"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Date</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Montant</TableHead>
            <TableHead className="text-right">Remboursé</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Prestataire</TableHead>
            <TableHead className="pr-5 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((p) => {
            const remaining = p.amountCents - p.refundedCents;
            const refundable = canRefund && (p.status === "SUCCEEDED" || p.status === "PARTIALLY_REFUNDED") && remaining > 0;
            return (
              <TableRow key={p.id}>
                <TableCell className="pl-5 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(p.createdAt)}</TableCell>
                <TableCell>
                  <CustomerLink customer={p.customer} />
                </TableCell>
                <TableCell className="max-w-72 whitespace-normal">
                  {p.description}
                  <span className="block text-xs text-muted-foreground">
                    {KINDS.find((k) => k.value === p.kind)?.label}
                    {p.creditsGranted ? ` · ${p.creditsGranted} crédits` : ""}
                    {p.invoice?.number ? ` · facture ${p.invoice.number}` : ""}
                  </span>
                  {p.failureMessage && <span className="block text-xs text-danger">{p.failureMessage}</span>}
                </TableCell>
                <TableCell className="text-right font-medium tabular">{formatMoney(p.amountCents, p.currency)}</TableCell>
                <TableCell className="text-right text-muted-foreground tabular">{p.refundedCents ? formatMoney(p.refundedCents, p.currency) : "—"}</TableCell>
                <TableCell>
                  <StatusFrom map={PAYMENT_STATUS} value={p.status} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{p.provider === "dev" ? "Démonstration" : p.provider === "whop" ? "Whop" : p.provider}</TableCell>
                <TableCell className="pr-5 text-right">
                  {refundable && (
                    <ActionDialog
                      trigger={
                        <Button variant="ghost" size="sm">
                          <Undo2 /> Rembourser
                        </Button>
                      }
                      title="Rembourser le paiement"
                      description={`Montant remboursable : ${formatMoney(remaining, p.currency)}. Le remboursement est effectué via ${p.provider === "dev" ? "le mode démonstration (aucun mouvement réel)" : "Whop"}.`}
                      action={refundPaymentAction}
                      submitLabel="Rembourser"
                      destructive
                    >
                      <input type="hidden" name="paymentId" value={p.id} />
                      <TextField name="amount" label="Montant (€)" inputMode="decimal" placeholder={(remaining / 100).toFixed(2).replace(".", ",")} hint="Laisser vide pour rembourser la totalité restante." />
                      {p.kind === "CREDIT_PACK" && (
                        <CheckboxField name="removeCredits" label="Retirer les crédits achetés correspondants (au prorata, dans la limite du solde disponible)" defaultChecked />
                      )}
                      <TextAreaField name="reason" label="Justification" required rows={3} />
                    </ActionDialog>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                {failuresOnly ? "Aucun échec de paiement." : "Aucun paiement."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="px-5 pb-4">
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin/paiements" params={{ onglet: failuresOnly ? "echecs" : undefined, q, statut: failuresOnly ? undefined : status, type: kind }} />
      </div>
    </Section>
  );
}

async function InvoicesTab({ q, page }: { q?: string; page: number }) {
  const { items, total } = await listInvoices({ q, page });
  return (
    <Section title="Factures" actions={<SearchInput placeholder="Numéro, client…" />} contentClassName="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Numéro</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Période</TableHead>
            <TableHead className="text-right">Dû</TableHead>
            <TableHead className="text-right">Payé</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Émise le</TableHead>
            <TableHead className="pr-5 text-right">Documents</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((inv) => {
            const st = INVOICE_STATUS[inv.status] ?? { label: inv.status, tone: "neutral" as Tone };
            return (
              <TableRow key={inv.id}>
                <TableCell className="pl-5 font-mono text-xs">{inv.number ?? inv.externalId}</TableCell>
                <TableCell>
                  <CustomerLink customer={inv.customer} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{inv.periodStart ? `${formatDate(inv.periodStart)} → ${formatDate(inv.periodEnd)}` : "—"}</TableCell>
                <TableCell className="text-right tabular">{formatMoney(inv.amountDueCents, inv.currency)}</TableCell>
                <TableCell className="text-right tabular">{formatMoney(inv.amountPaidCents, inv.currency)}</TableCell>
                <TableCell>
                  <StatusBadge tone={st.tone} label={st.label} />
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(inv.issuedAt)}</TableCell>
                <TableCell className="pr-5 text-right text-xs">
                  {inv.hostedUrl || inv.pdfUrl ? (
                    <span className="inline-flex gap-3">
                      {inv.hostedUrl && (
                        <a href={inv.hostedUrl} target="_blank" rel="noreferrer noopener" className="text-brand hover:underline">
                          Voir
                        </a>
                      )}
                      {inv.pdfUrl && (
                        <a href={inv.pdfUrl} target="_blank" rel="noreferrer noopener" className="text-brand hover:underline">
                          PDF
                        </a>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Démonstration</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                Aucune facture.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="px-5 pb-4">
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin/paiements" params={{ onglet: "factures", q }} />
      </div>
    </Section>
  );
}

async function WebhooksTab({ page, status }: { page: number; status?: WebhookEventStatus }) {
  const { items, total, counts } = await listWebhookEvents({ page, status });
  return (
    <Section
      title="Webhooks Whop"
      description="Événements reçus et vérifiés. Un événement en échec est retraité automatiquement lors du renvoi par Whop ; un événement déjà traité est ignoré (idempotence)."
      actions={<FilterSelect param="statut" options={(Object.keys(WEBHOOK_STATUS) as WebhookEventStatus[]).map((s) => ({ value: s, label: `${WEBHOOK_STATUS[s].label} (${counts[s] ?? 0})` }))} placeholder="Tous les statuts" />}
      contentClassName="p-0"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Reçu le</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Identifiant</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead className="text-right">Tentatives</TableHead>
            <TableHead className="pr-5">Erreur</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="pl-5 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(e.receivedAt)}</TableCell>
              <TableCell className="font-mono text-xs">{e.type}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{e.id}</TableCell>
              <TableCell>
                <StatusFrom map={WEBHOOK_STATUS} value={e.status} />
              </TableCell>
              <TableCell className="text-right tabular">{e.attempts}</TableCell>
              <TableCell className="max-w-80 pr-5 text-xs whitespace-normal text-danger">{e.error ?? ""}</TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                Aucun événement reçu{status ? " avec ce statut" : ""}. Configurez l&apos;URL <code className="font-mono">/api/webhooks/whop</code> dans le tableau de bord développeur Whop.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="px-5 pb-4">
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} basePath="/admin/paiements" params={{ onglet: "webhooks", statut: status }} />
      </div>
    </Section>
  );
}

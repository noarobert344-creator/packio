import type { Metadata } from "next";
import Link from "next/link";
import {
  CreditCard,
  ExternalLink,
  FlaskConical,
  Receipt,
  TriangleAlert,
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
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ActionButton } from "@/components/shared/action-dialog";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { requireCustomer } from "@/server/auth/current";
import { db } from "@/server/db";
import { billingMode } from "@/server/billing";
import { getActiveSubscription } from "@/server/services/customers";
import {
  cancelSubscriptionAction,
  devBillingToolAction,
  openPortalAction,
} from "@/server/actions/customer";
import { PAYMENT_STATUS, SUBSCRIPTION_STATUS } from "@/lib/labels";
import { formatDate, formatMoney, formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Facturation" };

export default async function BillingPage() {
  const actor = await requireCustomer();
  const [sub, invoices, payments, customer] = await Promise.all([
    getActiveSubscription(actor.customerId),
    db.invoice.findMany({
      where: { customerId: actor.customerId },
      orderBy: { issuedAt: "desc" },
      take: 50,
    }),
    db.payment.findMany({
      where: { customerId: actor.customerId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.customerProfile.findUniqueOrThrow({ where: { id: actor.customerId } }),
  ]);
  const dev = billingMode() === "dev";
  // Abonnement offert par Packio (ou compte du fondateur) : ni prix ni gestion chez Whop.
  const offered =
    !!sub &&
    (sub.externalId.startsWith("offert_") ||
      sub.externalId.startsWith("interne_"));
  const yearly = sub?.billingInterval === "YEARLY" && !offered;
  return (
    <div className="space-y-8">
      <PageHeader
        title="Facturation"
        description="Abonnement, factures et paiements. Paiements sécurisés par Whop."
        actions={
          !dev && sub?.provider === "whop" ? (
            <form action={openPortalAction}>
              <Button type="submit" variant="outline">
                <CreditCard /> Gérer mon paiement sur Whop <ExternalLink />
              </Button>
            </form>
          ) : null
        }
      />
      {customer.status === "PAST_DUE" && (
        <p className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          <TriangleAlert className="size-4 shrink-0" /> Le paiement de votre
          abonnement a échoué. Mettez à jour votre moyen de paiement sur Whop :
          le paiement sera retenté automatiquement.
        </p>
      )}
      <Section title="Abonnement">
        {sub ? (
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xl font-semibold">{sub.plan.name}</p>
                <span className="rounded-full border px-2 py-0.5 text-xs font-medium">
                  {offered
                    ? "Offert par Packio"
                    : yearly
                      ? "Annuel"
                      : "Mensuel"}
                </span>
                <StatusFrom map={SUBSCRIPTION_STATUS} value={sub.status} />
              </div>
              <p className="text-sm text-muted-foreground">
                {offered
                  ? `${sub.plan.monthlyCredits} crédits par mois, sans paiement${sub.externalId.startsWith("offert_") && sub.currentPeriodEnd ? ` jusqu'au ${formatDate(sub.currentPeriodEnd)}` : ""}`
                  : `${yearly ? `${formatPrice(sub.plan.annualPriceCents)} / an` : `${formatMoney(sub.plan.priceCents)} / mois`} · ${sub.plan.monthlyCredits} crédits par mois`}
              </p>
              {yearly && (
                <p className="text-sm text-muted-foreground">
                  {sub.nextCreditGrantAt
                    ? `Crédits versés chaque mois : ${sub.creditMonthsGranted}/12 reçus, prochain versement le ${formatDate(sub.nextCreditGrantAt)}.`
                    : "Tous les crédits mensuels de la période annuelle ont été versés."}
                </p>
              )}
              {sub.pendingPlan && !sub.pendingBillingInterval && (
                <p className="text-sm text-brand">
                  Changement programmé : passage à l&apos;offre{" "}
                  {sub.pendingPlan.name} ({sub.pendingPlan.monthlyCredits}{" "}
                  crédits / mois) au prochain renouvellement.
                </p>
              )}
              {sub.currentPeriodEnd && (
                <p className="text-sm">
                  {sub.pendingBillingInterval === "MONTHLY" ? (
                    <span className="text-brand">
                      Passage au mensuel programmé : votre formule annuelle
                      prend fin le {formatDate(sub.currentPeriodEnd)}, vous
                      activerez ensuite l&apos;offre{" "}
                      {sub.pendingPlan?.name ?? ""} en mensuel.
                    </span>
                  ) : offered ? (
                    <>
                      {sub.externalId.startsWith("offert_")
                        ? `Abonnement offert jusqu'au ${formatDate(sub.currentPeriodEnd)} : choisissez ensuite une offre pour continuer.`
                        : "Abonnement offert, sans échéance."}
                    </>
                  ) : sub.cancelAtPeriodEnd ? (
                    <span className="text-warning">
                      Résiliation programmée : l&apos;abonnement prendra fin le{" "}
                      {formatDate(sub.currentPeriodEnd)}.
                    </span>
                  ) : (
                    <>
                      Prochain renouvellement {yearly ? "annuel " : ""}le{" "}
                      {formatDate(sub.currentPeriodEnd)}.
                    </>
                  )}
                </p>
              )}
            </div>
            {!offered && (
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link href="/client/abonnement">Changer d&apos;offre</Link>
                </Button>
                {sub.cancelAtPeriodEnd ? (
                  <ActionButton
                    action={cancelSubscriptionAction}
                    fields={{ cancel: "0" }}
                  >
                    {sub.pendingBillingInterval
                      ? "Rester en annuel"
                      : "Conserver mon abonnement"}
                  </ActionButton>
                ) : (
                  <ActionButton
                    action={cancelSubscriptionAction}
                    fields={{ cancel: "1" }}
                    variant="ghost"
                  >
                    Résilier à la fin de la période
                  </ActionButton>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Aucun abonnement actif.
            </p>
            <Button asChild>
              <Link href="/client/abonnement">Choisir une offre</Link>
            </Button>
          </div>
        )}
      </Section>

      {dev && sub?.provider === "dev" && (
        <Section
          title="Outils de démonstration"
          description="Simulez les événements de facturation (aucun encaissement réel)."
        >
          <div className="flex flex-wrap gap-2">
            <ActionForm action={devBillingToolAction}>
              <input type="hidden" name="tool" value="renewal" />
              <SubmitButton variant="outline">
                <FlaskConical />{" "}
                {sub.cancelAtPeriodEnd
                  ? "Simuler la fin de la période"
                  : yearly
                    ? "Simuler le renouvellement annuel"
                    : "Simuler le renouvellement mensuel"}
              </SubmitButton>
            </ActionForm>
            {yearly && sub.nextCreditGrantAt && (
              <ActionForm action={devBillingToolAction}>
                <input type="hidden" name="tool" value="month" />
                <SubmitButton variant="outline">
                  <FlaskConical /> Simuler le mois suivant (crédits)
                </SubmitButton>
              </ActionForm>
            )}
            {sub.status === "PAST_DUE" ? (
              <ActionForm action={devBillingToolAction}>
                <input type="hidden" name="tool" value="recover" />
                <SubmitButton variant="outline">
                  Simuler la régularisation
                </SubmitButton>
              </ActionForm>
            ) : (
              <ActionForm action={devBillingToolAction}>
                <input type="hidden" name="tool" value="failure" />
                <SubmitButton variant="outline">
                  Simuler un échec de paiement
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        </Section>
      )}

      <Section title="Factures" contentClassName="p-0">
        {invoices.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Date</TableHead>
                  <TableHead>Numéro</TableHead>
                  <TableHead>Période</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="pr-5 text-right">Document</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="pl-5 whitespace-nowrap">
                      {formatDate(i.issuedAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {i.number ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {i.periodStart
                        ? `${formatDate(i.periodStart)} → ${formatDate(i.periodEnd)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {formatMoney(
                        i.amountPaidCents || i.amountDueCents,
                        i.currency,
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {i.status === "paid"
                        ? "Payée"
                        : i.status === "open"
                          ? "À payer"
                          : i.status === "void"
                            ? "Annulée"
                            : i.status}
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      {i.pdfUrl || i.hostedUrl ? (
                        <a
                          href={i.pdfUrl ?? i.hostedUrl!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
                        >
                          Télécharger <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {i.externalId.startsWith("dev_") ? "Démo" : "—"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState icon={Receipt} title="Aucune facture" />
          </div>
        )}
      </Section>

      <Section title="Paiements" contentClassName="p-0">
        {payments.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead className="pr-5">Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="pl-5 whitespace-nowrap">
                      {formatDate(p.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-sm">
                      <span className="block truncate">{p.description}</span>
                      {p.failureMessage && (
                        <span className="block text-xs text-danger">
                          {p.failureMessage}
                        </span>
                      )}
                      {p.refundedCents > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          Remboursé : {formatMoney(p.refundedCents, p.currency)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {formatMoney(p.amountCents, p.currency)}
                    </TableCell>
                    <TableCell className="pr-5">
                      <StatusFrom map={PAYMENT_STATUS} value={p.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState icon={CreditCard} title="Aucun paiement" />
          </div>
        )}
      </Section>
    </div>
  );
}

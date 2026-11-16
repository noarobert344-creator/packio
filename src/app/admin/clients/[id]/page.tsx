import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { Boxes, CheckCircle2, CircleAlert, Package, Truck, UserRound } from "lucide-react";
import { requireAdmin } from "@/server/auth/current";
import { can } from "@/server/auth/actor";
import { getCustomerActivity, getCustomerDetail } from "@/server/queries/admin-people";
import { computeSla, getAssignmentHistory, listPreparerCapacities } from "@/server/services/assignments";
import { getWalletOverview } from "@/server/services/credits";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusBadge, StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Timeline, type TimelineEntry } from "@/components/shared/timeline";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssignDialog, NotifyDelayDialog, ReassignDialog, StartReassignmentDialog } from "@/components/admin/people/assignment-dialogs";
import { AnonymizeDialog, CreditAdjustDialog, CustomerNotesForm, CustomerStatusDialog } from "@/components/admin/people/customer-actions";
import { AssignmentStateBadge, DemoBadge, KeyValue } from "@/components/admin/people/display";
import { SlaCountdown } from "@/components/admin/people/sla-countdown";
import {
  CUSTOMER_STATUS,
  INCIDENT_STATUS,
  INCIDENT_TYPE,
  INVENTORY_STATUS,
  SHIPMENT_STATUS,
  SUBSCRIPTION_STATUS,
  SUPPLIER_ORDER_STATUS,
} from "@/lib/labels";
import { one, type SearchParams } from "@/lib/params";
import { formatCredits, formatDate, formatDateTime, formatDuration, formatMoney, fullName } from "@/lib/format";

export const metadata: Metadata = { title: "Fiche client — Administration" };

export default async function AdminCustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const actor = await requireAdmin("customers.read");
  const { id } = await params;
  const sp = await searchParams;
  const justAssigned = one(sp.attribue) === "1";
  const openReassign = one(sp["changer-preparateur"]) === "1";
  const customer = await getCustomerDetail(id);
  if (!customer) notFound();

  const canAssign = can(actor, "assignments.manage");
  const canManage = can(actor, "customers.manage");
  const canCredits = can(actor, "credits.manage");
  const [activity, history, wallet, capacities] = await Promise.all([
    getCustomerActivity(id),
    getAssignmentHistory(id),
    getWalletOverview(id),
    canAssign ? listPreparerCapacities() : Promise.resolve([]),
  ]);
  const sla = computeSla(customer);
  const waiting = ["PENDING", "LATE", "REASSIGNING"].includes(customer.assignmentState);
  const subscription = customer.subscriptions.find((s) => ["ACTIVE", "TRIALING", "PAST_DUE"].includes(s.status)) ?? customer.subscriptions[0];
  const name = fullName(customer.user);
  const suspended = customer.status === "SUSPENDED";

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/admin/clients", label: "Clients" }}
        eyebrow={customer.referenceCode}
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {name}
            <DemoBadge show={customer.user.isDemo} />
          </span>
        }
        description={customer.companyName ?? customer.user.email}
        actions={
          <>
            <StatusFrom map={CUSTOMER_STATUS} value={customer.status} />
            {canManage && <CustomerStatusDialog customerId={customer.id} suspended={suspended} />}
            {canManage && <AnonymizeDialog customerId={customer.id} />}
          </>
        }
      />

      {justAssigned && customer.currentPreparer && (
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-soft p-4 text-sm text-success" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <p>
            <span className="font-medium">{fullName(customer.currentPreparer.user)}</span> est désormais le préparateur attitré de ce client. Le client et le préparateur ont été notifiés, leur conversation privée est ouverte et l&apos;adresse de réception est visible côté client.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          <Section
            title="Préparateur attitré"
            description="Attribution manuelle, suivie selon le délai de 24 h."
            actions={<AssignmentStateBadge customer={customer} />}
          >
            <div className="grid gap-5">
              {customer.currentPreparer ? (
                <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand">
                      <UserRound className="size-5" />
                    </span>
                    <div>
                      <Link href={`/admin/preparateurs/${customer.currentPreparer.id}`} className="font-medium hover:underline">
                        {fullName(customer.currentPreparer.user)}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {customer.currentPreparer.city} · {customer.currentPreparer.user.email}
                      </p>
                    </div>
                  </div>
                  {canAssign && (
                    <div className="flex flex-wrap gap-2">
                      <ReassignDialog customerId={customer.id} currentPreparerId={customer.currentPreparerId} options={capacities} defaultOpen={openReassign} canEditParcels={can(actor, "preparers.manage")} />
                      {customer.assignmentState !== "REASSIGNING" && <StartReassignmentDialog customerId={customer.id} />}
                    </div>
                  )}
                </div>
              ) : customer.assignmentState === "NOT_REQUESTED" ? (
                <p className="text-sm text-muted-foreground">
                  Aucune demande d&apos;attribution : la demande s&apos;ouvre automatiquement à l&apos;activation de l&apos;abonnement.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Aucun préparateur attribué pour le moment.</p>
              )}

              {waiting && (
                <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-3">
                  <KeyValue label="Date de souscription / demande">{formatDateTime(customer.assignmentRequestedAt)}</KeyValue>
                  <KeyValue label="Temps écoulé">{formatDuration(sla.elapsedMinutes)}</KeyValue>
                  <KeyValue label="Échéance des 24 h">
                    <span className="block">{formatDateTime(customer.assignmentDueAt)}</span>
                    <SlaCountdown dueAt={customer.assignmentDueAt?.toISOString() ?? null} requestedAt={null} />
                  </KeyValue>
                  {(customer.assignmentAdminAlertedAt || customer.assignmentDelayNotifiedAt) && (
                    <div className="text-xs text-muted-foreground sm:col-span-3">
                      {customer.assignmentAdminAlertedAt && <p>Alerte administrateur envoyée le {formatDateTime(customer.assignmentAdminAlertedAt)}.</p>}
                      {customer.assignmentDelayNotifiedAt && <p>Client informé du retard le {formatDateTime(customer.assignmentDelayNotifiedAt)}.</p>}
                    </div>
                  )}
                </div>
              )}

              {canAssign && waiting && (
                <div className="flex flex-wrap gap-2">
                  {!customer.currentPreparer && <AssignDialog customerId={customer.id} customerName={name} options={capacities} canEditParcels={can(actor, "preparers.manage")} />}
                  <NotifyDelayDialog customerId={customer.id} />
                </div>
              )}
            </div>
          </Section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Section title="Abonnement">
              {subscription ? (
                <dl className="grid grid-cols-2 gap-4">
                  <KeyValue label="Offre">
                    {subscription.plan.name} ·{" "}
                    {subscription.billingInterval === "YEARLY" ? `annuel, ${formatMoney(subscription.plan.annualPriceCents)}/an` : `mensuel, ${formatMoney(subscription.plan.priceCents)}/mois`}
                  </KeyValue>
                  <KeyValue label="Statut">
                    <StatusFrom map={SUBSCRIPTION_STATUS} value={subscription.status} />
                  </KeyValue>
                  <KeyValue label="Période en cours">
                    {formatDate(subscription.currentPeriodStart)} → {formatDate(subscription.currentPeriodEnd)}
                  </KeyValue>
                  <KeyValue label="Renouvellement">
                    {subscription.pendingBillingInterval ? (
                      <span className="text-brand">Passage au mensuel à l&apos;échéance</span>
                    ) : subscription.cancelAtPeriodEnd ? (
                      <span className="text-warning">Résiliation programmée</span>
                    ) : subscription.pendingPlanId ? (
                      <span className="text-brand">Changement d&apos;offre programmé</span>
                    ) : (
                      "Automatique"
                    )}
                  </KeyValue>
                  <KeyValue label="Prestataire">{subscription.provider === "dev" ? "Paiement simulé (démo)" : "Whop"}</KeyValue>
                  <KeyValue label="Crédits mensuels">
                    {formatCredits(subscription.plan.monthlyCredits)}
                    {subscription.billingInterval === "YEARLY" && (
                      <span className="block text-xs text-muted-foreground">
                        {subscription.creditMonthsGranted}/12 versés{subscription.nextCreditGrantAt ? ` · prochain le ${formatDate(subscription.nextCreditGrantAt)}` : ""}
                      </span>
                    )}
                  </KeyValue>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">Aucun abonnement souscrit.</p>
              )}
            </Section>

            <Section title="Crédits" actions={canCredits ? <CreditAdjustDialog customerId={customer.id} requestId={randomUUID()} /> : null}>
              <dl className="grid grid-cols-2 gap-4">
                <KeyValue label="Disponibles">
                  <span className="text-xl font-semibold tabular">{wallet.available}</span>
                </KeyValue>
                <KeyValue label="Réservés">
                  <span className="text-xl font-semibold tabular">{wallet.wallet.reservedBalance}</span>
                </KeyValue>
                <KeyValue label="Mensuels">{wallet.wallet.monthlyBalance}</KeyValue>
                <KeyValue label="Achetés / manuels">{wallet.wallet.purchasedBalance}</KeyValue>
                <KeyValue label="Consommés (total)">{wallet.wallet.consumedTotal}</KeyValue>
              </dl>
              {wallet.upcomingExpirations.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Prochaines expirations</p>
                  <ul className="space-y-1 text-sm">
                    {wallet.upcomingExpirations.map((e, i) => (
                      <li key={i} className="flex justify-between">
                        <span>
                          {formatCredits(e.amount)} {e.bucket === "MONTHLY" ? "mensuels" : "achetés"}
                        </span>
                        <span className="text-muted-foreground">{formatDate(e.expiresAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          </div>

          <Section title="Activité logistique" description={`${activity.stockUnits} article(s) en stock sur ${activity.stockItems} référence(s).`}>
            <Tabs defaultValue="orders">
              <TabsList className="mb-4 w-full overflow-x-auto sm:w-auto">
                <TabsTrigger value="orders">Commandes</TabsTrigger>
                <TabsTrigger value="stock">Stock</TabsTrigger>
                <TabsTrigger value="shipments">Expéditions</TabsTrigger>
                <TabsTrigger value="incidents">Incidents</TabsTrigger>
              </TabsList>
              <TabsContent value="orders">
                {activity.orders.length === 0 ? (
                  <EmptyState icon={Package} title="Aucune commande" />
                ) : (
                  <ul className="divide-y">
                    {activity.orders.map((o) => (
                      <li key={o.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <Link href={`/admin/commandes/${o.id}`} className="text-sm font-medium hover:underline">
                            {o.reference}
                          </Link>
                          <p className="truncate text-xs text-muted-foreground">
                            {o.supplier.code === "OTHER" ? o.supplierLabel : o.supplier.name} · {o.description}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <StatusFrom map={SUPPLIER_ORDER_STATUS} value={o.status} />
                          <span className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value="stock">
                {activity.items.length === 0 ? (
                  <EmptyState icon={Boxes} title="Aucun article en stock" />
                ) : (
                  <ul className="divide-y">
                    {activity.items.map((i) => (
                      <li key={i.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <Link href={`/admin/stocks/${i.id}`} className="text-sm font-medium hover:underline">
                            {i.name}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {i.sku} · {i.quantityAvailable} dispo. · {i.quantityReserved} réservé(s) · {i.quantityShipped} expédié(s)
                          </p>
                        </div>
                        <StatusFrom map={INVENTORY_STATUS} value={i.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value="shipments">
                {activity.shipments.length === 0 ? (
                  <EmptyState icon={Truck} title="Aucune expédition" />
                ) : (
                  <ul className="divide-y">
                    {activity.shipments.map((s) => (
                      <li key={s.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <Link href={`/admin/expeditions/${s.id}`} className="text-sm font-medium hover:underline">
                            {s.reference}
                          </Link>
                          <p className="truncate text-xs text-muted-foreground">
                            {s.recipientName} · {s.city} {s.creditCost !== null ? `· ${formatCredits(s.creditCost)}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <StatusFrom map={SHIPMENT_STATUS} value={s.status} />
                          <span className="text-xs text-muted-foreground">{formatDate(s.createdAt)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
              <TabsContent value="incidents">
                {activity.incidents.length === 0 ? (
                  <EmptyState icon={CircleAlert} title="Aucun incident" />
                ) : (
                  <ul className="divide-y">
                    {activity.incidents.map((i) => (
                      <li key={i.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <Link href={`/admin/incidents/${i.id}`} className="text-sm font-medium hover:underline">
                            {i.reference} — {i.title}
                          </Link>
                          <p className="text-xs text-muted-foreground">{INCIDENT_TYPE[i.type]}</p>
                        </div>
                        <StatusFrom map={INCIDENT_STATUS} value={i.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Identité et contact">
            <dl className="grid gap-3">
              <KeyValue label="E-mail">
                <a href={`mailto:${customer.user.email}`} className="hover:underline">
                  {customer.user.email}
                </a>
                {!customer.user.emailVerifiedAt && <span className="ml-2 text-xs text-warning">non vérifié</span>}
              </KeyValue>
              <KeyValue label="Téléphone">{customer.user.phone ?? "—"}</KeyValue>
              <KeyValue label="Boutique / société">{customer.companyName ?? "—"}</KeyValue>
              <KeyValue label="Code client">
                <span className="font-mono">{customer.referenceCode}</span>
              </KeyValue>
              <KeyValue label="Inscrit le">{formatDateTime(customer.user.createdAt)}</KeyValue>
              <KeyValue label="Dernière connexion">{formatDateTime(customer.user.lastLoginAt)}</KeyValue>
              <KeyValue label="Utilisateur Whop">{customer.billingCustomerId ?? "—"}</KeyValue>
              <KeyValue label="Compte">{customer.user.status === "ACTIVE" ? "Actif" : customer.user.status === "SUSPENDED" ? "Suspendu" : "Désactivé"}</KeyValue>
            </dl>
          </Section>

          {canManage ? (
            <Section title="Notes internes">
              <CustomerNotesForm customerId={customer.id} notes={customer.adminNotes} />
            </Section>
          ) : customer.adminNotes ? (
            <Section title="Notes internes">
              <p className="text-sm whitespace-pre-wrap">{customer.adminNotes}</p>
            </Section>
          ) : null}

          <Section title="Historique des attributions">
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune attribution pour le moment.</p>
            ) : (
              <Timeline
                entries={history.flatMap((h) => {
                  const entries: TimelineEntry[] = [
                    {
                      id: `${h.id}-a`,
                      label: `Attribué à ${fullName(h.preparer.user)}`,
                      tone: h.status === "ACTIVE" ? "success" : "neutral",
                      at: h.assignedAt,
                      actor: fullName(h.assignedBy),
                      note: [h.note, h.waitMinutes !== null ? `Délai : ${formatDuration(h.waitMinutes)}` : null].filter(Boolean).join(" · ") || null,
                    },
                  ];
                  if (h.endedAt) {
                    entries.unshift({
                      id: `${h.id}-e`,
                      label: `Fin d'affectation — ${fullName(h.preparer.user)}`,
                      tone: "warning",
                      at: h.endedAt,
                      actor: h.endedBy ? fullName(h.endedBy) : null,
                      note: h.endReason,
                    });
                  }
                  return entries;
                })}
              />
            )}
            {customer.status !== "ACTIVE" && customer.status !== "PAST_DUE" && customer.assignmentState === "NOT_REQUESTED" && (
              <div className="mt-4">
                <StatusBadge tone="neutral" label="Attribution possible après activation de l'abonnement" dot={false} />
              </div>
            )}
          </Section>
          {customer.currentPreparer && can(actor, "conversations.supervise") && (
            <Button asChild variant="outline" className="w-full">
              <Link href={`/admin/support?onglet=supervision`}>Superviser la conversation (motif requis)</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

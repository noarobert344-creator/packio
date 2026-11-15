import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Boxes, CheckCircle2, Coins, CreditCard, PackageCheck, PackageOpen, ShoppingBag, Truck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { AssignmentWaiting } from "@/components/client/assignment-waiting";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { getCustomerDashboard } from "@/server/services/stats";
import { db } from "@/server/db";
import { SHIPMENT_STATUS, SUPPLIER_ORDER_STATUS } from "@/lib/labels";
import { formatDate, formatRelative } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Vue d'ensemble" };

export default async function ClientOverview({ searchParams }: { searchParams: SearchParams }) {
  const { actor, customer } = await requireSubscribedCustomer();
  const sp = await searchParams;
  const [dash, orders, shipments] = await Promise.all([
    getCustomerDashboard(customer.id),
    db.supplierOrder.findMany({ where: { customerId: customer.id }, orderBy: { updatedAt: "desc" }, take: 5, include: { supplier: true } }),
    db.outboundShipment.findMany({ where: { customerId: customer.id }, orderBy: { updatedAt: "desc" }, take: 5 }),
  ]);
  const waiting = dash.sla.state === "PENDING" || dash.sla.state === "LATE" || dash.sla.state === "REASSIGNING";
  const sub = dash.subscription;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Bonjour ${actor.firstName}`}
        description={`Code client ${customer.referenceCode} — à indiquer sur chacune de vos commandes.`}
        actions={
          !waiting && customer.currentPreparerId ? (
            <>
              <Button asChild variant="outline">
                <Link href="/client/expeditions/nouvelle">
                  <Truck /> Demander une expédition
                </Link>
              </Button>
              <Button asChild>
                <Link href="/client/commander">
                  <ShoppingBag /> Nouvelle commande
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      {one(sp.abonnement) === "confirme" && !waiting && (
        <p className="flex items-center gap-2 rounded-xl bg-success-soft px-4 py-3 text-sm text-success">
          <CheckCircle2 className="size-4" /> Paiement confirmé : votre abonnement est actif.
        </p>
      )}
      {customer.status === "PAST_DUE" && (
        <div className="flex flex-col gap-3 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2">
            <TriangleAlert className="size-4 shrink-0" /> Votre dernier paiement a échoué. Les nouvelles commandes et expéditions sont suspendues jusqu&apos;à régularisation.
          </p>
          <Button asChild size="sm" variant="destructive">
            <Link href="/client/facturation">Mettre à jour mon paiement</Link>
          </Button>
        </div>
      )}
      {customer.status === "CANCELED" && (
        <div className="rounded-2xl border bg-muted/50 p-4 text-sm">
          Votre abonnement est résilié. <Link href="/client/abonnement" className="font-medium underline">Réactiver un abonnement</Link>
        </div>
      )}

      {waiting && (
        <AssignmentWaiting serverNow={Date.now()}
          requestedAt={customer.assignmentRequestedAt?.toISOString() ?? null}
          dueAt={customer.assignmentDueAt?.toISOString() ?? null}
          state={dash.sla.state as "PENDING" | "LATE" | "REASSIGNING"}
        />
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Colis en livraison" value={dash.inbound} icon={PackageOpen} href="/client/commandes?statut=en-route" tone="brand" />
        <StatCard label="Colis réceptionnés" value={dash.received} icon={PackageCheck} href="/client/commandes?statut=recus" />
        <StatCard label="Articles en stock" value={dash.stockUnits} icon={Boxes} href="/client/stock" hint={sub?.plan.storageLimit ? `Limite de l'offre : ${sub.plan.storageLimit}` : undefined} />
        <StatCard label="Expéditions en cours" value={dash.activeShipments} icon={Truck} href="/client/expeditions?statut=en-cours" />
        <StatCard label="Colis expédiés" value={dash.shipped} icon={CheckCircle2} href="/client/expeditions?statut=expediees" tone="success" />
        <StatCard
          label="Crédits disponibles"
          value={dash.wallet.available}
          icon={Coins}
          href="/client/credits"
          tone={dash.wallet.available < 3 ? "warning" : "default"}
          hint={dash.wallet.wallet.reservedBalance ? `${dash.wallet.wallet.reservedBalance} réservé(s)` : undefined}
        />
        <div className="col-span-2 sm:col-span-1 lg:col-span-2">
        <StatCard
          label="Abonnement actuel"
          value={sub?.plan.name ?? "—"}
          icon={CreditCard}
          href="/client/facturation"
          hint={sub?.currentPeriodEnd ? `${sub.cancelAtPeriodEnd ? "Prend fin" : "Renouvellement"} le ${formatDate(sub.currentPeriodEnd)}` : undefined}
        />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Dernières commandes"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/client/commandes">
                Tout voir <ArrowRight />
              </Link>
            </Button>
          }
          contentClassName="p-0"
        >
          {orders.length ? (
            <ul className="divide-y">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/client/commandes/${o.id}`} className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-muted/40">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{o.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.supplier.code === "OTHER" ? o.supplierLabel : o.supplier.name} · {o.reference} · {formatRelative(o.updatedAt)}
                      </p>
                    </div>
                    <StatusFrom map={SUPPLIER_ORDER_STATUS} value={o.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5">
              <EmptyState icon={ShoppingBag} title="Aucune commande" description="Déclarez vos achats pour que votre préparateur puisse les réceptionner." />
            </div>
          )}
        </Section>
        <Section
          title="Dernières expéditions"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href="/client/expeditions">
                Tout voir <ArrowRight />
              </Link>
            </Button>
          }
          contentClassName="p-0"
        >
          {shipments.length ? (
            <ul className="divide-y">
              {shipments.map((s) => (
                <li key={s.id}>
                  <Link href={`/client/expeditions/${s.id}`} className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-muted/40">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {s.recipientName} — {s.city}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.reference} · {formatRelative(s.updatedAt)}
                      </p>
                    </div>
                    <StatusFrom map={SHIPMENT_STATUS} value={s.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5">
              <EmptyState icon={Truck} title="Aucune expédition" description="Sélectionnez des articles de votre stock pour les faire expédier." />
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

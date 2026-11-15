import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Printer } from "lucide-react";
import { PageHeader, Section } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs } from "@/components/shared/list-controls";
import { LabelBoard } from "@/components/shared/label-board";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { listLabelBoard, listSalesAwaitingLabel } from "@/server/queries/sales-board";
import { nowMs } from "@/server/lib/clock";
import { MARKETPLACE_PLATFORM } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Bordereaux" };

export default async function CustomerLabelsPage({ searchParams }: { searchParams: SearchParams }) {
  const { customer } = await requireSubscribedCustomer();
  const done = one((await searchParams).vue) === "deposes";
  const [{ shipments, openCount }, waiting] = await Promise.all([listLabelBoard({ customerId: customer.id }, { done }), listSalesAwaitingLabel(customer.id)]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Bordereaux"
        description="Dès qu'un article se vend sur un compte Vinted ou Vestiaire Collective lié à Packio Connect, son bordereau arrive ici automatiquement, à côté de l'article. Votre préparateur l'imprime et dépose le colis sous 48 h."
      />
      {!done && waiting.length > 0 && (
        <Section title="Ventes en attente de bordereau" description="Générez le bordereau sur la plateforme : Packio Connect le transmet automatiquement à votre préparateur.">
          <ul className="divide-y">
            {waiting.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="flex items-center gap-2">
                  <Clock className="size-4 text-warning" />
                  <span>
                    <span className="font-medium">{w.inventoryItem?.name ?? w.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {MARKETPLACE_PLATFORM[w.platform]} · vente n° {w.externalOrderId} · {formatDateTime(w.soldAt)}
                    </span>
                  </span>
                </span>
                {w.shipment ? (
                  <Link href={`/client/expeditions/${w.shipment.id}`} className="text-xs font-medium text-brand hover:underline">
                    {w.shipment.reference}
                  </Link>
                ) : (
                  <Link href="/client/ventes" className="text-xs font-medium text-brand hover:underline">
                    Associer un article
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <FilterTabs
        param="vue"
        options={[
          { value: "", label: "À déposer", count: openCount },
          { value: "deposes", label: "Déposés (30 jours)" },
        ]}
      />
      {shipments.length ? (
        <LabelBoard shipments={shipments} role="CUSTOMER" now={nowMs()} />
      ) : (
        <EmptyState
          icon={Printer}
          title={done ? "Aucun bordereau déposé ces 30 derniers jours" : "Aucun bordereau en attente"}
          description="Les bordereaux de vos ventes (Packio Connect), de vos commandes en dropshipping et ceux que vous joignez à vos demandes d'expédition apparaissent ici."
        />
      )}
    </div>
  );
}

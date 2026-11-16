import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileClock, Printer, Zap } from "lucide-react";
import { requirePreparer } from "@/server/auth/current";
import { Button } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs } from "@/components/shared/list-controls";
import { StatusFrom } from "@/components/shared/status-badge";
import { LabelBoard } from "@/components/shared/label-board";
import { listDropshipIncoming, listLabelBoard } from "@/server/queries/sales-board";
import { nowMs } from "@/server/lib/clock";
import { MARKETPLACE_PLATFORM, SUPPLIER_ORDER_STATUS } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Ventes dropshipping" };

/**
 * Ventes en dropshipping : articles commandés par vos clients chez Temu, SHEIN
 * ou AliExpress, déjà vendus, à expédier à l'acheteur dès réception avec le
 * bordereau de la vente.
 */
export default async function PreparerDropshipPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePreparer();
  const done = one((await searchParams).vue) === "deposes";
  const [incoming, { shipments, openCount }] = await Promise.all([
    listDropshipIncoming(actor.preparerId),
    listLabelBoard({ preparerId: actor.preparerId }, { done, dropship: true }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Ventes dropshipping"
        description="Articles déjà vendus par vos clients, commandés chez le fournisseur et livrés chez vous : à la réception, ils partent directement chez l'acheteur, sans passer par le stock. Le bordereau de la vente est à télécharger ici."
        actions={
          <Button asChild variant="outline">
            <Link href="/preparateur/dropshipping/colis">
              <Zap /> Colis à envoyer — dropshipping
            </Link>
          </Button>
        }
      />

      <Section title="À réceptionner" description={incoming.length ? `${incoming.length} article(s) en route vers vos points de réception.` : "Aucun article en dropshipping attendu."} contentClassName="p-0">
        {incoming.length ? (
          <ul className="divide-y">
            {incoming.map((o) => (
              <li key={o.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <Link href={`/preparateur/receptions/${o.id}`} className="hover:underline">
                      {o.description}
                    </Link>
                    <StatusFrom map={SUPPLIER_ORDER_STATUS} value={o.status} />
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-mono">{o.reference}</span> · {o.customer.user.firstName} {o.customer.user.lastName} ({o.customer.referenceCode}) · {o.supplier.name} →{" "}
                    {o.location.label}
                    {o.salePlatform ? ` · vente ${MARKETPLACE_PLATFORM[o.salePlatform]}${o.saleReference ? ` n° ${o.saleReference}` : ""}` : ""}
                    {o.expectedArrivalAt ? ` · arrivée prévue le ${formatDate(o.expectedArrivalAt)}` : ""}
                  </p>
                </div>
                {o.files[0] ? (
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <a href={`/api/files/${o.files[0].id}?telecharger`}>
                      <Download /> Bordereau
                    </a>
                  </Button>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <FileClock className="size-3.5" /> Bordereau attendu
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-5">
            <EmptyState icon={Zap} title="Rien en route pour l'instant" description="Les commandes en dropshipping de vos clients apparaissent ici dès leur enregistrement." />
          </div>
        )}
      </Section>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Bordereaux à imprimer</h2>
        <FilterTabs
          param="vue"
          options={[
            { value: "", label: "À imprimer et déposer", count: openCount },
            { value: "deposes", label: "Déposés (30 jours)" },
          ]}
        />
        {shipments.length ? (
          <LabelBoard shipments={shipments} role="PREPARER" now={nowMs()} />
        ) : (
          <EmptyState icon={Printer} title={done ? "Aucun colis déposé ces 30 derniers jours" : "Aucun bordereau à imprimer"} description="Le bordereau apparaît ici à la réception de l'article." />
        )}
      </div>
    </div>
  );
}

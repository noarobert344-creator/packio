import type { Metadata } from "next";
import Link from "next/link";
import { Camera, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requirePreparer } from "@/server/auth/current";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs } from "@/components/shared/list-controls";
import { LabelBoard } from "@/components/shared/label-board";
import { listLabelBoard } from "@/server/queries/sales-board";
import { nowMs } from "@/server/lib/clock";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Ventes normales" };

export default async function PreparerLabelsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePreparer();
  const done = one((await searchParams).vue) === "deposes";
  const { shipments, openCount } = await listLabelBoard({ preparerId: actor.preparerId }, { done, dropship: false });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Ventes normales"
        description="Articles vendus depuis le stock de vos clients (Vinted, Vestiaire Collective, demandes d'expédition) : le bordereau arrive ici automatiquement, à côté de l'article. Téléchargez-le, imprimez, déposez sous 48 h."
        actions={
          <Button asChild variant="outline">
            <Link href="/preparateur/a-vendre">
              <Camera /> Ajouter des photos pour la vente
            </Link>
          </Button>
        }
      />
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
        <EmptyState icon={Printer} title={done ? "Aucun colis déposé ces 30 derniers jours" : "Aucun bordereau à imprimer"} description="Vous serez notifié dès qu'un bordereau arrive." />
      )}
    </div>
  );
}

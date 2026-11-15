import type { Metadata } from "next";
import Link from "next/link";
import { Camera, ImageOff, Tag } from "lucide-react";
import { requirePreparer } from "@/server/auth/current";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs } from "@/components/shared/list-controls";
import { ClientCode } from "@/components/preparer/cards";
import { PhotoForSaleForm } from "@/components/preparer/photo-for-sale-form";
import { listForSale, type ForSaleItem } from "@/server/queries/sales-board";
import { formatDate } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "À vendre" };

function ItemCard({ item, children }: { item: ForSaleItem; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-soft">
      <div className="flex gap-3">
        <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-muted">
          {item.files[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${item.files[0].id}`} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <ImageOff className="size-5" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <Link href={`/preparateur/stock/${item.id}`} className="block truncate font-medium hover:underline">
            {item.name}
          </Link>
          <ClientCode customer={item.customer} />
          <p className="text-xs text-muted-foreground">
            {item.sku} · {item.quantityAvailable} dispo.{item.storageLocation ? ` · Empl. ${item.storageLocation}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {item.files.length ? `${item.files.length} photo${item.files.length > 1 ? "s" : ""}${item.photosUpdatedAt ? ` · publiées le ${formatDate(item.photosUpdatedAt)}` : ""}` : `Reçu le ${formatDate(item.receivedAt)}`}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

export default async function PreparerForSalePage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePreparer();
  const view = one((await searchParams).vue) === "en-vente" ? "en-vente" : "a-photographier";
  const { ready, toShoot } = await listForSale({ preparerId: actor.preparerId });
  const list = view === "en-vente" ? ready : toShoot;
  return (
    <div className="space-y-6">
      <PageHeader
        title="À vendre"
        description="Photographiez les articles de vos clients : les photos sont publiées dans leur espace « À vendre », où ils les téléchargent pour créer leurs annonces."
      />
      <FilterTabs
        param="vue"
        options={[
          { value: "", label: "À photographier", count: toShoot.length },
          { value: "en-vente", label: "Photos publiées", count: ready.length },
        ]}
      />
      {list.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((item) => (
            <ItemCard key={item.id} item={item}>
              <PhotoForSaleForm itemId={item.id} customerId={item.customerId} hasPhotos={item.files.length > 0} />
            </ItemCard>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={view === "en-vente" ? Tag : Camera}
          title={view === "en-vente" ? "Aucune photo publiée" : "Tous les articles sont photographiés"}
          description={view === "en-vente" ? "Les articles photographiés apparaissent ici." : "Les nouveaux articles mis en stock apparaîtront ici."}
        />
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, Hourglass, ImageOff, Truck } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, Pagination, SearchInput } from "@/components/shared/list-controls";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { db } from "@/server/db";
import { getActiveSubscription } from "@/server/services/customers";
import { getStorageOverview } from "@/server/services/storage";
import { StoragePanel } from "@/components/client/storage-panel";
import { INVENTORY_STATUS } from "@/lib/labels";
import { formatDate, fullName } from "@/lib/format";
import { oneOf, one, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Mon stock" };

export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  const { customer } = await requireSubscribedCustomer();
  const sp = await searchParams;
  const status = oneOf(sp.statut, ["IN_STOCK", "RESERVED", "DEPLETED", "DAMAGED"] as const);
  const q = one(sp.q)?.trim();
  const page = parsePage(sp.page);
  const where: Prisma.InventoryItemWhereInput = {
    customerId: customer.id,
    status: status ?? { not: "ARCHIVED" },
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }, { supplierName: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [items, total, overview, sub] = await Promise.all([
    db.inventoryItem.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * 24,
      take: 24,
      include: { files: { where: { purpose: "PRODUCT_PHOTO", deletedAt: null }, take: 1, select: { id: true } }, preparer: { include: { user: { select: { firstName: true, lastName: true } } } } },
    }),
    db.inventoryItem.count({ where }),
    getStorageOverview(customer.id),
    getActiveSubscription(customer.id),
  ]);
  const now = new Date();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mon stock"
        description="Tous vos articles stockés chez votre préparateur, avec leurs quantités et leur historique."
        actions={
          <Button asChild>
            <Link href="/client/expeditions/nouvelle">
              <Truck /> Demander une expédition
            </Link>
          </Button>
        }
      />
      <StoragePanel overview={overview} planName={sub?.plan.name ?? null} />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterTabs
          param="statut"
          options={[
            { value: "", label: "Tous" },
            { value: "IN_STOCK", label: "En stock" },
            { value: "RESERVED", label: "Réservés" },
            { value: "DEPLETED", label: "Épuisés" },
            { value: "DAMAGED", label: "Abîmés" },
          ]}
        />
        <SearchInput placeholder="Nom, SKU, fournisseur…" />
      </div>
      {items.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => (
            <Link key={i.id} href={`/client/stock/${i.id}`} className="group flex gap-4 rounded-2xl border bg-card p-4 shadow-soft transition-colors hover:border-foreground/15">
              <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-muted">
                {i.files[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${i.files[0].id}`} alt="" className="size-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex size-full items-center justify-center text-muted-foreground">
                    <ImageOff className="size-5" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-medium">{i.name}</p>
                  <StatusFrom map={INVENTORY_STATUS} value={i.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {i.sku}
                  {i.supplierName ? ` · ${i.supplierName}` : ""}
                </p>
                <div className="grid grid-cols-4 gap-1 pt-1 text-center text-[0.7rem]">
                  {[
                    ["Reçus", i.quantityReceived],
                    ["Dispo.", i.quantityAvailable],
                    ["Réservés", i.quantityReserved],
                    ["Expédiés", i.quantityShipped],
                  ].map(([l, v]) => (
                    <div key={l as string} className="rounded-lg bg-muted/60 py-1">
                      <p className="font-semibold tabular">{v}</p>
                      <p className="text-muted-foreground">{l}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[0.7rem] text-muted-foreground">
                  Reçu le {formatDate(i.receivedAt)}
                  {i.storageLocation ? ` · Empl. ${i.storageLocation}` : ""} · {fullName(i.preparer.user)}
                </p>
                {i.quantityAvailable > 0 && !i.dropship && i.storagePaidUntil && (
                  <p className={i.storageOverdueSince ? "flex items-center gap-1 text-[0.7rem] font-medium text-danger" : i.storagePaidUntil.getTime() - now.getTime() < 3 * 86_400_000 ? "flex items-center gap-1 text-[0.7rem] text-warning" : "flex items-center gap-1 text-[0.7rem] text-muted-foreground"}>
                    <Hourglass className="size-3" />
                    {i.storageOverdueSince ? "Stockage en dépassement : crédits requis" : `Stocké jusqu'au ${formatDate(i.storagePaidUntil, "d MMM")}`}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState icon={Boxes} title="Aucun article" description="Les articles apparaissent ici dès leur mise en stock par votre préparateur." />
      )}
      <Pagination page={page} pageSize={24} total={total} basePath="/client/stock" params={{ statut: status, q }} />
    </div>
  );
}

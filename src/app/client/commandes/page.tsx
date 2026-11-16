import type { Metadata } from "next";
import Link from "next/link";
import { Package, Plus } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, Pagination, SearchInput } from "@/components/shared/list-controls";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { db } from "@/server/db";
import { SUPPLIER_ORDER_STATUS, carrierLabel } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { one, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Mes commandes" };

const GROUPS = {
  "en-route": ["REGISTERED", "SUPPLIER_CONFIRMED", "IN_TRANSIT", "AT_LOCKER"],
  recus: ["PICKED_UP", "RECEIVED", "QUALITY_CHECK", "IN_STOCK"],
  incidents: ["INCIDENT", "RETURNED_TO_SUPPLIER"],
  annulees: ["CANCELLED"],
} as const;

export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const { customer } = await requireSubscribedCustomer();
  const sp = await searchParams;
  const group = one(sp.statut) as keyof typeof GROUPS | undefined;
  const q = one(sp.q)?.trim();
  const page = parsePage(sp.page);
  const type = one(sp.type);
  const mode = type === "stock" ? "STOCK" : type === "dropshipping" ? "DROPSHIP" : undefined;
  const where: Prisma.SupplierOrderWhereInput = {
    customerId: customer.id,
    ...(mode ? { mode } : {}),
    ...(group && GROUPS[group] ? { status: { in: [...GROUPS[group]] } } : {}),
    ...(q ? { OR: [{ description: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }, { trackingNumber: { contains: q, mode: "insensitive" } }, { supplierOrderNumber: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [orders, total, counts] = await Promise.all([
    db.supplierOrder.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 20, take: 20, include: { supplier: true, location: { select: { label: true } } } }),
    db.supplierOrder.count({ where }),
    db.supplierOrder.groupBy({ by: ["status"], where: { customerId: customer.id, ...(mode ? { mode } : {}) }, _count: true }),
  ]);
  const count = (statuses: readonly string[]) => counts.filter((c) => statuses.includes(c.status)).reduce((s, c) => s + c._count, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mes commandes"
        description="Vos achats en route vers votre préparateur, réceptionnés et mis en stock."
        actions={
          <Button asChild>
            <Link href="/client/commander#nouvelle-commande">
              <Plus /> Nouvelle commande
            </Link>
          </Button>
        }
      />
      <FilterTabs
        param="type"
        options={[
          { value: "", label: "Toutes les commandes" },
          { value: "stock", label: "Pour mon stock" },
          { value: "dropshipping", label: "Dropshipping" },
        ]}
      />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterTabs
          param="statut"
          options={[
            { value: "", label: "Toutes", count: count(Object.keys(SUPPLIER_ORDER_STATUS)) },
            { value: "en-route", label: "En route", count: count(GROUPS["en-route"]) },
            { value: "recus", label: "Réceptionnées", count: count(GROUPS.recus) },
            { value: "incidents", label: "Incidents", count: count(GROUPS.incidents) },
            { value: "annulees", label: "Annulées", count: count(GROUPS.annulees) },
          ]}
        />
        <SearchInput placeholder="Produit, référence, suivi…" />
      </div>
      {orders.length ? (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
          <ul className="divide-y">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/client/commandes/${o.id}`} className="grid gap-2 px-5 py-4 hover:bg-muted/40 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{o.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {o.reference} · {o.supplier.code === "OTHER" ? o.supplierLabel : o.supplier.name} · {o.location.label} · ×{o.quantity}
                      {o.trackingNumber ? ` · ${carrierLabel(o.carrier)} ${o.trackingNumber}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 sm:justify-end">
                    <span className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</span>
                    <StatusFrom map={SUPPLIER_ORDER_STATUS} value={o.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState icon={Package} title={q || group ? "Aucune commande ne correspond" : "Aucune commande pour le moment"} description="Déclarez vos achats depuis « Commander des articles »." />
      )}
      <Pagination page={page} pageSize={20} total={total} basePath="/client/commandes" params={{ statut: group, q }} />
    </div>
  );
}

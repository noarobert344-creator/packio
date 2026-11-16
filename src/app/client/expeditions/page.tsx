import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Truck } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, Pagination, SearchInput } from "@/components/shared/list-controls";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { db } from "@/server/db";
import { PARCEL_SIZE, SHIPMENT_ACTIVE_STATUSES, SHIPMENT_STATUS, carrierLabel } from "@/lib/labels";
import { formatCredits, formatDate } from "@/lib/format";
import { one, parsePage, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Mes expéditions" };

const GROUPS = {
  "en-cours": SHIPMENT_ACTIVE_STATUSES,
  expediees: ["DROPPED_OFF", "IN_TRANSIT", "DELIVERED"],
  incidents: ["INCIDENT"],
  annulees: ["CANCELLED"],
} as const;

export default async function ShipmentsPage({ searchParams }: { searchParams: SearchParams }) {
  const { customer } = await requireSubscribedCustomer();
  const sp = await searchParams;
  const group = one(sp.statut) as keyof typeof GROUPS | undefined;
  const q = one(sp.q)?.trim();
  const page = parsePage(sp.page);
  const type = one(sp.type);
  const KIND = { stock: "SALE", dropshipping: "DROPSHIP", retours: "RETURN_TO_CUSTOMER" } as const;
  const kind = type && type in KIND ? KIND[type as keyof typeof KIND] : undefined;
  const where: Prisma.OutboundShipmentWhereInput = {
    customerId: customer.id,
    ...(kind ? { kind } : {}),
    ...(group && GROUPS[group] ? { status: { in: [...GROUPS[group]] } } : {}),
    ...(q ? { OR: [{ reference: { contains: q, mode: "insensitive" } }, { recipientName: { contains: q, mode: "insensitive" } }, { trackingNumber: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [shipments, total] = await Promise.all([
    db.outboundShipment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 20, take: 20, include: { _count: { select: { items: true } } } }),
    db.outboundShipment.count({ where }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Mes expéditions"
        description="Suivez la préparation, la classification et l'acheminement de vos colis."
        actions={
          <Button asChild>
            <Link href="/client/expeditions/nouvelle">
              <Plus /> Demander une expédition
            </Link>
          </Button>
        }
      />
      <FilterTabs
        param="type"
        options={[
          { value: "", label: "Tous les envois" },
          { value: "stock", label: "Depuis mon stock" },
          { value: "dropshipping", label: "Dropshipping" },
          { value: "retours", label: "Retours chez moi" },
        ]}
      />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <FilterTabs
          param="statut"
          options={[
            { value: "", label: "Toutes" },
            { value: "en-cours", label: "En cours" },
            { value: "expediees", label: "Expédiées" },
            { value: "incidents", label: "Incidents" },
            { value: "annulees", label: "Annulées" },
          ]}
        />
        <SearchInput placeholder="Référence, destinataire, suivi…" />
      </div>
      {shipments.length ? (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
          <ul className="divide-y">
            {shipments.map((s) => (
              <li key={s.id}>
                <Link href={`/client/expeditions/${s.id}`} className="grid gap-2 px-5 py-4 hover:bg-muted/40 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {s.recipientName} — {s.postalCode} {s.city}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.reference} · {s._count.items} article(s)
                      {s.sizeCategory ? ` · ${PARCEL_SIZE[s.sizeCategory].label} (${formatCredits(s.creditCost)})` : ""}
                      {s.trackingNumber ? ` · ${carrierLabel(s.carrier)} ${s.trackingNumber}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 sm:justify-end">
                    <span className="text-xs text-muted-foreground">{formatDate(s.createdAt)}</span>
                    <StatusFrom map={SHIPMENT_STATUS} value={s.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EmptyState icon={Truck} title="Aucune expédition" description="Sélectionnez des articles de votre stock pour demander une expédition." />
      )}
      <Pagination page={page} pageSize={20} total={total} basePath="/client/expeditions" params={{ statut: group, q }} />
    </div>
  );
}

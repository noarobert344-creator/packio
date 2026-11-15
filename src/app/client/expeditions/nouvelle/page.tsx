import type { Metadata } from "next";
import Link from "next/link";
import { Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ShipmentRequestForm } from "@/components/client/shipment-request-form";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { db } from "@/server/db";
import { getWalletOverview } from "@/server/services/credits";
import { getSizeRules } from "@/server/services/shipments";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Demander une expédition" };

export default async function NewShipmentPage({ searchParams }: { searchParams: SearchParams }) {
  const { customer } = await requireSubscribedCustomer();
  const sp = await searchParams;
  const [items, rules, wallet] = await Promise.all([
    db.inventoryItem.findMany({
      where: { customerId: customer.id, quantityAvailable: { gt: 0 }, ...(customer.currentPreparerId ? { preparerId: customer.currentPreparerId } : {}) },
      orderBy: { receivedAt: "desc" },
      include: { files: { where: { purpose: "PRODUCT_PHOTO", deletedAt: null }, take: 1, select: { id: true } } },
    }),
    getSizeRules(),
    getWalletOverview(customer.id),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader back={{ href: "/client/expeditions", label: "Mes expéditions" }} title="Demander une expédition" description="La demande apparaît immédiatement dans l'espace de votre préparateur." />
      {customer.status !== "ACTIVE" && <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger">Votre abonnement doit être actif et à jour pour demander une expédition.</p>}
      {items.length ? (
        <ShipmentRequestForm
          preselect={one(sp.article)}
          available={wallet.available}
          sizes={rules.map((r) => ({ label: r.label, creditCost: r.creditCost, dims: r.maxLengthCm ? `≤ ${r.maxLengthCm}×${r.maxWidthCm}×${r.maxHeightCm} cm` : "hors gabarit" }))}
          items={items.map((i) => ({ id: i.id, name: i.name, sku: i.sku, available: i.quantityAvailable, photoId: i.files[0]?.id ?? null, storageLocation: i.storageLocation }))}
        />
      ) : (
        <EmptyState icon={Boxes} title="Aucun article disponible" description="Vos articles en stock et non réservés apparaîtront ici.">
          <Button asChild variant="outline">
            <Link href="/client/stock">Voir mon stock</Link>
          </Button>
        </EmptyState>
      )}
    </div>
  );
}

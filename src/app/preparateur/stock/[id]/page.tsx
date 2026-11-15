import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePreparer } from "@/server/auth/current";
import { getItemForActor } from "@/server/services/inventory";
import { getItemExtras, getItemMovements } from "@/server/queries/preparer";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { FileThumbs } from "@/components/shared/file-uploader";
import { ClientCode } from "@/components/preparer/cards";
import { ItemActions } from "@/components/preparer/item-actions";
import { INVENTORY_STATUS, MOVEMENT_TYPE, SHIPMENT_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Article en stock" };

export default async function PreparerItemPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePreparer();
  const { id } = await params;
  const item = await getItemForActor(actor, id).catch(() => null);
  if (!item) notFound();
  const [extras, movements] = await Promise.all([getItemExtras(item.id), getItemMovements(item.id)]);
  if (!extras) notFound();
  const qty = [
    { label: "Reçus", value: item.quantityReceived },
    { label: "Disponibles", value: item.quantityAvailable, strong: true },
    { label: "Réservés", value: item.quantityReserved },
    { label: "Expédiés", value: item.quantityShipped },
    { label: "Abîmés", value: item.quantityDamaged },
    { label: "Manquants", value: item.quantityMissing },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/preparateur/stock", label: "Stock" }}
        eyebrow={item.sku}
        title={item.name}
        description={`Reçu le ${formatDate(item.receivedAt)}${item.supplierName ? ` · ${item.supplierName}` : ""}`}
        actions={<StatusFrom map={INVENTORY_STATUS} value={item.status} />}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Section title="Article" contentClassName="space-y-4">
            <ClientCode customer={extras.customer} className="text-sm" />
            <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {qty.map((q) => (
                <div key={q.label} className={cn("rounded-xl p-2.5 text-center", q.strong ? "bg-brand-soft text-brand" : "bg-muted/60")}>
                  <dt className="text-[0.7rem] text-muted-foreground">{q.label}</dt>
                  <dd className="text-lg font-semibold tabular">{q.value}</dd>
                </div>
              ))}
            </dl>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <p>
                <span className="text-muted-foreground">Emplacement : </span>
                <span className="font-mono">{item.storageLocation ?? "non renseigné"}</span>
              </p>
              {extras.supplierOrder && (
                <p>
                  <span className="text-muted-foreground">Commande : </span>
                  <Link href={`/preparateur/receptions/${extras.supplierOrder.id}`} className="font-mono text-brand hover:underline">
                    {extras.supplierOrder.reference}
                  </Link>
                </p>
              )}
              {item.description && <p className="sm:col-span-2 text-muted-foreground">{item.description}</p>}
              {item.notes && (
                <p className="sm:col-span-2">
                  <span className="text-muted-foreground">Notes : </span>
                  {item.notes}
                </p>
              )}
            </div>
            {extras.files.length > 0 ? <FileThumbs files={extras.files} size="lg" /> : <p className="text-sm text-muted-foreground">Aucune photo pour cet article.</p>}
          </Section>

          {extras.shipmentItems.length > 0 && (
            <Section title="Expéditions liées" contentClassName="p-0">
              <ul className="divide-y text-sm">
                {extras.shipmentItems.map((si) => (
                  <li key={si.shipment.id}>
                    <Link href={`/preparateur/expeditions/${si.shipment.id}`} className="flex items-center justify-between gap-2 px-5 py-3 hover:bg-muted/40">
                      <span>
                        <span className="font-mono">{si.shipment.reference}</span> · ×{si.quantity} · {formatDate(si.shipment.createdAt)}
                      </span>
                      <StatusFrom map={SHIPMENT_STATUS} value={si.shipment.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Historique des mouvements" description="Toutes les opérations sont conservées et ne peuvent pas être effacées." contentClassName="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2.5 text-left font-medium">Date</th>
                    <th className="px-3 py-2.5 text-left font-medium">Mouvement</th>
                    <th className="px-3 py-2.5 text-right font-medium">Variation</th>
                    <th className="px-3 py-2.5 text-right font-medium">Dispo après</th>
                    <th className="px-5 py-2.5 text-left font-medium">Détail</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td className="px-5 py-2.5 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(m.createdAt)}</td>
                      <td className="px-3 py-2.5">{MOVEMENT_TYPE[m.type]}</td>
                      <td className={cn("px-3 py-2.5 text-right font-medium tabular", m.quantity > 0 ? "text-success" : m.quantity < 0 ? "text-danger" : "text-muted-foreground")}>
                        {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular">{m.availableAfter}</td>
                      <td className="px-5 py-2.5 text-xs text-muted-foreground">
                        {m.reason}
                        {m.actor && <span className="block">par {m.actor.role === "ADMIN" ? "l'équipe Packio" : `${m.actor.firstName} ${m.actor.lastName}`}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
        <div className="lg:sticky lg:top-24 lg:self-start">
          <ItemActions
            photoCount={extras.files.length}
            item={{ id: item.id, customerId: item.customerId, name: item.name, storageLocation: item.storageLocation, notes: item.notes, quantityAvailable: item.quantityAvailable, quantityMissing: item.quantityMissing }}
          />
        </div>
      </div>
    </div>
  );
}

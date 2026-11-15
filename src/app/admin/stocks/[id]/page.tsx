import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth/current";
import { getInventoryItemDetail } from "@/server/queries/admin-ops";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { FileThumbs } from "@/components/shared/file-uploader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InfoList } from "@/components/admin/ops/ui";
import { INCIDENT_STATUS, INVENTORY_STATUS, MOVEMENT_TYPE, SHIPMENT_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, fullName } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Article en stock" };

export default async function AdminStockItemPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("operations.read");
  const { id } = await params;
  const item = await getInventoryItemDetail(id);
  if (!item) notFound();
  const qty = [
    { label: "Reçus", value: item.quantityReceived },
    { label: "Disponibles", value: item.quantityAvailable },
    { label: "Réservés", value: item.quantityReserved },
    { label: "Expédiés", value: item.quantityShipped },
    { label: "Abîmés", value: item.quantityDamaged },
    { label: "Manquants", value: item.quantityMissing },
  ];

  return (
    <>
      <PageHeader
        back={{ href: "/admin/stocks", label: "Stocks" }}
        eyebrow={item.sku}
        title={item.name}
        description={item.description ?? undefined}
        actions={<StatusFrom map={INVENTORY_STATUS} value={item.status} />}
      />
      <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {qty.map((q) => (
          <div key={q.label} className="rounded-2xl border bg-card p-3 text-center shadow-soft">
            <p className="text-xl font-semibold">{q.value}</p>
            <p className="text-xs text-muted-foreground">{q.label}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Section title="Historique des mouvements" description="Registre inaltérable : chaque variation de quantité est tracée." contentClassName="p-0">
          {item.movements.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">Aucun mouvement.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Date</TableHead>
                  <TableHead>Mouvement</TableHead>
                  <TableHead className="text-right">Variation</TableHead>
                  <TableHead className="text-right">Dispo. après</TableHead>
                  <TableHead className="text-right">Réservé après</TableHead>
                  <TableHead>Par</TableHead>
                  <TableHead className="pr-5">Motif</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {item.movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="pl-5 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(m.createdAt)}</TableCell>
                    <TableCell className="font-medium">{MOVEMENT_TYPE[m.type]}</TableCell>
                    <TableCell className={cn("text-right tabular", m.quantity > 0 ? "text-success" : m.quantity < 0 ? "text-danger" : "text-muted-foreground")}>
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </TableCell>
                    <TableCell className="text-right tabular">{m.availableAfter}</TableCell>
                    <TableCell className="text-right tabular">{m.reservedAfter}</TableCell>
                    <TableCell className="text-xs">{m.actor ? fullName(m.actor) : "Système"}</TableCell>
                    <TableCell className="max-w-64 pr-5 text-xs whitespace-normal text-muted-foreground">{m.reason ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
        <div className="space-y-6">
          <Section title="Informations">
            <InfoList
              className="sm:grid-cols-1"
              items={[
                { label: "Client", value: <Link className="hover:underline" href={`/admin/clients/${item.customer.id}`}>{fullName(item.customer.user)} ({item.customer.referenceCode})</Link> },
                { label: "Préparateur responsable", value: <Link className="hover:underline" href={`/admin/preparateurs/${item.preparer.id}`}>{fullName(item.preparer.user)}</Link> },
                { label: "Fournisseur", value: item.supplierName },
                { label: "Commande d'origine", value: item.supplierOrder ? <Link className="hover:underline" href={`/admin/commandes/${item.supplierOrder.id}`}>{item.supplierOrder.reference}</Link> : "Ajout manuel" },
                { label: "Emplacement de stockage", value: item.storageLocation },
                { label: "Date de réception", value: formatDate(item.receivedAt) },
                { label: "Notes", value: item.notes },
              ]}
            />
          </Section>
          {item.files.length > 0 && (
            <Section title="Photos">
              <FileThumbs files={item.files} />
            </Section>
          )}
          {item.shipmentItems.length > 0 && (
            <Section title="Expéditions">
              <ul className="space-y-2 text-sm">
                {item.shipmentItems.map((si) => (
                  <li key={si.id} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/expeditions/${si.shipment.id}`} className="hover:underline">
                      {si.shipment.reference} · ×{si.quantity}
                    </Link>
                    <StatusFrom map={SHIPMENT_STATUS} value={si.shipment.status} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {item.incidents.length > 0 && (
            <Section title="Incidents">
              <ul className="space-y-2 text-sm">
                {item.incidents.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/incidents/${i.id}`} className="truncate hover:underline">
                      {i.reference}
                    </Link>
                    <StatusFrom map={INCIDENT_STATUS} value={i.status} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

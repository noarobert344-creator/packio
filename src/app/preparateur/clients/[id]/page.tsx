import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Boxes, MapPin, MessagesSquare, Package, Phone, Truck } from "lucide-react";
import { requirePreparer } from "@/server/auth/current";
import { getMyClient } from "@/server/queries/preparer";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { AddItemDialog, DebitCreditsDialog, InventoryCountDialog } from "@/components/preparer/client-actions";
import { getWalletOverview, listCreditTransactions } from "@/server/services/credits";
import { PREPARER_DEBIT_MAX } from "@/server/services/preparer-credits";
import { randomUUID } from "node:crypto";
import { CREDIT_TX_TYPE, INVENTORY_STATUS, SHIPMENT_STATUS, SUPPLIER_ORDER_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Fiche client" };

export default async function PreparerClientPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePreparer();
  const { id } = await params;
  const data = await getMyClient(actor.preparerId, id);
  if (!data) notFound();
  const { customer, orders, items, shipments, conversationId } = data;
  // Crédits du client : visibles par son préparateur, qui peut en retirer en le justifiant.
  const [wallet, { items: transactions }] = await Promise.all([getWalletOverview(customer.id), listCreditTransactions(customer.id, { take: 8 })]);
  const name = `${customer.user.firstName} ${customer.user.lastName}`;
  const units = items.reduce((s, i) => s + i.quantityAvailable + i.quantityReserved, 0);
  const plan = customer.subscriptions[0]?.plan;
  const countable = items.filter((i) => i.quantityAvailable > 0 || i.quantityMissing > 0).map((i) => ({ id: i.id, name: i.name, sku: i.sku, storageLocation: i.storageLocation, quantityAvailable: i.quantityAvailable }));

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/preparateur/clients", label: "Mes clients" }}
        eyebrow={customer.referenceCode}
        title={name}
        description={`${plan ? `Offre ${plan.name}` : "Sans abonnement actif"} · ${units} article(s) en stock${plan?.storageLimit ? ` sur ${plan.storageLimit}` : ""} · client depuis le ${formatDate(data.assignment.assignedAt)}`}
        actions={
          <>
            {conversationId && (
              <Button asChild variant="outline">
                <Link href={`/preparateur/messages?c=${conversationId}`}>
                  <MessagesSquare /> Contacter le client
                </Link>
              </Button>
            )}
            <DebitCreditsDialog customerId={customer.id} available={wallet.available} requestId={randomUUID()} max={PREPARER_DEBIT_MAX} />
            <InventoryCountDialog customerId={customer.id} items={countable} />
            <AddItemDialog customerId={customer.id} customerLabel={`${name} (${customer.referenceCode})`} />
          </>
        }
      />
      <div className="grid gap-3 rounded-2xl border bg-card p-4 text-sm sm:grid-cols-2">
        <p className="flex items-start gap-2">
          <Phone className="mt-0.5 size-4 shrink-0 text-brand" />
          <span>
            <span className="block text-xs text-muted-foreground">Téléphone</span>
            {customer.user.phone ?? customer.returnPhone ? (
              <a href={`tel:${(customer.user.phone ?? customer.returnPhone)!.replace(/[^+\d]/g, "")}`} className="font-medium hover:underline">
                {customer.user.phone ?? customer.returnPhone}
              </a>
            ) : (
              <span className="text-muted-foreground">Non renseigné</span>
            )}
          </span>
        </p>
        <p className="flex items-start gap-2">
          <MapPin className="mt-0.5 size-4 shrink-0 text-brand" />
          <span>
            <span className="block text-xs text-muted-foreground">Adresse</span>
            {customer.returnAddressLine1 ? (
              <span className="font-medium">
                {[customer.returnAddressLine1, customer.returnAddressLine2, `${customer.returnPostalCode ?? ""} ${customer.returnCity ?? ""}`.trim(), customer.returnCountry && customer.returnCountry !== "FR" ? customer.returnCountry : null]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            ) : (
              <span className="text-muted-foreground">Non renseignée</span>
            )}
          </span>
        </p>
      </div>
      <div className="rounded-2xl border bg-muted/40 p-4 text-sm">
        <p className="font-medium">Identifier les colis de ce client</p>
        <p className="mt-0.5 text-muted-foreground">
          Le code client <span className="rounded-md bg-foreground px-1.5 py-0.5 font-mono text-xs font-semibold text-background">{customer.referenceCode}</span> figure en complément du nom du destinataire sur les colis envoyés à vos points de réception.
        </p>
      </div>

      <Section
        title="Crédits du client"
        description={`${wallet.available} crédit(s) disponible(s)${wallet.wallet.reservedBalance ? `, ${wallet.wallet.reservedBalance} réservé(s) pour des expéditions` : ""}. Tout retrait doit être justifié : le motif est envoyé au client.`}
        contentClassName="p-0"
      >
        {transactions.length ? (
          <ul className="divide-y">
            {transactions.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{t.description ?? CREDIT_TX_TYPE[t.type]}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(t.createdAt)}
                    {t.reason ? ` · ${t.reason}` : ""}
                  </span>
                </span>
                <span className={t.amount < 0 ? "shrink-0 font-medium text-danger tabular" : "shrink-0 font-medium text-success tabular"}>
                  {t.amount > 0 ? "+" : ""}
                  {t.amount}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-sm text-muted-foreground">Aucun mouvement de crédits.</p>
        )}
      </Section>

      <Section title="Stock chez vous" description="Articles du client que vous détenez." contentClassName="p-0">
        {items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 text-left font-medium">Article</th>
                  <th className="px-3 py-2.5 text-left font-medium">Emplacement</th>
                  <th className="px-3 py-2.5 text-right font-medium">Dispo</th>
                  <th className="px-3 py-2.5 text-right font-medium">Réservé</th>
                  <th className="px-3 py-2.5 text-right font-medium">Expédié</th>
                  <th className="px-5 py-2.5 text-left font-medium">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((i) => (
                  <tr key={i.id} className="hover:bg-muted/40">
                    <td className="px-5 py-3">
                      <Link href={`/preparateur/stock/${i.id}`} className="flex items-center gap-3">
                        <span className="size-9 shrink-0 overflow-hidden rounded-lg border bg-muted">
                          {i.files[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`/api/files/${i.files[0].id}`} alt="" className="size-full object-cover" loading="lazy" />
                          ) : (
                            <Boxes className="m-2 size-5 text-muted-foreground" />
                          )}
                        </span>
                        <span>
                          <span className="block font-medium">{i.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">{i.sku}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{i.storageLocation ?? "—"}</td>
                    <td className="px-3 py-3 text-right tabular">{i.quantityAvailable}</td>
                    <td className="px-3 py-3 text-right tabular">{i.quantityReserved}</td>
                    <td className="px-3 py-3 text-right tabular">{i.quantityShipped}</td>
                    <td className="px-5 py-3">
                      <StatusFrom map={INVENTORY_STATUS} value={i.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucun article en stock pour ce client.</p>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Commandes entrantes" contentClassName="p-0">
          {orders.length ? (
            <ul className="divide-y">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/preparateur/receptions/${o.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40">
                    <Package className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{o.description}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{o.reference}</span> · {o.supplier.code === "OTHER" ? (o.supplierLabel ?? "Autre") : o.supplier.name} · {formatDate(o.createdAt)}
                      </p>
                    </div>
                    <StatusFrom map={SUPPLIER_ORDER_STATUS} value={o.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucune commande.</p>
          )}
        </Section>
        <Section title="Expéditions" contentClassName="p-0">
          {shipments.length ? (
            <ul className="divide-y">
              {shipments.map((s) => (
                <li key={s.id}>
                  <Link href={`/preparateur/expeditions/${s.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40">
                    <Truck className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {s.recipientName} · {s.city}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{s.reference}</span> · {s._count.items} article(s) · {formatDate(s.createdAt)}
                      </p>
                    </div>
                    <StatusFrom map={SHIPMENT_STATUS} value={s.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Aucune expédition.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

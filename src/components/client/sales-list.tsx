import Link from "next/link";
import { Ban, CalendarClock, CircleCheck, ExternalLink, FileText, Layers, PackageCheck, Ruler, Send, ShoppingBag, Store, Trash2, Truck, Undo2, Warehouse, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusFrom } from "@/components/shared/status-badge";
import { ActionDialog } from "@/components/shared/action-dialog";
import { SelectField } from "@/components/shared/form-field";
import { ActionButton } from "@/components/shared/action-dialog";
import { deleteSaleAction, keepCancelledSaleAction, matchSaleAction } from "@/server/actions/marketplace";
import { suggestStockItem } from "@/lib/match-title";
import { nowMs } from "@/server/lib/clock";
import type { listMarketplaceOverview } from "@/server/services/marketplace";
import { CARRIERS, MARKETPLACE_PLATFORM, MARKETPLACE_SALE_STATUS, SHIPMENT_STATUS, SUPPLIER_ORDER_STATUS } from "@/lib/labels";
import { trackingUrl } from "@/lib/tracking";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Overview = Awaited<ReturnType<typeof listMarketplaceOverview>>;
type Sale = Overview["sales"][number];
export type StockOption = { id: string; name: string; quantityAvailable: number; receivedAt: Date };

/** Libellés du stock : deux articles du même nom sont distingués par leur date d'arrivée. */
function stockOptions(stock: StockOption[]) {
  const names = new Map<string, number>();
  for (const i of stock) names.set(i.name, (names.get(i.name) ?? 0) + 1);
  return stock.map((i) => ({
    value: i.id,
    label: `${i.name}${(names.get(i.name) ?? 0) > 1 ? ` · arrivé le ${formatDate(i.receivedAt, "d MMM")}` : ""} (${i.quantityAvailable} dispo.)`,
  }));
}

/**
 * « Toutes mes ventes » : une carte par article vendu sur un compte lié.
 * Sous chaque vente à traiter, trois boutons : « Vente normale » (article du
 * stock, le préparateur expédie), « Vente dropshipping » (commandé chez le
 * fournisseur) ou « Supprimer » (article expédié par le client lui-même).
 */
export function SalesList({ sales, stock }: { sales: Sale[]; stock: StockOption[] }) {
  const itemOptions = stockOptions(stock);
  return (
    <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {sales.map((s) => (
        <SaleCard key={s.id} sale={s} itemOptions={itemOptions} stock={stock} />
      ))}
    </ul>
  );
}

/** Date limite d'envoi : orange à moins de 48 h, rouge une fois dépassée. */
function Deadline({ sale }: { sale: Sale }) {
  const open = (sale.status === "NEW" || sale.status === "MATCHED") && !sale.shipment && !sale.dropshipOrder;
  const shipping = sale.shipment && !["DROPPED_OFF", "IN_TRANSIT", "DELIVERED", "CANCELLED"].includes(sale.shipment.status);
  if (!sale.shipBy || !(open || shipping)) return null;
  const left = sale.shipBy.getTime() - nowMs();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
        left < 0 ? "bg-destructive/10 text-destructive" : left < 48 * 3_600_000 ? "bg-warning-soft text-warning" : "bg-muted text-muted-foreground",
      )}
      title={sale.shipByEstimated ? "Date estimée : 5 jours ouvrés après la vente" : `Date limite ${MARKETPLACE_PLATFORM[sale.platform]}`}
    >
      <CalendarClock className="size-3" />
      {left < 0 ? "Date limite dépassée" : `À envoyer avant le ${formatDate(sale.shipBy, "d MMM")}`}
      {sale.shipByEstimated && " (estimée)"}
    </span>
  );
}

function SaleCard({ sale: s, itemOptions, stock }: { sale: Sale; itemOptions: { value: string; label: string }[]; stock: StockOption[] }) {
  const pending = !s.shipment && !s.dropshipOrder && (s.status === "NEW" || s.status === "MATCHED");
  const ownPhoto = s.inventoryItem?.files[0]?.id;
  const platform = MARKETPLACE_PLATFORM[s.platform];
  const photoUrl = s.listing?.photoUrl?.startsWith("https://") ? s.listing.photoUrl : s.photoUrl?.startsWith("https://") ? s.photoUrl : null;
  const lines = s.lines.length ? s.lines.map((l) => ({ title: l.title, size: l.size, itemId: l.inventoryItem?.id ?? null })) : [{ title: s.title, size: s.size, itemId: s.inventoryItem?.id ?? null }];
  const waitingItems = s.status === "CANCELLED" ? (s.dropshipOrder?.inventoryItems ?? []) : [];
  return (
    <li className="flex flex-col rounded-2xl border bg-card p-4 shadow-soft">
      <div className="flex gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
          {ownPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${ownPhoto}`} alt="" className="size-full object-cover" loading="lazy" />
          ) : photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <ShoppingBag className="size-6 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-medium leading-snug">{s.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{platform}</span>
            {s.priceCents !== null && <span>· {formatMoney(s.priceCents, s.currency)}</span>}
            <span>· {formatDateTime(s.soldAt)}</span>
            {s.listing?.url && (
              <a href={s.listing.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center hover:text-foreground" aria-label="Voir l'annonce">
                <ExternalLink className="size-3" />
              </a>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {s.manual ? "Ajoutée à la main" : `Commande n° ${s.externalOrderId}`}
            {s.buyerName ? ` · ${s.buyerName}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        {s.account && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground" title={`Compte ${platform}`}>
            <Store className="size-3" /> {s.account.username ?? `Compte ${s.account.externalUserId}`}
          </span>
        )}
        {s.size && !s.lines.length && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            <Ruler className="size-3" /> Taille {s.size}
          </span>
        )}
        <Deadline sale={s} />
      </div>
      {s.lines.length > 0 && (
        <div className="mt-3 rounded-xl border border-dashed p-3 text-xs">
          <p className="flex items-center gap-1.5 font-medium">
            <Layers className="size-3.5 text-brand" /> Lot de {s.lines.length} articles : un seul carton, un seul bordereau
          </p>
          <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
            {s.lines.map((l) => (
              <li key={l.id} className="truncate">
                · {l.title}
                {l.size ? ` (taille ${l.size})` : ""}
                {l.inventoryItem ? <span className="text-foreground/80"> → {l.inventoryItem.name}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {!s.shipment && !s.dropshipOrder && <StatusFrom map={MARKETPLACE_SALE_STATUS} value={s.status} />}
        {s._count.files > 0 && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <FileText className="size-3.5" /> Bordereau reçu
          </span>
        )}
      </div>
      {s.inventoryItem && (
        <p className="mt-2 text-xs text-muted-foreground">
          Article de votre stock :{" "}
          <Link href={`/client/stock/${s.inventoryItem.id}`} className="font-medium text-foreground hover:underline">
            {s.inventoryItem.name}
          </Link>
        </p>
      )}
      {s.notes && <p className="mt-2 text-xs text-warning">{s.notes}</p>}
      <Tracking sale={s} />

      <div className="mt-auto pt-4">
        {s.status === "CANCELLED" ? (
          <div className="grid gap-2">
            <p className="flex items-start gap-1.5 rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
              <Ban className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <span className="font-medium">Vente annulée{s.cancelledAt ? ` le ${formatDate(s.cancelledAt, "d MMMM")}` : ""}.</span>{" "}
                {waitingItems.length
                  ? "L'article est chez votre préparateur : gardez-le en stock ou renvoyez-le au fournisseur."
                  : s.shipment?.status === "CANCELLED" || s.dropshipOrder?.dropshipShipment?.status === "CANCELLED"
                    ? "L'expédition a été bloquée avant le dépôt : l'article reste dans votre stock."
                    : s.dropshipOrder && s.dropshipOrder.status !== "IN_STOCK" && s.dropshipOrder.status !== "CANCELLED"
                      ? "Votre commande fournisseur est en route : annulez-la si possible, sinon vous choisirez à son arrivée."
                      : "Rien n'a été expédié."}
              </span>
            </p>
            {waitingItems.length > 0 && (
              <>
                <ActionButton action={keepCancelledSaleAction} fields={{ saleId: s.id }} className="w-full">
                  <Warehouse /> Garder en stock
                </ActionButton>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/client/expeditions/nouvelle">
                    <Undo2 /> Renvoyer au fournisseur
                  </Link>
                </Button>
              </>
            )}
          </div>
        ) : s.status === "SHIPPED_ELSEWHERE" ? (
          <p className="flex items-center gap-1.5 rounded-xl bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            <Send className="size-3.5 shrink-0" /> {platform} indique ce colis parti : envoyé en dehors de Packio.
          </p>
        ) : s.dropshipOrder ? (
          <Link href={`/client/commandes/${s.dropshipOrder.id}`} className="block rounded-xl bg-brand-soft px-3 py-2.5 text-brand transition-colors hover:bg-brand-soft/70">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Zap className="size-4 shrink-0" /> Vente dropshipping
            </span>
            <span className="mt-0.5 block text-xs">
              {s.dropshipOrder.dropshipShipment ? (
                <>
                  Expédition à l&apos;acheteur <span className="font-mono">{s.dropshipOrder.dropshipShipment.reference}</span> · {SHIPMENT_STATUS[s.dropshipOrder.dropshipShipment.status].label}
                </>
              ) : (
                <>
                  Commande <span className="font-mono">{s.dropshipOrder.reference}</span> · {SUPPLIER_ORDER_STATUS[s.dropshipOrder.status].label}
                </>
              )}
            </span>
          </Link>
        ) : s.shipment ? (
          <Link href={`/client/expeditions/${s.shipment.id}`} className="block rounded-xl bg-success-soft px-3 py-2.5 text-success transition-colors hover:bg-success-soft/70">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <CircleCheck className="size-4 shrink-0" /> Vente normale
            </span>
            <span className="mt-0.5 block text-xs text-success/80">
              Expédition <span className="font-mono">{s.shipment.reference}</span> · {SHIPMENT_STATUS[s.shipment.status].label}
            </span>
          </Link>
        ) : pending ? (
          <div className="grid gap-2">
            <ActionDialog
              trigger={
                <Button className="w-full">
                  <PackageCheck /> Vente normale
                </Button>
              }
              title="Vente normale"
              description={
                lines.length > 1
                  ? `Choisissez l'article de votre stock pour chaque article du lot : votre préparateur les expédie dans un seul carton sous 48 h, avec le bordereau ${platform}.`
                  : `Quel article de votre stock avez-vous vendu ? Votre préparateur l'expédie sous 48 h, avec le bordereau ${platform} dès qu'il est généré.`
              }
              action={matchSaleAction}
              submitLabel="Confirmer l'expédition"
            >
              <input type="hidden" name="saleId" value={s.id} />
              {itemOptions.length ? (
                lines.map((l, i) => {
                  const suggested = l.itemId ?? suggestStockItem(l.title, l.size, stock)?.id ?? "";
                  return (
                    <SelectField
                      key={i}
                      name="itemIds[]"
                      label={lines.length > 1 ? `${l.title}${l.size ? ` (taille ${l.size})` : ""}` : "Article vendu"}
                      required
                      options={itemOptions}
                      placeholder="Choisir dans mon stock"
                      defaultValue={suggested}
                      hint={suggested && !l.itemId ? "Pré-rempli d'après le titre de l'annonce : vérifiez." : undefined}
                    />
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground">Aucun article disponible dans votre stock : commandez ou faites livrer l&apos;article chez votre préparateur.</p>
              )}
            </ActionDialog>
            <Button asChild variant="secondary" className="w-full">
              <Link href={`/client/commander?vente=${s.id}#nouvelle-commande`}>
                <Zap /> Vente dropshipping
              </Link>
            </Button>
            <ActionDialog
              trigger={
                <Button variant="outline" className="w-full text-muted-foreground" aria-label="Supprimer la vente">
                  <Trash2 /> Supprimer de mes ventes
                </Button>
              }
              title="Supprimer de mes ventes ?"
              description={`À utiliser si vous expédiez « ${s.title} » vous-même. La vente disparaît de Packio (rien ne change sur ${platform}) ; le nom de l'acheteur et le bordereau éventuel sont effacés.`}
              action={deleteSaleAction}
              submitLabel="Supprimer"
              destructive
            >
              <input type="hidden" name="saleId" value={s.id} />
            </ActionDialog>
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** « Où est mon colis ? » : numéro de suivi du transporteur, avec lien. */
function Tracking({ sale }: { sale: Sale }) {
  const outbound = sale.dropshipOrder?.dropshipShipment ?? sale.shipment;
  const inbound = sale.dropshipOrder && !sale.dropshipOrder.dropshipShipment ? sale.dropshipOrder : null;
  const parcel = outbound?.trackingNumber ? outbound : inbound?.trackingNumber ? inbound : null;
  if (!parcel?.trackingNumber) return null;
  const url = trackingUrl(parcel.carrier, parcel.trackingNumber);
  const carrier = CARRIERS.find((c) => c.code === parcel.carrier)?.label ?? parcel.carrier ?? "Transporteur";
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Truck className="size-3.5" />
      {inbound && parcel === inbound ? "Vers votre préparateur :" : "Vers l'acheteur :"} {carrier}{" "}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-mono text-foreground hover:underline">
          {parcel.trackingNumber} <ExternalLink className="size-3" />
        </a>
      ) : (
        <span className="font-mono text-foreground">{parcel.trackingNumber}</span>
      )}
    </p>
  );
}

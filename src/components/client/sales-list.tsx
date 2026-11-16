import Link from "next/link";
import { CircleCheck, ExternalLink, FileText, PackageCheck, ShoppingBag, Trash2, Truck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusFrom } from "@/components/shared/status-badge";
import { ActionDialog } from "@/components/shared/action-dialog";
import { SelectField } from "@/components/shared/form-field";
import { deleteSaleAction, matchSaleAction } from "@/server/actions/marketplace";
import type { listMarketplaceOverview } from "@/server/services/marketplace";
import { CARRIERS, MARKETPLACE_PLATFORM, MARKETPLACE_SALE_STATUS, SHIPMENT_STATUS, SUPPLIER_ORDER_STATUS } from "@/lib/labels";
import { trackingUrl } from "@/lib/tracking";
import { formatDateTime, formatMoney } from "@/lib/format";

type Overview = Awaited<ReturnType<typeof listMarketplaceOverview>>;
type Sale = Overview["sales"][number];

/**
 * « Toutes les ventes » : une carte par article vendu sur un compte lié.
 * Sous chaque vente à traiter : « Vendu avec Packio » (le préparateur expédie)
 * ou « Supprimer » (article expédié par le client lui-même).
 */
export function SalesList({ sales, itemOptions }: { sales: Sale[]; itemOptions: { value: string; label: string }[] }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {sales.map((s) => (
        <SaleCard key={s.id} sale={s} itemOptions={itemOptions} />
      ))}
    </ul>
  );
}

function SaleCard({ sale: s, itemOptions }: { sale: Sale; itemOptions: { value: string; label: string }[] }) {
  const pending = !s.shipment && !s.dropshipOrder && (s.status === "NEW" || s.status === "MATCHED");
  const ownPhoto = s.inventoryItem?.files[0]?.id;
  const platform = MARKETPLACE_PLATFORM[s.platform];
  return (
    <li className="flex flex-col rounded-2xl border bg-card p-4 shadow-soft">
      <div className="flex gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
          {ownPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${ownPhoto}`} alt="" className="size-full object-cover" loading="lazy" />
          ) : s.listing?.photoUrl?.startsWith("https://") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.listing.photoUrl} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
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
            Commande n° {s.externalOrderId}
            {s.buyerName ? ` · ${s.buyerName}` : ""}
          </p>
        </div>
      </div>

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
          Article Packio :{" "}
          <Link href={`/client/stock/${s.inventoryItem.id}`} className="font-medium text-foreground hover:underline">
            {s.inventoryItem.name}
          </Link>{" "}
          <span className="font-mono">{s.inventoryItem.sku}</span>
        </p>
      )}
      {s.notes && <p className="mt-2 text-xs text-warning">{s.notes}</p>}
      <Tracking sale={s} />

      <div className="mt-auto pt-4">
        {s.dropshipOrder ? (
          <Link href={`/client/commandes/${s.dropshipOrder.id}`} className="block rounded-xl bg-brand-soft px-3 py-2.5 text-brand transition-colors hover:bg-brand-soft/70">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Zap className="size-4 shrink-0" /> Vendu en dropshipping
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
              <CircleCheck className="size-4 shrink-0" /> Vendu avec Packio
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
                  <PackageCheck /> Vendu avec Packio
                </Button>
              }
              title="Vendu avec Packio"
              description={`Choisissez l'article de votre stock : votre préparateur l'expédie sous 48 h, avec le bordereau ${platform} dès qu'il est généré.`}
              action={matchSaleAction}
              submitLabel="Confirmer l'expédition"
            >
              <input type="hidden" name="saleId" value={s.id} />
              {itemOptions.length ? (
                <SelectField name="itemId" label="Article de votre stock" required options={itemOptions} placeholder="Choisir un article" defaultValue={s.inventoryItem?.id ?? ""} />
              ) : (
                <p className="text-sm text-muted-foreground">Aucun article disponible dans votre stock : commandez ou faites livrer l&apos;article chez votre préparateur.</p>
              )}
            </ActionDialog>
            <Button asChild variant="secondary" className="w-full">
              <Link href={`/client/commander?vente=${s.id}#nouvelle-commande`}>
                <Zap /> Vendu en dropshipping
              </Link>
            </Button>
            <ActionDialog
              trigger={
                <Button variant="outline" className="w-full text-muted-foreground" aria-label="Supprimer la vente">
                  <Trash2 /> Supprimer
                </Button>
              }
              title="Supprimer cette vente ?"
              description={`À utiliser si vous expédiez « ${s.title} » vous-même. La vente disparaît de la liste ; le nom de l'acheteur et le bordereau éventuel sont effacés de Packio.`}
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

import Link from "next/link";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarClock, ChevronRight, KeyRound, MapPin, Package, Store, Timer, Truck, Ruler } from "lucide-react";
import type { ParcelSize, ShipmentKind, ShipmentStatus, SupplierOrderStatus } from "@/generated/prisma/enums";
import { StatusFrom } from "@/components/shared/status-badge";
import { CopyButton } from "@/components/shared/copy-button";
import { PARCEL_SIZE, SHIPMENT_KIND, SHIPMENT_STATUS, SUPPLIER_ORDER_STATUS, carrierLabel } from "@/lib/labels";
import { nowMs } from "@/server/lib/clock";
import { formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

type CustomerRef = { referenceCode: string; user: { firstName: string; lastName: string } };

export function ClientCode({ customer, className }: { customer: CustomerRef; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <span className="shrink-0 rounded-md bg-foreground px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold tracking-wide whitespace-nowrap text-background">{customer.referenceCode}</span>
      <span className="truncate">
        {customer.user.firstName} {customer.user.lastName}
      </span>
    </span>
  );
}

/** Code de retrait affiché en grand, copiable (utilisé au locker, souvent sur mobile). */
export function PickupCode({ code, size = "lg" }: { code: string | null; size?: "sm" | "lg" }) {
  if (!code) {
    if (size === "sm") return null;
    return (
      <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <KeyRound className="size-4" /> Code de retrait
        </p>
        <p className="mt-1">Le client n&apos;a pas encore transmis de code de retrait. Contactez-le si le locker en exige un.</p>
      </div>
    );
  }
  if (size === "sm") {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-brand-soft px-2 py-1 font-mono text-xs font-semibold tracking-widest text-brand">
        <KeyRound className="size-3" />
        {code}
      </span>
    );
  }
  return (
    <div className="rounded-2xl bg-brand p-4 text-brand-foreground glow-brand sm:p-5">
      <p className="flex items-center gap-2 text-xs font-medium tracking-wider text-white/80 uppercase">
        <KeyRound className="size-3.5" /> Code de retrait
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-3xl font-bold tracking-[0.25em] tabular sm:text-4xl">{code}</p>
        <CopyButton value={code} label="Copier" variant="secondary" size="lg" successMessage="Code de retrait copié" />
      </div>
    </div>
  );
}

export type OrderCardData = {
  id: string;
  reference: string;
  description: string;
  quantity: number;
  status: SupplierOrderStatus;
  trackingNumber: string | null;
  carrier: string | null;
  pickupCode: string | null;
  expectedArrivalAt: Date | null;
  statusChangedAt: Date;
  supplierLabel: string | null;
  arrivalOther: boolean;
  arrivalNote: string | null;
  supplier: { name: string; code: string };
  customer: CustomerRef;
  location: { label: string; relayName: string | null; city: string; type?: string };
};

export function OrderCard({ order }: { order: OrderCardData }) {
  return (
    <Link
      href={`/preparateur/receptions/${order.id}`}
      className="group flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-soft transition-colors hover:border-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{order.reference}</span>
        <StatusFrom map={SUPPLIER_ORDER_STATUS} value={order.status} />
      </div>
      <div className="min-w-0 space-y-1.5">
        <p className="line-clamp-2 font-medium">
          {order.description} <span className="text-muted-foreground">×{order.quantity}</span>
        </p>
        <ClientCode customer={order.customer} />
      </div>
      <div className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
        <span className="flex items-center gap-1.5">
          <Store className="size-3.5 shrink-0" /> {order.supplier.code === "OTHER" ? (order.supplierLabel ?? "Autre fournisseur") : order.supplier.name}
        </span>
        <span className={order.arrivalOther ? "flex min-w-0 items-center gap-1.5 font-medium text-warning sm:col-span-2" : "flex min-w-0 items-center gap-1.5"}>
          <MapPin className="size-3.5 shrink-0" />
          <span className="truncate">
            {order.arrivalOther ? `Autre point : ${order.arrivalNote}` : `${order.location.relayName ?? order.location.label}${order.arrivalNote ? ` · ${order.arrivalNote}` : ""}`}
          </span>
        </span>
        {order.trackingNumber && (
          <span className="flex min-w-0 items-center gap-1.5">
            <Truck className="size-3.5 shrink-0" />
            <span className="truncate font-mono">
              {carrierLabel(order.carrier)} · {order.trackingNumber}
            </span>
          </span>
        )}
        {order.expectedArrivalAt && (
          <span className="flex items-center gap-1.5">
            <CalendarClock className="size-3.5 shrink-0" /> Prévu le {formatDate(order.expectedArrivalAt, "d MMM")}
          </span>
        )}
      </div>
      {order.status === "AT_LOCKER" && (
        <p className="flex items-center gap-1.5 rounded-xl bg-brand-soft px-3 py-2 text-xs font-medium text-brand">
          <KeyRound className="size-3.5 shrink-0" />
          {order.pickupCode
            ? "Colis arrivé : le client vous a donné le code de retrait."
            : order.location.type === "POST_OFFICE"
              ? "Colis arrivé au bureau de poste : retrait avec votre pièce d'identité."
              : "Colis arrivé, sans code de retrait pour l'instant."}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        {order.pickupCode ? <PickupCode code={order.pickupCode} size="sm" /> : <span className="text-xs text-muted-foreground">Mis à jour {formatRelative(order.statusChangedAt)}</span>}
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

export type ShipmentCardData = {
  id: string;
  reference: string;
  status: ShipmentStatus;
  recipientName: string;
  city: string;
  postalCode: string;
  country: string;
  requestedCarrier: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  sizeCategory: ParcelSize | null;
  creditCost: number | null;
  createdAt: Date;
  customer: CustomerRef;
  itemCount: number;
  kind?: ShipmentKind;
  dueAt?: Date | null;
};

const SLA_OPEN: ShipmentStatus[] = ["REQUESTED", "AWAITING_CLASSIFICATION", "CLASSIFIED", "PREPARING", "READY", "LABEL_READY"];

export function ShipmentCard({ shipment }: { shipment: ShipmentCardData }) {
  const due = shipment.dueAt && SLA_OPEN.includes(shipment.status) ? shipment.dueAt : null;
  const late = due ? due.getTime() < nowMs() : false;
  return (
    <Link
      href={`/preparateur/expeditions/${shipment.id}`}
      className="group flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-soft transition-colors hover:border-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{shipment.reference}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {shipment.kind && shipment.kind !== "SALE" && <StatusFrom map={SHIPMENT_KIND} value={shipment.kind} />}
          <StatusFrom map={SHIPMENT_STATUS} value={shipment.status} />
        </span>
      </div>
      <div className="space-y-1.5">
        <p className="font-medium">
          {shipment.kind === "RETURN_TO_CUSTOMER" ? "Retour au client" : shipment.recipientName} · {shipment.postalCode} {shipment.city}
          {shipment.country !== "FR" && ` (${shipment.country})`}
        </p>
        <ClientCode customer={shipment.customer} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Package className="size-3.5" /> {shipment.itemCount} article{shipment.itemCount > 1 ? "s" : ""}
        </span>
        <span className="flex items-center gap-1.5">
          <Truck className="size-3.5" /> {carrierLabel(shipment.carrier ?? shipment.requestedCarrier)}
        </span>
        {shipment.sizeCategory && (
          <span className="flex items-center gap-1.5">
            <Ruler className="size-3.5" /> {PARCEL_SIZE[shipment.sizeCategory].label}
            {shipment.creditCost !== null && ` · ${shipment.creditCost} cr.`}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        {due ? (
          <span className={late ? "flex items-center gap-1 font-medium text-danger" : "flex items-center gap-1"}>
            <Timer className="size-3.5" /> {late ? "En retard" : `Avant le ${format(due, "d MMM HH'h'mm", { locale: fr })}`}
          </span>
        ) : (
          <span>Demandée {formatRelative(shipment.createdAt)}</span>
        )}
        <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

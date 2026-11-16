import Link from "next/link";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowRight, Download, FileText, ImageOff, Printer, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusFrom } from "@/components/shared/status-badge";
import { MARKETPLACE_PLATFORM, SHIPMENT_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { LabelBoardShipment } from "@/server/queries/sales-board";

const SLA_OPEN = ["REQUESTED", "AWAITING_CLASSIFICATION", "CLASSIFIED", "PREPARING", "READY", "LABEL_READY"];

function sourceLabel(s: LabelBoardShipment) {
  if (s.marketplaceSale) return `Vente ${MARKETPLACE_PLATFORM[s.marketplaceSale.platform]} n° ${s.marketplaceSale.externalOrderId}`;
  if (s.dropshipOrder) {
    const platform = s.dropshipOrder.salePlatform ? `${MARKETPLACE_PLATFORM[s.dropshipOrder.salePlatform]} ` : "";
    return `Dropshipping · vente ${platform}${s.dropshipOrder.saleReference ?? s.dropshipOrder.reference}`.replace("  ", " ");
  }
  if (s.kind === "RETURN_TO_CUSTOMER") return "Retour au client";
  return "Bordereau fourni par le client";
}

/**
 * Bordereaux reçus, chacun à côté de l'article à expédier : la préparatrice
 * l'imprime, le colle et dépose le colis.
 */
export function LabelBoard({ shipments, role, now }: { shipments: LabelBoardShipment[]; role: "CUSTOMER" | "PREPARER"; now: number }) {
  const shipmentHref = (id: string) => (role === "PREPARER" ? `/preparateur/expeditions/${id}` : `/client/expeditions/${id}`);
  return (
    <div className="grid gap-4">
      {shipments.map((s) => {
        const label = s.files[0];
        const isImage = label?.mimeType.startsWith("image/");
        const due = s.dueAt && SLA_OPEN.includes(s.status) ? s.dueAt : null;
        const late = !!due && due.getTime() < now;
        return (
          <article key={s.id} className="overflow-hidden rounded-2xl border bg-card shadow-soft">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{s.reference}</span>
                <span className="font-medium">{sourceLabel(s)}</span>
                {role === "PREPARER" && (
                  <span className="rounded-md bg-foreground px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold text-background">{s.customer.referenceCode}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {due && (
                  <span className={cn("inline-flex items-center gap-1 text-xs", late ? "font-medium text-danger" : "text-muted-foreground")}>
                    <Timer className="size-3.5" />
                    {late ? "En retard" : `À déposer avant le ${format(due, "d MMM 'à' HH'h'mm", { locale: fr })}`}
                  </span>
                )}
                <StatusFrom map={SHIPMENT_STATUS} value={s.status} />
              </div>
            </header>
            <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_16rem]">
              <ul className="space-y-3">
                {s.items.map((it) => (
                  <li key={it.id} className="flex items-center gap-3">
                    <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                      {it.inventoryItem.files[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/files/${it.inventoryItem.files[0].id}`} alt="" className="size-full object-cover" loading="lazy" />
                      ) : (
                        <div className="flex size-full items-center justify-center text-muted-foreground">
                          <ImageOff className="size-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{it.inventoryItem.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {role === "PREPARER" ? `${it.inventoryItem.sku} · ` : ""}× {it.quantity}
                        {role === "PREPARER" && it.inventoryItem.storageLocation ? ` · Empl. ${it.inventoryItem.storageLocation}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
                {s.marketplaceSale && <li className="text-xs text-muted-foreground">Annonce : « {s.marketplaceSale.title} »</li>}
              </ul>
              {label && (
                <div className="flex flex-col gap-2 rounded-xl border bg-background/40 p-3">
                  <a href={`/api/files/${label.id}`} target="_blank" rel="noopener noreferrer" className="group block overflow-hidden rounded-lg bg-muted" title="Ouvrir le bordereau">
                    {isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/files/${label.id}`} alt="Bordereau" className="h-36 w-full object-contain" loading="lazy" />
                    ) : (
                      <div className="flex h-36 flex-col items-center justify-center gap-2 text-muted-foreground transition-colors group-hover:text-foreground">
                        <FileText className="size-8" />
                        <span className="max-w-full truncate px-2 text-xs">{label.filename}</span>
                      </div>
                    )}
                  </a>
                  <p className="text-[0.7rem] text-muted-foreground">Reçu le {format(label.createdAt, "d MMM 'à' HH'h'mm", { locale: fr })}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button asChild size="sm">
                      <a href={`/api/files/${label.id}`} target="_blank" rel="noopener noreferrer">
                        <Printer /> Imprimer
                      </a>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <a href={`/api/files/${label.id}?telecharger`}>
                        <Download /> Télécharger
                      </a>
                    </Button>
                  </div>
                  <Link href={shipmentHref(s.id)} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                    Ouvrir l&apos;expédition <ArrowRight className="size-3" />
                  </Link>
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

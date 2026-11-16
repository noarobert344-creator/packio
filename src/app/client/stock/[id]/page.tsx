import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Hourglass, Images, Truck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, Section } from "@/components/shared/page-header";
import { StatusFrom } from "@/components/shared/status-badge";
import { FileThumbs } from "@/components/shared/file-uploader";
import { ReportIncidentDialog } from "@/components/incidents/incident-dialog";
import { ItemMarketplace } from "@/components/client/item-marketplace";
import { requireSubscribedCustomer } from "@/server/customer-page";
import { getItemForActor } from "@/server/services/inventory";
import { db } from "@/server/db";
import { getSetting } from "@/server/services/settings";
import { INVENTORY_STATUS, MOVEMENT_TYPE } from "@/lib/labels";
import { formatDate, formatDateTime, fullName } from "@/lib/format";

export const metadata: Metadata = { title: "Article" };

export default async function StockItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireSubscribedCustomer();
  const { id } = await params;
  const item = await getItemForActor(actor, id).catch(() => null);
  if (!item) notFound();
  const [files, movements, preparer, order, rules, shipping] = await Promise.all([
    db.file.findMany({ where: { inventoryItemId: item.id, deletedAt: null }, select: { id: true, filename: true, mimeType: true, purpose: true }, orderBy: { createdAt: "asc" } }),
    db.inventoryMovement.findMany({ where: { itemId: item.id }, orderBy: { createdAt: "desc" }, include: { actor: { select: { firstName: true, lastName: true, role: true } } } }),
    db.preparerProfile.findUniqueOrThrow({ where: { id: item.preparerId }, include: { user: { select: { firstName: true, lastName: true } } } }),
    item.supplierOrderId ? db.supplierOrder.findUnique({ where: { id: item.supplierOrderId }, select: { id: true, reference: true } }) : null,
    getSetting("storage"),
    getSetting("shipping"),
  ]);
  const productPhotos = files.filter((f) => f.purpose === "PRODUCT_PHOTO");
  const otherFiles = files.filter((f) => f.purpose !== "PRODUCT_PHOTO");
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/client/stock", label: "Mon stock" }}
        eyebrow={item.sku}
        title={item.name}
        description={item.description ?? undefined}
        actions={
          <>
            <StatusFrom map={INVENTORY_STATUS} value={item.status} />
            {item.quantityAvailable > 0 && (
              <>
                <Button asChild variant="outline">
                  <Link href={`/client/expeditions/nouvelle?article=${item.id}&retour=1`}>
                    <Undo2 /> Me le renvoyer
                    <span className="text-xs font-normal text-muted-foreground">
                      ({shipping.returnCredits} crédit{shipping.returnCredits > 1 ? "s" : ""})
                    </span>
                  </Link>
                </Button>
                <Button asChild>
                  <Link href={`/client/expeditions/nouvelle?article=${item.id}`}>
                    <Truck /> Expédier
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Reçus", item.quantityReceived],
          ["Disponibles", item.quantityAvailable],
          ["Réservés", item.quantityReserved],
          ["Expédiés", item.quantityShipped],
          ["Abîmés", item.quantityDamaged],
          ["Manquants", item.quantityMissing],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-2xl border bg-card p-4 shadow-soft">
            <p className="text-2xl font-semibold tabular">{v}</p>
            <p className="text-sm text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>
      {item.quantityAvailable > 0 && !item.dropship && item.storagePaidUntil && (
        <p
          className={
            item.storageOverdueSince
              ? "flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger"
              : "flex items-start gap-2 rounded-xl bg-muted p-4 text-sm text-muted-foreground"
          }
        >
          <Hourglass className="mt-0.5 size-4 shrink-0" />
          {item.storageOverdueSince ? (
            <span>
              Durée de stockage dépassée depuis le {formatDate(item.storageOverdueSince)} : la prolongation ({rules.extensionCredits * item.quantityAvailable} crédit
              {rules.extensionCredits * item.quantityAvailable > 1 ? "s" : ""}) sera prélevée dès que votre solde le permettra.{" "}
              <Link href="/client/credits#recharger" className="font-medium underline underline-offset-2">
                Acheter des crédits
              </Link>{" "}
              ou expédiez l&apos;article.
            </span>
          ) : (
            <span>
              Stockage inclus ou payé jusqu&apos;au <span className="font-medium text-foreground">{formatDate(item.storagePaidUntil, "d MMMM yyyy")}</span>. Ensuite,{" "}
              {rules.extensionCredits} crédit par article pour {rules.extensionDays} jours de plus, prélevé automatiquement.
            </span>
          )}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Section title="Historique des mouvements" description="Toutes les opérations sont conservées, aucune n'est effacée." contentClassName="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Date</TableHead>
                  <TableHead>Opération</TableHead>
                  <TableHead className="text-right">Variation</TableHead>
                  <TableHead className="text-right">Dispo.</TableHead>
                  <TableHead className="pr-5">Détail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="pl-5 text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(m.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{MOVEMENT_TYPE[m.type]}</TableCell>
                    <TableCell className="text-right tabular">{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</TableCell>
                    <TableCell className="text-right tabular">{m.availableAfter}</TableCell>
                    <TableCell className="max-w-xs pr-5 text-xs text-muted-foreground">
                      {m.reason}
                      {m.actor ? ` — ${m.actor.role === "CUSTOMER" ? "vous" : fullName(m.actor)}` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
        <div className="space-y-6">
          <Section title="Informations" contentClassName="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Fournisseur : </span>
              {item.supplierName ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Reçu le : </span>
              {formatDate(item.receivedAt)}
            </p>
            <p>
              <span className="text-muted-foreground">Emplacement : </span>
              {item.storageLocation ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Préparateur : </span>
              {fullName(preparer.user)}
            </p>
            {order && (
              <p>
                <span className="text-muted-foreground">Commande : </span>
                <Link href={`/client/commandes/${order.id}`} className="underline-offset-2 hover:underline">
                  {order.reference}
                </Link>
              </p>
            )}
          </Section>
          <Section
            title="Photos pour vos annonces"
            description={productPhotos.length ? "Prises par votre préparateur. Téléchargez-les pour créer votre annonce." : "Votre préparateur ajoutera ici les photos de l'article ; vous serez prévenu."}
            actions={
              productPhotos.length > 0 ? (
                <Button asChild size="sm" variant="outline">
                  <a href={`/api/stock/${item.id}/photos`} download>
                    <Download /> Tout télécharger
                  </a>
                </Button>
              ) : null
            }
          >
            {productPhotos.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {productPhotos.map((f, i) => (
                  <a key={f.id} href={`/api/files/${f.id}?telecharger`} className="group relative block overflow-hidden rounded-xl bg-muted" title={`Télécharger la photo ${i + 1}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/files/${f.id}`} alt={`Photo ${i + 1} de ${item.name}`} className="aspect-square w-full object-cover" loading="lazy" />
                    <span className="absolute right-1.5 bottom-1.5 rounded-md bg-background/85 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Download className="size-3.5" />
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Images className="size-4" /> Aucune photo pour le moment.
              </p>
            )}
          </Section>
          <ItemMarketplace customerId={item.customerId} itemId={item.id} />
          {otherFiles.length > 0 && (
            <Section title="Autres documents">
              <FileThumbs files={otherFiles} size="lg" />
            </Section>
          )}
          <ReportIncidentDialog types={["STOCK_DISCREPANCY", "INBOUND_DAMAGED", "WRONG_ITEM", "OTHER"]} context={{ inventoryItemId: item.id }} defaultTitle={`Problème sur ${item.name}`} />
        </div>
      </div>
    </div>
  );
}

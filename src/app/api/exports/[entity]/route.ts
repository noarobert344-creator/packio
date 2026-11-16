import { getActor } from "@/server/auth/current";
import { db } from "@/server/db";
import { csvResponse, euro, type Cell } from "@/server/lib/csv";
import { CREDIT_TX_TYPE, MARKETPLACE_PLATFORM, MARKETPLACE_SALE_STATUS, PARCEL_SIZE, PAYMENT_STATUS, SHIPMENT_KIND, SHIPMENT_STATUS, carrierLabel } from "@/lib/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 5000;

/**
 * Exports comptables des espaces client et préparateur (CSV, 5 000 lignes
 * maximum). Chaque export est limité aux données de l'utilisateur connecté.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/exports/[entity]">) {
  const actor = await getActor();
  if (!actor) return new Response("Non authentifié", { status: 401 });
  const { entity } = await ctx.params;
  const stamp = new Date().toISOString().slice(0, 10);

  if (actor.role === "CUSTOMER" && actor.customerId) {
    const customerId = actor.customerId;
    if (entity === "paiements") {
      const rows = await db.payment.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: MAX_ROWS });
      return csvResponse(`packio-paiements-${stamp}.csv`, ["Date", "Description", "Type", "Montant TTC (€)", "Remboursé (€)", "Statut", "Crédits", "Référence Whop"], rows.map((p): Cell[] => [
        p.createdAt,
        p.description,
        p.kind === "CREDIT_PACK" ? "Recharge de crédits" : p.kind === "SUBSCRIPTION" ? "Abonnement" : "Autre",
        euro(p.amountCents),
        euro(p.refundedCents),
        PAYMENT_STATUS[p.status].label,
        p.creditsGranted,
        p.externalId,
      ]));
    }
    if (entity === "ventes") {
      const rows = await db.marketplaceSale.findMany({
        where: { customerId, status: { not: "IGNORED" } },
        orderBy: { soldAt: "desc" },
        take: MAX_ROWS,
        include: { shipment: { select: { reference: true, status: true } }, dropshipOrder: { select: { reference: true } } },
      });
      return csvResponse(`packio-ventes-${stamp}.csv`, ["Date", "Plateforme", "Commande", "Article", "Prix (€)", "Traitement", "Expédition", "Statut de l'expédition"], rows.map((s): Cell[] => [
        s.soldAt,
        MARKETPLACE_PLATFORM[s.platform],
        s.externalOrderId,
        s.title,
        euro(s.priceCents),
        MARKETPLACE_SALE_STATUS[s.status].label,
        s.shipment?.reference ?? s.dropshipOrder?.reference,
        s.shipment ? SHIPMENT_STATUS[s.shipment.status].label : "",
      ]));
    }
    if (entity === "credits") {
      const rows = await db.creditTransaction.findMany({ where: { wallet: { customerId } }, orderBy: { createdAt: "desc" }, take: MAX_ROWS });
      return csvResponse(`packio-credits-${stamp}.csv`, ["Date", "Opération", "Description", "Motif", "Crédits", "Réservés"], rows.map((t): Cell[] => [t.createdAt, CREDIT_TX_TYPE[t.type], t.description, t.reason, t.amount, t.reservedDelta]));
    }
  }

  if (actor.role === "PREPARER" && actor.preparerId && entity === "colis") {
    const rows = await db.outboundShipment.findMany({
      where: { preparerId: actor.preparerId, droppedOffAt: { not: null } },
      orderBy: { droppedOffAt: "desc" },
      take: MAX_ROWS,
      include: { customer: { select: { referenceCode: true } } },
    });
    return csvResponse(`packio-colis-${stamp}.csv`, ["Déposé le", "Expédition", "Code client", "Type", "Taille", "Crédits", "Transporteur", "Suivi", "Statut"], rows.map((s): Cell[] => [
      s.droppedOffAt,
      s.reference,
      s.customer.referenceCode,
      SHIPMENT_KIND[s.kind].label,
      s.sizeCategory ? PARCEL_SIZE[s.sizeCategory].label : "",
      s.creditState === "CAPTURED" ? s.creditCost : 0,
      carrierLabel(s.carrier),
      s.trackingNumber,
      SHIPMENT_STATUS[s.status].label,
    ]));
  }
  return new Response("Export introuvable", { status: 404 });
}

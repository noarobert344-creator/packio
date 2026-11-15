import { getActor } from "@/server/auth/current";
import { can } from "@/server/auth/actor";
import type { Permission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { audit } from "@/server/services/audit";
import {
  ASSIGNMENT_STATE,
  CREDIT_TX_TYPE,
  CUSTOMER_STATUS,
  INVENTORY_STATUS,
  PARCEL_SIZE,
  PAYMENT_STATUS,
  PREPARER_STATUS,
  SHIPMENT_STATUS,
  SUPPLIER_ORDER_STATUS,
  carrierLabel,
} from "@/lib/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 10_000;

type Cell = string | number | boolean | Date | null | undefined;
type Export = { permission: Permission; headers: string[]; rows: () => Promise<Cell[][]> };

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");
const euro = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2).replace(".", ","));
const name = (u: { firstName: string; lastName: string } | null | undefined) => (u ? `${u.firstName} ${u.lastName}` : "");

function csvCell(v: Cell) {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "boolean" ? (v ? "oui" : "non") : String(v);
  // Neutralise les formules (injection CSV dans les tableurs).
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const EXPORTS: Record<string, Export> = {
  clients: {
    permission: "customers.read",
    headers: ["Code client", "Prénom", "Nom", "E-mail", "Téléphone", "Société", "Statut", "Attribution", "Préparateur", "Crédits mensuels", "Crédits achetés", "Crédits réservés", "Démo", "Inscrit le"],
    rows: async () =>
      (
        await db.customerProfile.findMany({
          take: MAX_ROWS,
          orderBy: { createdAt: "desc" },
          include: { user: true, wallet: true, currentPreparer: { include: { user: { select: { firstName: true, lastName: true } } } } },
        })
      ).map((c) => [
        c.referenceCode,
        c.user.firstName,
        c.user.lastName,
        c.user.email,
        c.user.phone,
        c.companyName,
        CUSTOMER_STATUS[c.status].label,
        ASSIGNMENT_STATE[c.assignmentState].label,
        name(c.currentPreparer?.user),
        c.wallet?.monthlyBalance ?? 0,
        c.wallet?.purchasedBalance ?? 0,
        c.wallet?.reservedBalance ?? 0,
        c.user.isDemo,
        iso(c.createdAt),
      ]),
  },
  preparateurs: {
    permission: "preparers.read",
    headers: ["Prénom", "Nom", "E-mail", "Téléphone", "Ville", "Pays", "Statut", "Clients actifs", "Clients max", "Capacité de stockage", "Colis traités", "Transporteurs", "Inscrit le"],
    rows: async () =>
      (
        await db.preparerProfile.findMany({
          take: MAX_ROWS,
          orderBy: { createdAt: "asc" },
          include: { user: true, _count: { select: { assignments: { where: { status: "ACTIVE" } } } } },
        })
      ).map((p) => [
        p.user.firstName,
        p.user.lastName,
        p.user.email,
        p.user.phone,
        p.city,
        p.country,
        PREPARER_STATUS[p.status].label,
        p._count.assignments,
        p.maxClients,
        p.storageCapacity,
        p.parcelsProcessed,
        p.compatibleCarriers.map(carrierLabel).join(", "),
        iso(p.joinedAt),
      ]),
  },
  commandes: {
    permission: "operations.read",
    headers: ["Référence", "Code client", "Client", "Fournisseur", "Article", "Quantité", "Statut", "Transporteur", "N° de suivi", "N° commande fournisseur", "Préparateur", "Créée le", "Dernier changement"],
    rows: async () =>
      (
        await db.supplierOrder.findMany({
          take: MAX_ROWS,
          orderBy: { createdAt: "desc" },
          include: { supplier: true, customer: { include: { user: true } }, preparer: { include: { user: true } } },
        })
      ).map((o) => [
        o.reference,
        o.customer.referenceCode,
        name(o.customer.user),
        o.supplier.code === "OTHER" ? (o.supplierLabel ?? o.supplier.name) : o.supplier.name,
        o.description,
        o.quantity,
        SUPPLIER_ORDER_STATUS[o.status].label,
        o.carrier ? carrierLabel(o.carrier) : "",
        o.trackingNumber,
        o.supplierOrderNumber,
        name(o.preparer.user),
        iso(o.createdAt),
        iso(o.statusChangedAt),
      ]),
  },
  stocks: {
    permission: "operations.read",
    headers: ["SKU", "Article", "Code client", "Client", "Préparateur", "Fournisseur", "Reçus", "Disponibles", "Réservés", "Expédiés", "Abîmés", "Manquants", "Emplacement", "Statut", "Reçu le"],
    rows: async () =>
      (
        await db.inventoryItem.findMany({
          take: MAX_ROWS,
          orderBy: { receivedAt: "desc" },
          include: { customer: { include: { user: true } }, preparer: { include: { user: true } } },
        })
      ).map((i) => [
        i.sku,
        i.name,
        i.customer.referenceCode,
        name(i.customer.user),
        name(i.preparer.user),
        i.supplierName,
        i.quantityReceived,
        i.quantityAvailable,
        i.quantityReserved,
        i.quantityShipped,
        i.quantityDamaged,
        i.quantityMissing,
        i.storageLocation,
        INVENTORY_STATUS[i.status].label,
        iso(i.receivedAt),
      ]),
  },
  expeditions: {
    permission: "operations.read",
    headers: ["Référence", "Code client", "Client", "Destinataire", "Code postal", "Ville", "Pays", "Préparateur", "Statut", "Catégorie", "Crédits", "Frais de transport (€)", "Transporteur", "N° de suivi", "Demandée le", "Déposée le", "Livrée le"],
    rows: async () =>
      (
        await db.outboundShipment.findMany({
          take: MAX_ROWS,
          orderBy: { createdAt: "desc" },
          include: { customer: { include: { user: true } }, preparer: { include: { user: true } } },
        })
      ).map((s) => [
        s.reference,
        s.customer.referenceCode,
        name(s.customer.user),
        s.recipientName,
        s.postalCode,
        s.city,
        s.country,
        name(s.preparer.user),
        SHIPMENT_STATUS[s.status].label,
        s.sizeCategory ? PARCEL_SIZE[s.sizeCategory].label : "",
        s.creditCost,
        euro(s.shippingFeeCents),
        s.carrier ? carrierLabel(s.carrier) : "",
        s.trackingNumber,
        iso(s.createdAt),
        iso(s.droppedOffAt),
        iso(s.deliveredAt),
      ]),
  },
  paiements: {
    permission: "billing.read",
    headers: ["Date", "Code client", "Client", "Type", "Description", "Montant (€)", "Remboursé (€)", "Devise", "Statut", "Prestataire", "Identifiant externe", "Crédits accordés"],
    rows: async () =>
      (await db.payment.findMany({ take: MAX_ROWS, orderBy: { createdAt: "desc" }, include: { customer: { include: { user: true } } } })).map((p) => [
        iso(p.createdAt),
        p.customer.referenceCode,
        name(p.customer.user),
        p.kind === "SUBSCRIPTION" ? "Abonnement" : p.kind === "CREDIT_PACK" ? "Recharge" : "Autre",
        p.description,
        euro(p.amountCents),
        euro(p.refundedCents),
        p.currency.toUpperCase(),
        PAYMENT_STATUS[p.status].label,
        p.provider,
        p.externalId,
        p.creditsGranted,
      ]),
  },
  credits: {
    permission: "billing.read",
    headers: ["Date", "Code client", "Client", "Opération", "Variation disponible", "Variation réservée", "Mensuels après", "Achetés après", "Réservés après", "Description", "Motif", "Auteur", "Clé d'idempotence"],
    rows: async () =>
      (
        await db.creditTransaction.findMany({
          take: MAX_ROWS,
          orderBy: { createdAt: "desc" },
          include: { wallet: { include: { customer: { include: { user: true } } } }, actor: true },
        })
      ).map((t) => [
        iso(t.createdAt),
        t.wallet.customer.referenceCode,
        name(t.wallet.customer.user),
        CREDIT_TX_TYPE[t.type],
        t.amount,
        t.reservedDelta,
        t.monthlyAfter,
        t.purchasedAfter,
        t.reservedAfter,
        t.description,
        t.reason,
        t.actor ? name(t.actor) : "Système",
        t.idempotencyKey,
      ]),
  },
  audit: {
    permission: "audit.read",
    headers: ["Date", "Auteur", "E-mail", "Rôle", "Action", "Objet", "Identifiant", "Résumé", "Métadonnées"],
    rows: async () =>
      (await db.auditLog.findMany({ take: MAX_ROWS, orderBy: { createdAt: "desc" }, include: { actor: true } })).map((l) => [
        iso(l.createdAt),
        l.actor ? name(l.actor) : "Système",
        l.actor?.email,
        l.actorRole,
        l.action,
        l.entityType,
        l.entityId,
        l.summary,
        l.metadata ? JSON.stringify(l.metadata) : "",
      ]),
  },
};

/** Export CSV (UTF-8 avec BOM, séparateur « ; ») pour tableurs francophones. */
export async function GET(_request: Request, ctx: RouteContext<"/api/admin/export/[entity]">) {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const { entity } = await ctx.params;
  const def = EXPORTS[entity];
  if (!def) return Response.json({ error: "Export inconnu" }, { status: 404 });
  if (actor.role !== "ADMIN" || !can(actor, def.permission)) return Response.json({ error: "Accès refusé" }, { status: 403 });

  const rows = await def.rows();
  const lines = [def.headers, ...rows].map((r) => r.map(csvCell).join(";"));
  const body = `﻿${lines.join("\r\n")}\r\n`;
  await audit({ actor, action: "export.csv", entityType: "export", entityId: entity, summary: `${rows.length} ligne(s)` });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="packio-${entity}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

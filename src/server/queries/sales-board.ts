import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { ShipmentStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";

/**
 * « Bordereaux » et « À vendre » : vues communes au client et à son
 * préparateur (le périmètre est toujours restreint côté serveur).
 */

type Scope = { customerId: string } | { preparerId: string };

/** Expéditions encore à déposer chez le transporteur. */
export const OPEN_SHIPMENT_STATUSES: ShipmentStatus[] = ["REQUESTED", "AWAITING_CLASSIFICATION", "CLASSIFIED", "AWAITING_CREDITS", "PREPARING", "READY", "LABEL_READY"];
const DONE_STATUSES: ShipmentStatus[] = ["DROPPED_OFF", "IN_TRANSIT", "DELIVERED"];

const productPhoto = { where: { purpose: "PRODUCT_PHOTO" as const, deletedAt: null }, orderBy: { createdAt: "asc" as const }, select: { id: true } };

/**
 * Bordereaux reçus (ventes détectées par Packio Connect, dropshipping, envois
 * du client), chacun avec ses articles. `done` : déposés depuis 30 jours.
 */
export async function listLabelBoard(scope: Scope, opts: { done?: boolean; dropship?: boolean } = {}) {
  // Ventes normales (stock, retours) et dropshipping sont toujours séparées.
  const kind: Prisma.OutboundShipmentWhereInput = opts.dropship === undefined ? {} : { kind: opts.dropship ? "DROPSHIP" : { not: "DROPSHIP" } };
  const where: Prisma.OutboundShipmentWhereInput = {
    ...scope,
    ...kind,
    files: { some: { purpose: "SHIPPING_LABEL", deletedAt: null } },
    status: { in: opts.done ? DONE_STATUSES : OPEN_SHIPMENT_STATUSES },
    ...(opts.done ? { droppedOffAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } : {}),
  };
  const [shipments, openCount] = await Promise.all([
    db.outboundShipment.findMany({
      where,
      orderBy: opts.done ? { droppedOffAt: "desc" } : [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 100,
      include: {
        customer: { select: { referenceCode: true, user: { select: { firstName: true, lastName: true } } } },
        items: { include: { inventoryItem: { select: { id: true, sku: true, name: true, storageLocation: true, files: { ...productPhoto, take: 1 } } } } },
        files: { where: { purpose: "SHIPPING_LABEL", deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, filename: true, mimeType: true, createdAt: true } },
        marketplaceSale: {
          select: {
            platform: true,
            externalOrderId: true,
            title: true,
            soldAt: true,
            size: true,
            shipBy: true,
            shipByEstimated: true,
            account: { select: { username: true, externalUserId: true } },
            _count: { select: { lines: true } },
          },
        },
        dropshipOrder: { select: { reference: true, salePlatform: true, saleReference: true, marketplaceSale: { select: { account: { select: { username: true, externalUserId: true } }, size: true } } } },
      },
    }),
    db.outboundShipment.count({ where: { ...scope, ...kind, files: { some: { purpose: "SHIPPING_LABEL", deletedAt: null } }, status: { in: OPEN_SHIPMENT_STATUSES } } }),
  ]);
  return { shipments, openCount };
}

export type LabelBoardShipment = Awaited<ReturnType<typeof listLabelBoard>>["shipments"][number];

/** Ventes du client dont le bordereau n'est pas encore arrivé. */
export async function listSalesAwaitingLabel(customerId: string) {
  return db.marketplaceSale.findMany({
    where: {
      customerId,
      status: { in: ["NEW", "MATCHED", "SHIPMENT_CREATED"] },
      files: { none: { purpose: "SHIPPING_LABEL", deletedAt: null } },
      OR: [{ shipmentId: null }, { shipment: { status: { in: OPEN_SHIPMENT_STATUSES }, files: { none: { purpose: "SHIPPING_LABEL", deletedAt: null } } } }],
    },
    orderBy: { soldAt: "desc" },
    take: 50,
    include: { inventoryItem: { select: { id: true, sku: true, name: true } }, shipment: { select: { id: true, reference: true } } },
  });
}

/**
 * Articles en stock photographiés (« À vendre ») et articles à photographier.
 * Le préparateur ne voit que les clients qui lui sont actuellement attribués.
 */
export async function listForSale(scope: Scope) {
  const base: Prisma.InventoryItemWhereInput = {
    ...scope,
    ...("preparerId" in scope ? { customer: { currentPreparerId: scope.preparerId } } : {}),
    dropship: false,
    quantityAvailable: { gt: 0 },
  };
  const include = {
    customer: { select: { referenceCode: true, user: { select: { firstName: true, lastName: true } } } },
    files: productPhoto,
    listings: { select: { id: true, platform: true, url: true, status: true, title: true } },
  } satisfies Prisma.InventoryItemInclude;
  const [ready, toShoot] = await Promise.all([
    db.inventoryItem.findMany({
      where: { ...base, files: { some: { purpose: "PRODUCT_PHOTO", deletedAt: null } } },
      orderBy: [{ photosUpdatedAt: { sort: "desc", nulls: "last" } }, { receivedAt: "desc" }],
      take: 120,
      include,
    }),
    db.inventoryItem.findMany({
      where: { ...base, files: { none: { purpose: "PRODUCT_PHOTO", deletedAt: null } } },
      orderBy: { receivedAt: "asc" },
      take: 120,
      include,
    }),
  ]);
  return { ready, toShoot };
}

export type ForSaleItem = Awaited<ReturnType<typeof listForSale>>["ready"][number];

/**
 * Dropshipping côté préparateur : commandes à réceptionner (article pas encore
 * reçu), avec l'état du bordereau de la vente déjà transmis ou attendu.
 */
export async function listDropshipIncoming(preparerId: string) {
  return db.supplierOrder.findMany({
    where: { preparerId, mode: "DROPSHIP", status: { notIn: ["IN_STOCK", "CANCELLED", "RETURNED_TO_SUPPLIER"] } },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: {
      customer: { select: { referenceCode: true, user: { select: { firstName: true, lastName: true } } } },
      supplier: { select: { name: true } },
      location: { select: { label: true } },
      files: { where: { purpose: "SHIPPING_LABEL", deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, filename: true } },
    },
  });
}

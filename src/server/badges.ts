import "server-only";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/actor";
import { db } from "@/server/db";
import { totalUnreadMessages } from "@/server/services/messaging";

/** Compteurs affichés dans la navigation de chaque espace. */
export async function navBadges(actor: Actor): Promise<Record<string, number>> {
  if (actor.role === "CUSTOMER") {
    return { messages: await totalUnreadMessages(actor) };
  }
  if (actor.role === "PREPARER") {
    const preparerId = actor.preparerId!;
    const toShip = ["AWAITING_CLASSIFICATION", "CLASSIFIED", "PREPARING", "READY", "LABEL_READY"] as const;
    const withLabel = { files: { some: { purpose: "SHIPPING_LABEL" as const, deletedAt: null } } };
    const [messages, receptions, expeditions, bordereaux, dropshipColis, dropship, photos] = await Promise.all([
      totalUnreadMessages(actor),
      db.supplierOrder.count({ where: { preparerId, status: { in: ["AT_LOCKER", "PICKED_UP", "RECEIVED", "QUALITY_CHECK"] } } }),
      // Envois depuis le stock et dropshipping sont comptés séparément.
      db.outboundShipment.count({ where: { preparerId, kind: { not: "DROPSHIP" }, status: { in: [...toShip] } } }),
      db.outboundShipment.count({ where: { preparerId, kind: { not: "DROPSHIP" }, status: { in: [...toShip] }, ...withLabel } }),
      db.outboundShipment.count({ where: { preparerId, kind: "DROPSHIP", status: { in: [...toShip] } } }),
      db.outboundShipment.count({ where: { preparerId, kind: "DROPSHIP", status: { in: [...toShip] }, ...withLabel } }),
      // Articles en stock à photographier pour la partie « À vendre ».
      db.inventoryItem.count({
        where: { preparerId, dropship: false, quantityAvailable: { gt: 0 }, customer: { currentPreparerId: preparerId }, files: { none: { purpose: "PRODUCT_PHOTO", deletedAt: null } } },
      }),
    ]);
    return { messages, receptions, expeditions, bordereaux, dropship, dropshipColis, photos };
  }
  const [attributions, incidents, support] = await Promise.all([
    can(actor, "assignments.manage") ? db.customerProfile.count({ where: { assignmentState: { in: ["PENDING", "LATE", "REASSIGNING"] } } }) : 0,
    can(actor, "incidents.manage") ? db.incident.count({ where: { status: "OPEN" } }) : 0,
    can(actor, "support.manage") ? db.conversation.count({ where: { type: "SUPPORT", status: "OPEN" } }) : 0,
  ]);
  return { attributions, incidents, support };
}

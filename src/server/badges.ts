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
    const [messages, receptions, expeditions] = await Promise.all([
      totalUnreadMessages(actor),
      db.supplierOrder.count({ where: { preparerId, status: { in: ["AT_LOCKER", "PICKED_UP", "RECEIVED", "QUALITY_CHECK"] } } }),
      db.outboundShipment.count({ where: { preparerId, status: { in: ["AWAITING_CLASSIFICATION", "CLASSIFIED", "PREPARING", "READY", "LABEL_READY"] } } }),
    ]);
    return { messages, receptions, expeditions };
  }
  const [attributions, incidents, support] = await Promise.all([
    can(actor, "assignments.manage") ? db.customerProfile.count({ where: { assignmentState: { in: ["PENDING", "LATE", "REASSIGNING"] } } }) : 0,
    can(actor, "incidents.manage") ? db.incident.count({ where: { status: "OPEN" } }) : 0,
    can(actor, "support.manage") ? db.conversation.count({ where: { type: "SUPPORT", status: "OPEN" } }) : 0,
  ]);
  return { attributions, incidents, support };
}

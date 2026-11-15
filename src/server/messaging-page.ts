import "server-only";
import type { Actor } from "@/server/auth/actor";
import { db } from "@/server/db";
import { getConversationAccess, getMessages, getReadReceipts, listConversations, markConversationRead } from "@/server/services/messaging";
import { initials } from "@/lib/format";
import type { ConversationSummary, SelectedConversation } from "@/components/messaging/types";

/** Prépare les données sérialisables de la messagerie pour un espace donné. */
export async function loadMessagingData(actor: Actor, conversationId?: string) {
  const conversations = await listConversations(actor);
  const summaries: ConversationSummary[] = conversations.map((c) => {
    let title: string;
    let subtitle: string;
    let who: { firstName: string; lastName: string } | undefined;
    if (c.type === "SUPPORT") {
      if (actor.role === "ADMIN") {
        const requester = c.participants.find((p) => p.user.role !== "ADMIN")?.user;
        who = requester;
        title = requester ? `${requester.firstName} ${requester.lastName}` : "Demande de support";
        subtitle = c.subject ?? "Support";
      } else {
        title = "Support Packio";
        subtitle = c.subject ?? "Demande de support";
      }
    } else if (actor.role === "CUSTOMER") {
      who = c.preparer?.user;
      title = who ? `${who.firstName} ${who.lastName}` : "Mon préparateur";
      subtitle = c.status === "ARCHIVED" ? "Ancien préparateur — historique" : "Votre préparateur attitré";
    } else {
      who = c.customer?.user;
      title = who ? `${who.firstName} ${who.lastName}` : "Client";
      subtitle = c.customer?.referenceCode ?? "Client";
    }
    const last = c.messages[0];
    return {
      id: c.id,
      type: c.type,
      status: c.status,
      title,
      subtitle,
      initials: c.type === "SUPPORT" && actor.role !== "ADMIN" ? "PK" : initials(who?.firstName, who?.lastName),
      lastMessageAt: c.lastMessageAt.toISOString(),
      preview: last ? (last.kind === "SYSTEM" ? last.body : last.body || "Pièce jointe") : null,
      unread: c.unread,
    };
  });

  let selected: SelectedConversation | null = null;
  const targetId = conversationId && (summaries.some((s) => s.id === conversationId) || actor.role === "ADMIN") ? conversationId : undefined;
  if (targetId) {
    const access = await getConversationAccess(actor, targetId).catch(() => null);
    if (access) {
      const [messages, readAt] = await Promise.all([getMessages(actor, targetId), getReadReceipts(targetId, actor.userId)]);
      if (access.mode !== "supervision") await markConversationRead(actor, targetId);
      const summary = summaries.find((s) => s.id === targetId);
      let linkables: SelectedConversation["linkables"] = { orders: [], shipments: [] };
      if (access.conversation.customerId && access.conversation.type === "CUSTOMER_PREPARER") {
        const [orders, shipments] = await Promise.all([
          db.supplierOrder.findMany({ where: { customerId: access.conversation.customerId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, reference: true, description: true } }),
          db.outboundShipment.findMany({ where: { customerId: access.conversation.customerId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, reference: true, recipientName: true } }),
        ]);
        linkables = {
          orders: orders.map((o) => ({ id: o.id, label: `${o.reference} — ${o.description.slice(0, 40)}` })),
          shipments: shipments.map((s) => ({ id: s.id, label: `${s.reference} — ${s.recipientName}` })),
        };
      }
      let title = summary?.title ?? "Conversation";
      let subtitle = summary?.subtitle ?? "";
      if (!summary && access.mode === "supervision") {
        const conv = await db.conversation.findUniqueOrThrow({
          where: { id: targetId },
          include: { customer: { include: { user: true } }, preparer: { include: { user: true } } },
        });
        title = `${conv.customer?.user.firstName ?? ""} ${conv.customer?.user.lastName ?? ""} ↔ ${conv.preparer?.user.firstName ?? ""} ${conv.preparer?.user.lastName ?? ""}`;
        subtitle = "Supervision encadrée — lecture seule";
      }
      selected = {
        id: targetId,
        type: access.conversation.type,
        status: access.conversation.status,
        title,
        subtitle,
        canWrite: access.canWrite,
        mode: access.mode,
        readAt: readAt?.toISOString() ?? null,
        linkables,
        messages: messages.map((m) => ({
          id: m.id,
          kind: m.kind,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
          sender: m.sender ? { id: m.sender.id, name: `${m.sender.firstName} ${m.sender.lastName}`, role: m.sender.role } : null,
          attachments: m.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType })),
          supplierOrder: m.supplierOrder ? { id: m.supplierOrder.id, reference: m.supplierOrder.reference } : null,
          shipment: m.shipment ? { id: m.shipment.id, reference: m.shipment.reference } : null,
        })),
      };
    }
  }
  return { conversations: summaries, selected };
}

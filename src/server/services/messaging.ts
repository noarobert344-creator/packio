import { addMinutes } from "date-fns";
import type { Conversation } from "@/generated/prisma/client";
import { db, type Tx } from "@/server/db";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { assertAdmin, can, type Actor } from "@/server/auth/actor";
import { audit } from "./audit";
import { getSetting } from "./settings";
import { withEffects } from "./notifications";

/**
 * MESSAGERIE
 * - Conversation privée client ↔ préparateur créée à l'attribution.
 * - Conversations de support distinctes (client ou préparateur ↔ Packio).
 * - Supervision administrateur encadrée : motif obligatoire, durée limitée,
 *   journalisée et signalée aux participants par un message système.
 */

export async function ensurePairConversation(tx: Tx, customerId: string, preparerId: string) {
  const customer = await tx.customerProfile.findUniqueOrThrow({ where: { id: customerId }, select: { userId: true } });
  const preparer = await tx.preparerProfile.findUniqueOrThrow({ where: { id: preparerId }, select: { userId: true } });
  let conversation = await tx.conversation.findFirst({ where: { type: "CUSTOMER_PREPARER", customerId, preparerId } });
  if (!conversation) {
    conversation = await tx.conversation.create({
      data: {
        type: "CUSTOMER_PREPARER",
        customerId,
        preparerId,
        // Administrateur client de son propre espace préparateur : un seul participant.
        participants: { create: [...new Set([customer.userId, preparer.userId])].map((userId) => ({ userId })) },
        messages: {
          create: {
            kind: "SYSTEM",
            body: "Conversation ouverte entre vous et votre préparateur attitré. Les échanges sont privés et conservés pour le suivi de vos commandes.",
          },
        },
      },
    });
  } else {
    conversation = await tx.conversation.update({ where: { id: conversation.id }, data: { status: "OPEN" } });
    for (const userId of new Set([customer.userId, preparer.userId])) {
      await tx.conversationParticipant.upsert({
        where: { conversationId_userId: { conversationId: conversation.id, userId } },
        create: { conversationId: conversation.id, userId },
        update: { leftAt: null },
      });
    }
    await tx.message.create({ data: { conversationId: conversation.id, kind: "SYSTEM", body: "Conversation réactivée suite à une nouvelle attribution." } });
  }
  return conversation;
}

/** À la réattribution : l'ancien préparateur perd l'accès, le client garde l'historique. */
export async function archivePairConversation(tx: Tx, customerId: string, preparerId: string) {
  const conversation = await tx.conversation.findFirst({ where: { type: "CUSTOMER_PREPARER", customerId, preparerId } });
  if (!conversation) return;
  const preparer = await tx.preparerProfile.findUniqueOrThrow({ where: { id: preparerId }, select: { userId: true } });
  await tx.conversation.update({ where: { id: conversation.id }, data: { status: "ARCHIVED" } });
  await tx.conversationParticipant.updateMany({
    where: { conversationId: conversation.id, userId: preparer.userId },
    data: { leftAt: new Date() },
  });
  await tx.message.create({
    data: { conversationId: conversation.id, kind: "SYSTEM", body: "Conversation archivée : un nouveau préparateur vous a été attribué." },
  });
}

type Access = { conversation: Conversation; mode: "participant" | "support" | "supervision"; canWrite: boolean };

export async function getConversationAccess(actor: Actor, conversationId: string): Promise<Access> {
  const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new NotFoundError("Conversation introuvable.");
  const participant = await db.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId: actor.userId } },
  });
  if (participant && !participant.leftAt) {
    return { conversation, mode: "participant", canWrite: conversation.status === "OPEN" };
  }
  if (participant?.leftAt && actor.role === "CUSTOMER") {
    return { conversation, mode: "participant", canWrite: false };
  }
  if (actor.role === "ADMIN") {
    if (conversation.type === "SUPPORT" && can(actor, "support.manage")) {
      return { conversation, mode: "support", canWrite: conversation.status === "OPEN" };
    }
    if (conversation.type === "CUSTOMER_PREPARER") {
      const grant = await db.conversationAccessGrant.findFirst({
        where: { conversationId, adminId: actor.userId, expiresAt: { gt: new Date() } },
      });
      if (grant) return { conversation, mode: "supervision", canWrite: false };
    }
  }
  // Le client garde l'accès en lecture à l'historique d'une conversation archivée.
  if (actor.role === "CUSTOMER" && conversation.customerId === actor.customerId) {
    return { conversation, mode: "participant", canWrite: false };
  }
  throw new ForbiddenError("Vous n'avez pas accès à cette conversation.");
}

export async function listConversations(actor: Actor) {
  const where =
    actor.role === "ADMIN"
      ? can(actor, "support.manage")
        ? { type: "SUPPORT" as const }
        : { id: "__none__" }
      : actor.role === "CUSTOMER"
        ? { OR: [{ customerId: actor.customerId ?? "__none__" }, { participants: { some: { userId: actor.userId } } }] }
        : { participants: { some: { userId: actor.userId, leftAt: null } } };

  const conversations = await db.conversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    include: {
      customer: { include: { user: { select: { firstName: true, lastName: true, avatarFileId: true } } } },
      preparer: { include: { user: { select: { firstName: true, lastName: true, avatarFileId: true } } } },
      participants: { include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const myParticipations = await db.conversationParticipant.findMany({
    where: { userId: actor.userId, conversationId: { in: conversations.map((c) => c.id) } },
  });
  const unread = await Promise.all(
    conversations.map(async (c) => {
      const p = myParticipations.find((x) => x.conversationId === c.id);
      if (actor.role === "ADMIN" && c.type === "SUPPORT" && !p) {
        // Support : non lu tant qu'aucun admin n'a répondu après le dernier message client.
        const last = c.messages[0];
        return last && last.senderId && !c.participants.some((x) => x.user.role === "ADMIN" && x.lastReadAt && x.lastReadAt >= last.createdAt) ? 1 : 0;
      }
      return db.message.count({
        where: {
          conversationId: c.id,
          senderId: { not: actor.userId },
          kind: "TEXT",
          ...(p?.lastReadAt ? { createdAt: { gt: p.lastReadAt } } : {}),
        },
      });
    }),
  );
  return conversations.map((c, i) => ({ ...c, unread: unread[i] }));
}

export async function getMessages(actor: Actor, conversationId: string, opts?: { after?: Date; take?: number }) {
  await getConversationAccess(actor, conversationId);
  const messages = await db.message.findMany({
    where: { conversationId, ...(opts?.after ? { createdAt: { gt: opts.after } } : {}) },
    orderBy: { createdAt: opts?.after ? "asc" : "desc" },
    take: opts?.take ?? 200,
    include: {
      sender: { select: { id: true, firstName: true, lastName: true, role: true } },
      attachments: { where: { deletedAt: null }, select: { id: true, filename: true, mimeType: true, sizeBytes: true } },
      supplierOrder: { select: { id: true, reference: true, description: true } },
      shipment: { select: { id: true, reference: true } },
    },
  });
  return opts?.after ? messages : messages.reverse();
}

/** Date de lecture des autres participants (pour l'indicateur « Lu »). */
export async function getReadReceipts(conversationId: string, exceptUserId: string) {
  const parts = await db.conversationParticipant.findMany({
    where: { conversationId, userId: { not: exceptUserId } },
    select: { lastReadAt: true, user: { select: { role: true } } },
  });
  const dates = parts.map((p) => p.lastReadAt).filter((d): d is Date => !!d);
  return dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
}

export async function markConversationRead(actor: Actor, conversationId: string) {
  const access = await getConversationAccess(actor, conversationId);
  if (access.mode === "supervision") return;
  await db.conversationParticipant.upsert({
    where: { conversationId_userId: { conversationId, userId: actor.userId } },
    create: { conversationId, userId: actor.userId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
}

export async function sendMessage(
  actor: Actor,
  input: { conversationId: string; body: string; attachmentIds?: string[]; supplierOrderId?: string | null; shipmentId?: string | null },
) {
  const body = input.body.trim();
  const attachmentIds = [...new Set(input.attachmentIds ?? [])].slice(0, 6);
  if (!body && attachmentIds.length === 0) throw new DomainError("EMPTY", "Le message est vide.");
  if (body.length > 5000) throw new DomainError("TOO_LONG", "Le message est trop long (5 000 caractères maximum).");
  const access = await getConversationAccess(actor, input.conversationId);
  if (!access.canWrite) throw new ForbiddenError("Cette conversation est en lecture seule.");
  const { conversation } = access;

  if (input.supplierOrderId) {
    const order = await db.supplierOrder.findUnique({ where: { id: input.supplierOrderId }, select: { customerId: true } });
    if (!order || order.customerId !== conversation.customerId) throw new DomainError("INVALID_LINK", "Commande invalide pour cette conversation.");
  }
  if (input.shipmentId) {
    const shipment = await db.outboundShipment.findUnique({ where: { id: input.shipmentId }, select: { customerId: true } });
    if (!shipment || shipment.customerId !== conversation.customerId) throw new DomainError("INVALID_LINK", "Expédition invalide pour cette conversation.");
  }
  let attachmentLabel = "Pièce jointe";
  if (attachmentIds.length) {
    const files = await db.file.findMany({ where: { id: { in: attachmentIds } } });
    const valid = files.filter((f) => f.uploadedById === actor.userId && f.purpose === "MESSAGE_ATTACHMENT" && !f.messageId && !f.deletedAt);
    if (valid.length !== attachmentIds.length) throw new DomainError("INVALID_ATTACHMENT", "Pièce jointe invalide.");
    const types = valid.map((f) => f.mimeType);
    attachmentLabel = types.some((t) => t.startsWith("audio/"))
      ? "Note vocale"
      : types.some((t) => t.startsWith("video/"))
        ? "Vidéo"
        : types.every((t) => t.startsWith("image/"))
          ? "Photo"
          : "Pièce jointe";
  }

  return withEffects(async (tx, fx) => {
    const message = await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderId: actor.userId,
        body,
        supplierOrderId: input.supplierOrderId || null,
        shipmentId: input.shipmentId || null,
      },
    });
    if (attachmentIds.length) {
      await tx.file.updateMany({
        where: { id: { in: attachmentIds }, uploadedById: actor.userId, messageId: null },
        data: { messageId: message.id, conversationId: conversation.id, customerId: conversation.customerId },
      });
    }
    await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: message.createdAt } });
    await tx.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId: conversation.id, userId: actor.userId } },
      create: { conversationId: conversation.id, userId: actor.userId, lastReadAt: message.createdAt },
      update: { lastReadAt: message.createdAt },
    });

    const recipients = await tx.conversationParticipant.findMany({
      where: { conversationId: conversation.id, userId: { not: actor.userId }, leftAt: null },
      include: { user: { select: { id: true, role: true } } },
    });
    const preview = body ? (body.length > 140 ? `${body.slice(0, 140)}…` : body) : attachmentLabel;
    const senderName = `${actor.firstName} ${actor.lastName.charAt(0)}.`;
    // Le préparateur de la conversation peut être un administrateur (mode préparateur).
    const preparerUserId = conversation.preparerId
      ? (await tx.preparerProfile.findUnique({ where: { id: conversation.preparerId }, select: { userId: true } }))?.userId
      : null;
    for (const r of recipients) {
      const isPreparer = r.userId === preparerUserId || r.user.role === "PREPARER";
      if (r.user.role === "ADMIN" && !isPreparer) continue;
      const base = isPreparer ? "/preparateur/messages" : "/client/messages";
      fx.notify(r.userId, {
        type: "NEW_MESSAGE",
        title: `Nouveau message de ${actor.role === "ADMIN" ? "l'équipe Packio" : senderName}`,
        body: preview,
        link: `${base}?c=${conversation.id}`,
        dedupeKey: `conversation:${conversation.id}`,
      });
    }
    if (conversation.type === "SUPPORT" && actor.role !== "ADMIN") {
      fx.notifyAdmins(
        {
          type: "NEW_MESSAGE",
          title: `Support : message de ${senderName}`,
          body: preview,
          link: `/admin/support?c=${conversation.id}`,
          dedupeKey: `conversation:${conversation.id}`,
        },
        "support.manage",
      );
    }
    return message;
  });
}

export async function createSupportConversation(actor: Actor, input: { subject: string; body: string }) {
  if (actor.role === "ADMIN") throw new DomainError("INVALID", "Les administrateurs répondent depuis le back-office.");
  const subject = input.subject.trim();
  if (subject.length < 3) throw new DomainError("SUBJECT", "Indiquez un objet.", { fieldErrors: { subject: "Objet requis" } });
  const conversation = await db.conversation.create({
    data: {
      type: "SUPPORT",
      subject: subject.slice(0, 140),
      customerId: actor.customerId,
      preparerId: actor.preparerId,
      participants: { create: { userId: actor.userId, lastReadAt: new Date() } },
    },
  });
  await sendMessage(actor, { conversationId: conversation.id, body: input.body });
  return conversation;
}

export async function setSupportConversationStatus(actor: Actor, conversationId: string, status: "OPEN" | "CLOSED") {
  assertAdmin(actor, "support.manage");
  const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.type !== "SUPPORT") throw new NotFoundError("Conversation introuvable.");
  await db.$transaction([
    db.conversation.update({ where: { id: conversationId }, data: { status } }),
    db.message.create({
      data: { conversationId, kind: "SYSTEM", body: status === "CLOSED" ? "Demande clôturée par l'équipe Packio." : "Demande rouverte par l'équipe Packio." },
    }),
  ]);
}

/** Accès de supervision encadré à une conversation client / préparateur. */
export async function requestSupervisionAccess(actor: Actor, input: { conversationId: string; reason: string }) {
  assertAdmin(actor, "conversations.supervise");
  const reason = input.reason.trim();
  if (reason.length < 10) {
    throw new DomainError("REASON_REQUIRED", "Le motif de supervision doit être précis (10 caractères minimum).", {
      fieldErrors: { reason: "Motif obligatoire" },
    });
  }
  const conversation = await db.conversation.findUnique({ where: { id: input.conversationId } });
  if (!conversation || conversation.type !== "CUSTOMER_PREPARER") throw new NotFoundError("Conversation introuvable.");
  const { supervisionMinutes } = await getSetting("messaging");
  return withEffects(async (tx) => {
    const grant = await tx.conversationAccessGrant.create({
      data: { conversationId: conversation.id, adminId: actor.userId, reason, expiresAt: addMinutes(new Date(), supervisionMinutes) },
    });
    await tx.message.create({
      data: {
        conversationId: conversation.id,
        kind: "SYSTEM",
        body: "Un membre de l'équipe Packio consulte cette conversation dans le cadre du support, conformément à la politique de confidentialité.",
      },
    });
    await audit(
      { actor, action: "conversation.supervision_access", entityType: "conversation", entityId: conversation.id, summary: reason, metadata: { expiresAt: grant.expiresAt.toISOString() } },
      tx,
    );
    return grant;
  });
}

/** Liste des conversations client/préparateur (métadonnées uniquement, sans contenu). */
export async function listPairConversationsForAdmin(actor: Actor) {
  assertAdmin(actor, "conversations.supervise");
  const conversations = await db.conversation.findMany({
    where: { type: "CUSTOMER_PREPARER" },
    orderBy: { lastMessageAt: "desc" },
    take: 200,
    include: {
      customer: { include: { user: { select: { firstName: true, lastName: true } } } },
      preparer: { include: { user: { select: { firstName: true, lastName: true } } } },
      _count: { select: { messages: true } },
      accessGrants: { where: { adminId: actor.userId, expiresAt: { gt: new Date() } }, take: 1 },
    },
  });
  return conversations;
}

/** Recherche plein texte dans les conversations accessibles. */
export async function searchMessages(actor: Actor, query: string) {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const conversations = await listConversations(actor);
  const ids = conversations.map((c) => c.id);
  if (!ids.length) return [];
  return db.message.findMany({
    where: { conversationId: { in: ids }, kind: "TEXT", body: { contains: q, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { sender: { select: { firstName: true, lastName: true } }, conversation: { select: { id: true, type: true, subject: true } } },
  });
}

export async function totalUnreadMessages(actor: Actor) {
  if (actor.role === "ADMIN") return 0;
  const parts = await db.conversationParticipant.findMany({ where: { userId: actor.userId, leftAt: null } });
  let total = 0;
  for (const p of parts) {
    total += await db.message.count({
      where: { conversationId: p.conversationId, senderId: { not: actor.userId }, kind: "TEXT", ...(p.lastReadAt ? { createdAt: { gt: p.lastReadAt } } : {}) },
    });
  }
  return total;
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-types";
import { requiredText } from "@/lib/forms";
import { formToObject, runAction, toActionError } from "@/server/action";
import { getActor } from "@/server/auth/current";
import {
  markConversationRead,
  requestSupervisionAccess,
  searchMessages,
  sendMessage,
  setSupportConversationStatus,
} from "@/server/services/messaging";

export async function sendMessageAction(input: {
  conversationId: string;
  body: string;
  attachmentIds?: string[];
  supplierOrderId?: string | null;
  shipmentId?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const actor = await getActor();
    if (!actor) return { ok: false, error: "Session expirée." };
    const message = await sendMessage(actor, input);
    return { ok: true, id: message.id };
  } catch (err) {
    return toActionError(err);
  }
}

export async function markConversationReadAction(conversationId: string) {
  const actor = await getActor();
  if (!actor) return;
  await markConversationRead(actor, conversationId).catch(() => undefined);
}

export async function searchMessagesAction(query: string) {
  const actor = await getActor();
  if (!actor) return [];
  const rows = await searchMessages(actor, query);
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
    sender: r.sender ? `${r.sender.firstName} ${r.sender.lastName}` : "Packio",
    subject: r.conversation.subject,
  }));
}

export async function setSupportStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ conversationId: z.string(), status: z.enum(["OPEN", "CLOSED"]) }), formToObject(formData), async (actor, data) => {
    await setSupportConversationStatus(actor, data.conversationId, data.status);
    revalidatePath("/admin/support");
    return { ok: true, message: data.status === "CLOSED" ? "Demande clôturée." : "Demande rouverte." };
  });
}

export async function requestSupervisionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({ conversationId: z.string(), reason: requiredText("Motif", 10, 500) }), formToObject(formData), async (actor, data) => {
    await requestSupervisionAccess(actor, data);
    return { ok: true, message: "Accès de supervision accordé pour une durée limitée.", redirectTo: `/admin/support?c=${data.conversationId}` };
  });
}

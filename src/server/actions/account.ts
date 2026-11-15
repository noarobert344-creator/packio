"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-types";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/notification-types";
import { optionalText, phoneField, requiredText } from "@/lib/forms";
import { formToObject, runAction } from "@/server/action";
import { getSession } from "@/server/auth/current";
import { db } from "@/server/db";
import { changePassword } from "@/server/services/auth";
import { markNotificationsRead, savePreferences } from "@/server/services/notifications";
import { createSupportConversation } from "@/server/services/messaging";
import { audit } from "@/server/services/audit";

const profileSchema = z.object({
  firstName: requiredText("Prénom", 1, 60),
  lastName: requiredText("Nom", 1, 60),
  phone: phoneField(),
  companyName: optionalText(120),
});

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(profileSchema, formToObject(formData), async (actor, data) => {
    await db.user.update({ where: { id: actor.userId }, data: { firstName: data.firstName, lastName: data.lastName, phone: data.phone ?? null } });
    if (actor.customerId) await db.customerProfile.update({ where: { id: actor.customerId }, data: { companyName: data.companyName ?? null } });
    await audit({ actor, action: "account.profile_updated", entityType: "user", entityId: actor.userId });
    revalidatePath("/", "layout");
    return { ok: true, message: "Profil mis à jour." };
  });
}

const passwordSchema = z
  .object({ currentPassword: z.string().min(1, { error: "Requis" }), newPassword: z.string().max(200), confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { error: "Les mots de passe ne correspondent pas", path: ["confirm"] });

export async function changePasswordAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(passwordSchema, formToObject(formData), async (actor, data) => {
    const session = await getSession();
    await changePassword(actor.userId, data.currentPassword, data.newPassword, session?.sessionId);
    return { ok: true, message: "Mot de passe modifié. Vos autres sessions ont été déconnectées." };
  });
}

export async function savePreferencesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(z.object({}).passthrough(), formToObject(formData), async (actor) => {
    const types = Object.keys(NOTIFICATION_TYPES) as NotificationType[];
    const prefs = types
      .filter((t) => formData.has(`present:${t}`))
      .map((t) => ({ type: t, inApp: formData.get(`inApp:${t}`) === "on", email: formData.get(`email:${t}`) === "on" }));
    await savePreferences(actor.userId, prefs);
    return { ok: true, message: "Préférences enregistrées." };
  });
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const session = await getSession();
  if (!session) return;
  await markNotificationsRead(session.actor.userId);
  revalidatePath("/", "layout");
}

export async function markNotificationReadAction(id: string): Promise<void> {
  const session = await getSession();
  if (!session) return;
  await markNotificationsRead(session.actor.userId, [id]);
}

const supportSchema = z.object({ subject: requiredText("Objet", 3, 140), body: requiredText("Message", 5, 5000) });

export async function createSupportRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(supportSchema, formToObject(formData), async (actor, data) => {
    const conversation = await createSupportConversation(actor, data);
    const base = actor.role === "PREPARER" ? "/preparateur/messages" : "/client/messages";
    return { ok: true, message: "Votre demande a été transmise à l'équipe Packio.", redirectTo: `${base}?c=${conversation.id}` };
  });
}

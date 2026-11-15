import "server-only";
import type { Actor } from "@/server/auth/actor";
import { db } from "@/server/db";
import { NOTIFICATION_TYPES, notificationTypesFor } from "@/lib/notification-types";

export async function loadNotificationPreferenceRows(actor: Actor) {
  const prefs = await db.notificationPreference.findMany({ where: { userId: actor.userId } });
  return notificationTypesFor(actor.role).map((type) => {
    const def = NOTIFICATION_TYPES[type];
    const pref = prefs.find((p) => p.type === type);
    const locked = "locked" in def && !!def.locked;
    return { type, label: def.label, locked, emailAvailable: def.email, inApp: locked ? true : (pref?.inApp ?? true), email: locked ? def.email : (pref?.email ?? def.email) };
  });
}

export async function loadProfile(actor: Actor) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId }, include: { customerProfile: { select: { companyName: true } } } });
  return { firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone, avatarFileId: user.avatarFileId, companyName: user.customerProfile?.companyName ?? null };
}

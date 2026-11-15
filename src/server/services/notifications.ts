import type { Prisma } from "@/generated/prisma/client";
import { NOTIFICATION_TYPES, type NotificationType } from "@/lib/notification-types";
import { db, transaction, type Tx } from "@/server/db";
import { env } from "@/server/env";
import { hasPermission, type Permission } from "@/server/auth/permissions";
import { sendEmail } from "./email";
import { getSetting } from "./settings";

export type NotificationPayload = {
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  data?: Prisma.InputJsonValue;
  /** Force l'envoi d'un e-mail même si l'utilisateur l'a désactivé (sécurité). */
  forceEmail?: boolean;
  /** Clé de regroupement : pas de nouvelle notification si une non lue existe déjà. */
  dedupeKey?: string;
};

type Pending =
  | { kind: "user"; userId: string; payload: NotificationPayload }
  | { kind: "admins"; permission?: Permission; payload: NotificationPayload };

/**
 * Effets de bord différés après validation de la transaction (notifications,
 * e-mails, tâches de suivi). Une transaction annulée n'émet donc rien.
 */
export class Effects {
  private pending: Pending[] = [];
  private tasks: (() => Promise<unknown>)[] = [];

  notify(userId: string | null | undefined, payload: NotificationPayload) {
    if (userId) this.pending.push({ kind: "user", userId, payload });
  }

  notifyAdmins(payload: NotificationPayload, permission?: Permission) {
    this.pending.push({ kind: "admins", permission, payload });
  }

  after(task: () => Promise<unknown>) {
    this.tasks.push(task);
  }

  async flush() {
    const pending = this.pending;
    const tasks = this.tasks;
    this.pending = [];
    this.tasks = [];
    for (const p of pending) {
      try {
        if (p.kind === "user") await deliver(p.userId, p.payload);
        else await deliverToAdmins(p.payload, p.permission);
      } catch (err) {
        console.error("[notifications] échec de livraison", err);
      }
    }
    for (const task of tasks) {
      try {
        await task();
      } catch (err) {
        console.error("[effects] tâche différée en échec", err);
      }
    }
  }
}

/** Transaction + effets différés (exécutés uniquement après COMMIT). */
export async function withEffects<T>(fn: (tx: Tx, fx: Effects) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
  const fx = new Effects();
  const result = await transaction((tx) => fn(tx, fx), opts);
  await fx.flush();
  return result;
}

async function deliver(userId: string, payload: NotificationPayload) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, status: true, notificationPreferences: { where: { type: payload.type } } },
  });
  if (!user || user.status === "DEACTIVATED") return;
  const def = NOTIFICATION_TYPES[payload.type];
  const pref = user.notificationPreferences[0];
  const locked = "locked" in def && def.locked;
  const wantsInApp = locked ? true : (pref?.inApp ?? true);
  const wantsEmail = payload.forceEmail || locked ? def.email || !!payload.forceEmail : (pref?.email ?? def.email);

  if (payload.dedupeKey) {
    const existing = await db.notification.findFirst({
      where: { userId, readAt: null, type: payload.type, data: { path: ["dedupeKey"], equals: payload.dedupeKey } },
      select: { id: true },
    });
    if (existing) return;
  }

  const data = (payload.dedupeKey
    ? { ...((payload.data as object | undefined) ?? {}), dedupeKey: payload.dedupeKey }
    : payload.data) as Prisma.InputJsonValue | undefined;

  if (wantsInApp) {
    await db.notification.create({
      data: { userId, type: payload.type, title: payload.title, body: payload.body, link: payload.link, data, emailedAt: wantsEmail ? new Date() : null },
    });
  }
  if (wantsEmail) {
    await sendEmail({
      to: user.email,
      subject: `${payload.title} — Packio`,
      template: payload.type,
      title: payload.title,
      paragraphs: [`Bonjour ${user.firstName},`, payload.body],
      cta: payload.link ? { label: "Ouvrir Packio", url: `${env.appUrl}${payload.link}` } : undefined,
      userId,
    });
  }
}

async function deliverToAdmins(payload: NotificationPayload, permission?: Permission) {
  const admins = await db.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true, staffRole: { select: { permissions: true } } },
  });
  for (const admin of admins) {
    if (permission && !hasPermission(admin.staffRole?.permissions ?? [], permission)) continue;
    await deliver(admin.id, payload);
  }
  const extra = await getSetting("notifications");
  for (const email of extra.adminEmails) {
    await sendEmail({
      to: email,
      subject: `[Packio Admin] ${payload.title}`,
      template: payload.type,
      title: payload.title,
      paragraphs: [payload.body],
      cta: payload.link ? { label: "Ouvrir le back-office", url: `${env.appUrl}${payload.link}` } : undefined,
    });
  }
}

export async function notifyNow(userId: string, payload: NotificationPayload) {
  await deliver(userId, payload);
}

export async function listNotifications(userId: string, opts?: { take?: number; unreadOnly?: boolean }) {
  return db.notification.findMany({
    where: { userId, ...(opts?.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: opts?.take ?? 30,
  });
}

export async function unreadNotificationCount(userId: string) {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function markNotificationsRead(userId: string, ids?: string[]) {
  await db.notification.updateMany({
    where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}

export async function savePreferences(userId: string, prefs: { type: NotificationType; inApp: boolean; email: boolean }[]) {
  await transaction(async (tx) => {
    for (const p of prefs) {
      const def = NOTIFICATION_TYPES[p.type];
      if (!def) continue;
      const locked = "locked" in def && def.locked;
      await tx.notificationPreference.upsert({
        where: { userId_type: { userId, type: p.type } },
        create: { userId, type: p.type, inApp: locked ? true : p.inApp, email: locked ? def.email : p.email },
        update: { inApp: locked ? true : p.inApp, email: locked ? def.email : p.email },
      });
    }
  });
}

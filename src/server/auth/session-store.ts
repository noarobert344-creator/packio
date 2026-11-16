import { db } from "@/server/db";
import type { Actor } from "./actor";
import { generateToken, hashToken } from "./tokens";

export const SESSION_COOKIE = "packio_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_AFTER_MS = 60 * 60 * 1000;

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      ip: meta.ip?.slice(0, 64) ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return { token, expiresAt };
}

export async function loadActorFromToken(token: string | undefined | null): Promise<{ actor: Actor; sessionId: string } | null> {
  if (!token || token.length > 200) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          staffRole: true,
          customerProfile: { select: { id: true } },
          preparerProfile: { select: { id: true } },
        },
      },
    },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  const { user } = session;
  if (user.status !== "ACTIVE") return null;

  if (now - session.lastUsedAt.getTime() > REFRESH_AFTER_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date(now) } }).catch(() => undefined);
  }

  return { sessionId: session.id, actor: toActor(user, session.activeRole) };
}

export function toActor(user: {
  id: string;
  role: Actor["role"];
  email: string;
  firstName: string;
  lastName: string;
  isDemo: boolean;
  staffRole: { permissions: string[] } | null;
  customerProfile: { id: string } | null;
  preparerProfile: { id: string } | null;
}, activeRole?: Actor["role"] | null): Actor {
  // Administrateur qui est aussi préparateur et/ou client : la session porte
  // l'espace actif. Hors administration, le compte n'a aucune permission
  // d'administration, et l'identifiant client n'existe que dans l'espace client.
  const owned: Actor["role"][] =
    user.role === "ADMIN" ? ["ADMIN", ...(user.preparerProfile ? (["PREPARER"] as const) : []), ...(user.customerProfile ? (["CUSTOMER"] as const) : [])] : [user.role];
  const role = user.role === "ADMIN" && activeRole && owned.includes(activeRole) ? activeRole : user.role;
  return {
    userId: user.id,
    role,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isDemo: user.isDemo,
    permissions: role === "ADMIN" ? (user.staffRole?.permissions ?? []) : [],
    customerId: role === "CUSTOMER" ? (user.customerProfile?.id ?? null) : null,
    preparerId: user.preparerProfile?.id ?? null,
    otherSpaces: owned.filter((r) => r !== role),
  };
}

/** Bascule de l'espace actif d'une session (administrateur qui est aussi préparateur et/ou client). */
export async function setSessionSpace(sessionId: string, userId: string, target: Actor["role"]) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, preparerProfile: { select: { id: true } }, customerProfile: { select: { id: true } } },
  });
  if (!user || user.role !== "ADMIN") return false;
  if (target === "PREPARER" && !user.preparerProfile) return false;
  if (target === "CUSTOMER" && !user.customerProfile) return false;
  await db.session.update({ where: { id: sessionId }, data: { activeRole: target === "ADMIN" ? null : target } });
  return true;
}

export async function revokeSessionToken(token: string) {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await db.session.deleteMany({ where: { userId, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) } });
}

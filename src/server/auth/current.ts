import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/server/env";
import type { Actor } from "./actor";
import { hasPermission, type Permission } from "./permissions";
import { SESSION_COOKIE, SESSION_TTL_MS, createSession, loadActorFromToken, revokeSessionToken } from "./session-store";

/** Session courante, résolue une seule fois par requête. */
export const getSession = cache(async () => {
  const store = await cookies();
  return loadActorFromToken(store.get(SESSION_COOKIE)?.value);
});

export async function getActor(): Promise<Actor | null> {
  return (await getSession())?.actor ?? null;
}

export function homePathFor(actor: Pick<Actor, "role">) {
  switch (actor.role) {
    case "ADMIN":
      return "/admin";
    case "PREPARER":
      return "/preparateur";
    default:
      return "/client";
  }
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/connexion");
  return actor;
}

export async function requireCustomer(): Promise<Actor & { customerId: string }> {
  const actor = await requireActor();
  if (actor.role !== "CUSTOMER" || !actor.customerId) redirect(homePathFor(actor));
  return actor as Actor & { customerId: string };
}

export async function requirePreparer(): Promise<Actor & { preparerId: string }> {
  const actor = await requireActor();
  if (actor.role !== "PREPARER" || !actor.preparerId) redirect(homePathFor(actor));
  return actor as Actor & { preparerId: string };
}

export async function requireAdmin(permission?: Permission): Promise<Actor> {
  const actor = await requireActor();
  if (actor.role !== "ADMIN") redirect(homePathFor(actor));
  if (permission && !hasPermission(actor.permissions, permission)) redirect("/admin?refus=permission");
  return actor;
}

export async function requestMeta() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return {
    ip: forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent"),
  };
}

export async function startSession(userId: string) {
  const meta = await requestMeta();
  const { token } = await createSession(userId, meta);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSessionToken(token);
  store.delete(SESSION_COOKIE);
}

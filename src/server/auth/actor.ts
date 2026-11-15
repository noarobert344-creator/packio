import type { UserRole } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/server/errors";
import { hasPermission, type Permission } from "./permissions";

/** Identité authentifiée transmise explicitement à chaque service métier. */
export type Actor = {
  userId: string;
  role: UserRole;
  email: string;
  firstName: string;
  lastName: string;
  permissions: string[];
  customerId: string | null;
  preparerId: string | null;
  isDemo: boolean;
};

export function isAdmin(actor: Actor) {
  return actor.role === "ADMIN";
}

export function assertAdmin(actor: Actor, permission?: Permission) {
  if (actor.role !== "ADMIN") throw new ForbiddenError();
  if (permission && !hasPermission(actor.permissions, permission)) {
    throw new ForbiddenError("Votre rôle d'administration ne permet pas cette action.");
  }
}

export function assertCustomer(actor: Actor): string {
  if (actor.role !== "CUSTOMER" || !actor.customerId) throw new ForbiddenError();
  return actor.customerId;
}

export function assertPreparer(actor: Actor): string {
  if (actor.role !== "PREPARER" || !actor.preparerId) throw new ForbiddenError();
  return actor.preparerId;
}

export function can(actor: Actor, permission: Permission) {
  return actor.role === "ADMIN" && hasPermission(actor.permissions, permission);
}

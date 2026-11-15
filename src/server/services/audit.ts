import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/server/auth/actor";
import { db, type DbClient } from "@/server/db";

export type AuditInput = {
  actor: Pick<Actor, "userId" | "role"> | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
};

/** Écrit une entrée dans le journal d'audit (table en ajout seul). */
export async function audit(input: AuditInput, client: DbClient = db) {
  await client.auditLog.create({
    data: {
      actorId: input.actor?.userId ?? null,
      actorRole: input.actor?.role ?? "SYSTEM",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      metadata: input.metadata,
      ip: input.ip ?? null,
    },
  });
}

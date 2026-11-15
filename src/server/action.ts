import "server-only";
import { z } from "zod";
import { DomainError } from "@/server/errors";
import { getActor } from "@/server/auth/current";
import type { Actor } from "@/server/auth/actor";

import type { ActionResult } from "@/lib/action-types";
export type { ActionResult, ActionState, FormAction } from "@/lib/action-types";

/** Convertit un FormData en objet simple (champs multiples -> tableaux). */
export function formToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION")) continue;
    if (typeof value !== "string") continue;
    if (key.endsWith("[]")) {
      const k = key.slice(0, -2);
      if (Array.isArray(out[k])) (out[k] as unknown[]).push(value);
      else out[k] = [value];
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function toActionError(err: unknown): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  if (err instanceof DomainError) return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
  if (err instanceof z.ZodError) {
    return { ok: false, error: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(err) };
  }
  // Les erreurs de navigation Next (redirect, notFound) doivent être relancées.
  if (err && typeof err === "object" && "digest" in err && typeof (err as { digest?: unknown }).digest === "string") {
    const digest = (err as { digest: string }).digest;
    if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND") {
      throw err;
    }
  }
  console.error("[action] erreur inattendue", err);
  return { ok: false, error: "Une erreur inattendue est survenue. Veuillez réessayer." };
}

/**
 * Exécute une action serveur authentifiée : résolution de l'acteur côté serveur,
 * validation Zod des données et conversion des erreurs métier.
 */
export async function runAction<S extends z.ZodType, T = undefined>(
  schema: S,
  input: unknown,
  fn: (actor: Actor, data: z.infer<S>) => Promise<ActionResult<T> | void>,
): Promise<ActionResult<T>> {
  try {
    const actor = await getActor();
    if (!actor) return { ok: false, error: "Votre session a expiré. Veuillez vous reconnecter." };
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "Certains champs sont invalides.", fieldErrors: zodFieldErrors(parsed.error) };
    }
    const result = await fn(actor, parsed.data);
    return result ?? { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

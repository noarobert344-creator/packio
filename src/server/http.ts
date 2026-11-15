import "server-only";
import { DomainError } from "@/server/errors";
import { env } from "@/server/env";

export function jsonError(err: unknown) {
  if (err instanceof DomainError) return Response.json({ error: err.message }, { status: err.status });
  console.error("[api] erreur", err);
  return Response.json({ error: "Erreur interne" }, { status: 500 });
}

/** Protection CSRF des routes POST : l'origine doit correspondre à l'application. */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const allowed = new URL(env.appUrl).origin;
  const host = request.headers.get("host");
  if (origin !== allowed && (!host || new URL(origin).host !== host)) {
    throw new DomainError("CSRF", "Origine non autorisée.", { status: 403 });
  }
}

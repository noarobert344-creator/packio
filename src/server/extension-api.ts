import "server-only";
import { z } from "zod";
import { DomainError } from "@/server/errors";
import { authenticateExtensionToken } from "@/server/services/marketplace";

/**
 * Outils HTTP de l'API de l'extension Packio Connect : authentification par
 * jeton personnel (Authorization: Bearer pkx_…), CORS limité aux origines
 * d'extensions de navigateur, réponses JSON homogènes.
 */

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const allowed = origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://");
  return allowed
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      }
    : { Vary: "Origin" };
}

export function preflight(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...corsHeaders(request), "Cache-Control": "no-store" } });
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/** Authentifie la requête ; renvoie l'identifiant client ou une réponse 401. */
export async function authenticate(request: Request): Promise<{ customerId: string } | { response: Response }> {
  const token = bearerToken(request);
  const customerId = await authenticateExtensionToken(token);
  if (!customerId) return { response: json(request, { ok: false, error: "Jeton invalide ou révoqué." }, 401) };
  return { customerId };
}

/** Lit un corps JSON en refusant ce qui dépasse la taille maximale. */
export async function readJson(request: Request, maxBytes: number): Promise<{ data: unknown } | { response: Response }> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { response: json(request, { ok: false, error: "Requête trop volumineuse." }, 413) };
  const text = await request.text();
  if (Buffer.byteLength(text) > maxBytes) return { response: json(request, { ok: false, error: "Requête trop volumineuse." }, 413) };
  try {
    return { data: JSON.parse(text) as unknown };
  } catch {
    return { response: json(request, { ok: false, error: "JSON invalide." }, 400) };
  }
}

export function errorResponse(request: Request, err: unknown) {
  if (err instanceof z.ZodError) {
    return json(request, { ok: false, error: "Données invalides.", issues: err.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
  }
  if (err instanceof DomainError) return json(request, { ok: false, error: err.message, code: err.code }, err.status && err.status >= 400 ? err.status : 400);
  console.error("[extension] erreur inattendue", err);
  return json(request, { ok: false, error: "Erreur interne." }, 500);
}

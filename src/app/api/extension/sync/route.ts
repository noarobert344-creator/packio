import { authenticate, errorResponse, json, preflight, readJson } from "@/server/extension-api";
import { syncFromExtension } from "@/server/services/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY = 1024 * 1024;

export function OPTIONS(request: Request) {
  return preflight(request);
}

/** Annonces et ventes transmises par l'extension (idempotent). */
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const body = await readJson(request, MAX_BODY);
  if ("response" in body) return body.response;
  try {
    return json(request, { ok: true, ...(await syncFromExtension(auth.customerId, body.data)) });
  } catch (err) {
    return errorResponse(request, err);
  }
}

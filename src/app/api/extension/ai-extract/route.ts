import { z } from "zod";
import { authenticate, errorResponse, json, preflight, readJson } from "@/server/extension-api";
import { AI_MAX_CONTENT_CHARS, extractSalesWithAI } from "@/server/services/ai-extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  platform: z.enum(["VINTED", "VESTIAIRE"]),
  content: z.string().min(1).max(AI_MAX_CONTENT_CHARS),
});

export function OPTIONS(request: Request) {
  return preflight(request);
}

/**
 * Secours de l'extension : extrait illisible de Vinted ou de Vestiaire
 * Collective → ventes au format de synchronisation, lues par l'IA.
 */
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const body = await readJson(request, AI_MAX_CONTENT_CHARS * 4 + 4096);
  if ("response" in body) return body.response;
  try {
    const input = schema.parse(body.data);
    const res = await extractSalesWithAI(auth.customerId, input);
    return json(request, { ok: true, sales: res.sales });
  } catch (err) {
    return errorResponse(request, err);
  }
}

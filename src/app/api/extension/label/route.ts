import { z } from "zod";
import { authenticate, errorResponse, json, preflight, readJson } from "@/server/extension-api";
import { attachSaleLabel } from "@/server/services/marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Base64 d'un bordereau de 5 Mo maximum, plus l'enveloppe JSON. */
const MAX_BODY = 7 * 1024 * 1024 + 64 * 1024;

const schema = z.object({
  platform: z.enum(["VINTED", "VESTIAIRE"]),
  externalOrderId: z.coerce.string().trim().min(1).max(80),
  filename: z.string().trim().min(1).max(200),
  contentBase64: z.string().min(1).max(MAX_BODY),
});

export function OPTIONS(request: Request) {
  return preflight(request);
}

/** Bordereau d'une vente, récupéré par l'extension sur la plateforme. */
export async function POST(request: Request) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const body = await readJson(request, MAX_BODY);
  if ("response" in body) return body.response;
  try {
    const input = schema.parse(body.data);
    const data = Buffer.from(input.contentBase64.replace(/^data:[^,]*,/, ""), "base64");
    const res = await attachSaleLabel(auth.customerId, { platform: input.platform, externalOrderId: input.externalOrderId, filename: input.filename, data });
    return json(request, { ok: true, ...res });
  } catch (err) {
    return errorResponse(request, err);
  }
}

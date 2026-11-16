import { getActor } from "@/server/auth/current";
import { DomainError } from "@/server/errors";
import { assertSameOrigin, jsonError } from "@/server/http";
import { MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES, uploadFile } from "@/server/services/files";
import type { FilePurpose } from "@/generated/prisma/enums";

export const runtime = "nodejs";

const PURPOSES: FilePurpose[] = ["AVATAR", "PRODUCT_PHOTO", "ORDER_PHOTO", "RECEPTION_PHOTO", "PREPARATION_PHOTO", "SHIPPING_LABEL", "MESSAGE_ATTACHMENT", "INCIDENT_ATTACHMENT"];

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await getActor();
    if (!actor) return Response.json({ error: "Non authentifié" }, { status: 401 });
    const form = await request.formData();
    const file = form.get("file");
    const purpose = String(form.get("purpose") ?? "") as FilePurpose;
    const customerId = form.get("customerId");
    if (!(file instanceof File)) throw new DomainError("NO_FILE", "Aucun fichier reçu.");
    if (!PURPOSES.includes(purpose)) throw new DomainError("PURPOSE", "Type de fichier invalide.");
    // Messagerie : vidéos et notes vocales plus lourdes (limite précise par type dans uploadFile).
    const limit = purpose === "MESSAGE_ATTACHMENT" ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES;
    if (file.size > limit) throw new DomainError("TOO_LARGE", `Fichier trop volumineux (${limit / 1024 / 1024} Mo maximum).`, { status: 413 });
    const saved = await uploadFile(actor, {
      purpose,
      filename: file.name,
      declaredType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
      customerId: typeof customerId === "string" && customerId ? customerId : null,
    });
    return Response.json({ id: saved.id, filename: saved.filename, mimeType: saved.mimeType, sizeBytes: saved.sizeBytes });
  } catch (err) {
    return jsonError(err);
  }
}

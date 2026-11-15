import { getActor } from "@/server/auth/current";
import { jsonError } from "@/server/http";
import { getFileForDownload } from "@/server/services/files";
import { storage } from "@/server/storage";

export const runtime = "nodejs";

/** Téléchargement d'un fichier privé après contrôle des droits. */
export async function GET(request: Request, ctx: RouteContext<"/api/files/[id]">) {
  try {
    const actor = await getActor();
    if (!actor) return new Response("Non authentifié", { status: 401 });
    const { id } = await ctx.params;
    const file = await getFileForDownload(actor, id);
    const signed = await storage().signedUrl(file.storageKey, file.filename, file.mimeType, 120);
    if (signed) return Response.redirect(signed, 302);
    const data = await storage().get(file.storageKey);
    if (!data) return new Response("Fichier introuvable", { status: 404 });
    const download = new URL(request.url).searchParams.has("telecharger");
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}

import { getActor } from "@/server/auth/current";
import { jsonError } from "@/server/http";
import { getFileForDownload, INLINE_TYPES } from "@/server/services/files";
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
    // Documents bureautiques, archives, textes : toujours en téléchargement.
    const download = new URL(request.url).searchParams.has("telecharger") || !INLINE_TYPES.includes(file.mimeType);
    const headers: Record<string, string> = {
      "Content-Type": file.mimeType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, max-age=300",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    };
    // Lecture partielle (Safari l'exige pour lire une vidéo ou un audio).
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
    if (range && (range[1] || range[2])) {
      const size = data.length;
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
      }
      return new Response(new Uint8Array(data.subarray(start, end + 1)), {
        status: 206,
        headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
      });
    }
    return new Response(new Uint8Array(data), { headers: { ...headers, "Content-Length": String(data.length) } });
  } catch (err) {
    return jsonError(err);
  }
}

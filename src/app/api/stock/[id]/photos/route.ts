import { getActor } from "@/server/auth/current";
import { db } from "@/server/db";
import { jsonError } from "@/server/http";
import { buildZip } from "@/server/lib/zip";
import { getItemForActor } from "@/server/services/inventory";
import { storage } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/gif": "gif" };

/** Toutes les photos produit d'un article, en une archive ZIP (pour créer une annonce). */
export async function GET(_request: Request, ctx: RouteContext<"/api/stock/[id]/photos">) {
  try {
    const actor = await getActor();
    if (!actor) return new Response("Non authentifié", { status: 401 });
    const { id } = await ctx.params;
    const item = await getItemForActor(actor, id);
    const files = await db.file.findMany({
      where: { inventoryItemId: item.id, purpose: "PRODUCT_PHOTO", deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: 40,
    });
    if (!files.length) return new Response("Aucune photo pour cet article", { status: 404 });
    const entries = [];
    for (const [i, f] of files.entries()) {
      const data = await storage().get(f.storageKey);
      if (data) entries.push({ name: `${item.sku}-${String(i + 1).padStart(2, "0")}.${EXT[f.mimeType] ?? "bin"}`, data, date: f.createdAt });
    }
    const zip = buildZip(entries);
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(zip.length),
        "Content-Disposition": `attachment; filename="${item.sku}-photos.zip"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}

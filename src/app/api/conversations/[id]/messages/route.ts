import { getActor } from "@/server/auth/current";
import { jsonError } from "@/server/http";
import { getMessages, getReadReceipts } from "@/server/services/messaging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: RouteContext<"/api/conversations/[id]/messages">) {
  try {
    const actor = await getActor();
    if (!actor) return Response.json({ error: "Non authentifié" }, { status: 401 });
    const { id } = await ctx.params;
    const afterParam = new URL(request.url).searchParams.get("after");
    const after = afterParam ? new Date(afterParam) : undefined;
    const messages = await getMessages(actor, id, { after: after && !Number.isNaN(after.getTime()) ? after : undefined });
    const readAt = await getReadReceipts(id, actor.userId);
    return Response.json({ messages, readAt });
  } catch (err) {
    return jsonError(err);
  }
}

import { getActor } from "@/server/auth/current";
import { can } from "@/server/auth/actor";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Flux temps réel (Server-Sent Events) : notifie le navigateur des nouveaux
 * messages et notifications. La connexion est renouvelée automatiquement par
 * EventSource (compatible avec les limites de durée des fonctions serverless).
 */
export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return new Response("Non authentifié", { status: 401 });

  const messageWhere =
    actor.role === "ADMIN"
      ? can(actor, "support.manage")
        ? { conversation: { type: "SUPPORT" as const }, sender: { role: { not: "ADMIN" as const } } }
        : { id: "__none__" }
      : { senderId: { not: actor.userId }, conversation: { participants: { some: { userId: actor.userId, leftAt: null } } } };

  const encoder = new TextEncoder();
  let closed = false;
  request.signal.addEventListener("abort", () => {
    closed = true;
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      controller.enqueue(encoder.encode("retry: 3000\n\n"));
      let lastUnread = -1;
      let lastMessageId: string | null | undefined;
      const started = Date.now();
      try {
        while (!closed && Date.now() - started < 50_000) {
          const [unread, latest] = await Promise.all([
            db.notification.count({ where: { userId: actor.userId, readAt: null } }),
            db.message.findFirst({ where: messageWhere, orderBy: { createdAt: "desc" }, select: { id: true, conversationId: true } }),
          ]);
          if (unread !== lastUnread) {
            send("notifications", { unread });
            lastUnread = unread;
          }
          const latestId = latest?.id ?? null;
          if (lastMessageId !== undefined && latestId !== lastMessageId) send("message", { conversationId: latest?.conversationId });
          lastMessageId = latestId;
          await new Promise((r) => setTimeout(r, 2500));
        }
      } catch {
        // connexion interrompue : le client se reconnecte
      }
      if (!closed) controller.close();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

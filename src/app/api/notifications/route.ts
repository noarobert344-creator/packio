import { getActor } from "@/server/auth/current";
import { listNotifications, unreadNotificationCount } from "@/server/services/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Non authentifié" }, { status: 401 });
  const [items, unread] = await Promise.all([listNotifications(actor.userId, { take: 20 }), unreadNotificationCount(actor.userId)]);
  return Response.json({ items, unread });
}

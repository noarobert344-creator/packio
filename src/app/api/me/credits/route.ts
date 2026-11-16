import { getActor } from "@/server/auth/current";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Solde de crédits du client connecté (affiché en haut de l'espace client). */
export async function GET() {
  const actor = await getActor();
  if (!actor || actor.role !== "CUSTOMER" || !actor.customerId) return Response.json({ error: "Non autorisé" }, { status: 401 });
  const wallet = await db.creditWallet.findUnique({ where: { customerId: actor.customerId }, select: { monthlyBalance: true, purchasedBalance: true } });
  return Response.json({ available: (wallet?.monthlyBalance ?? 0) + (wallet?.purchasedBalance ?? 0) }, { headers: { "Cache-Control": "no-store" } });
}

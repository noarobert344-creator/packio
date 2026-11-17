import { NextResponse } from "next/server";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * Offres publiques (déjà affichées sur la page Tarifs), lues par le bot
 * Discord pour le salon « tarifs ». Aucune donnée personnelle.
 */
export async function GET() {
  const [plans, packs] = await Promise.all([
    db.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        name: true,
        priceCents: true,
        annualPriceCents: true,
        monthlyCredits: true,
        storageLimit: true,
        currency: true,
      },
    }),
    db.creditPack.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { credits: true, priceCents: true, currency: true },
    }),
  ]);
  return NextResponse.json(
    { plans, packs },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}

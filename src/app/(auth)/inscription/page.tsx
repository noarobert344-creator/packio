import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/components/auth/forms";
import { redirectIfAuthenticated } from "@/server/actions/auth";
import { db } from "@/server/db";
import { formatMoney } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Créer un compte" };

export default async function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  await redirectIfAuthenticated();
  const offre = one((await searchParams).offre)?.toUpperCase();
  const plan = offre ? await db.plan.findFirst({ where: { code: offre, isActive: true } }) : null;
  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Créez votre compte Packio</h1>
        <p className="text-sm text-muted-foreground">
          {plan ? (
            <>
              Offre sélectionnée : <span className="font-medium text-foreground">{plan.name}</span> — {formatMoney(plan.priceCents)} / mois, {plan.monthlyCredits} crédits.
            </>
          ) : (
            "Vous choisirez votre abonnement à l'étape suivante."
          )}
        </p>
      </div>
      <RegisterForm offre={plan?.code} />
      <p className="text-center text-sm text-muted-foreground">
        Déjà inscrit ?{" "}
        <Link href="/connexion" className="font-medium text-foreground underline-offset-4 hover:underline">
          Se connecter
        </Link>
      </p>
    </div>
  );
}

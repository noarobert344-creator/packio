import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { LoginForm } from "@/components/auth/forms";
import { redirectIfAuthenticated } from "@/server/actions/auth";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  await redirectIfAuthenticated();
  const sp = await searchParams;
  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Bon retour sur Packio</h1>
        <p className="text-sm text-muted-foreground">Connectez-vous à votre espace client, préparateur ou administrateur.</p>
      </div>
      {one(sp.reinitialise) && (
        <p className="flex items-center gap-2 rounded-xl bg-success-soft px-3 py-2.5 text-sm text-success">
          <CheckCircle2 className="size-4" /> Mot de passe modifié. Vous pouvez vous connecter.
        </p>
      )}
      <LoginForm next={one(sp.suivant)} />
      <p className="text-center text-sm text-muted-foreground">
        Pas encore de compte ?{" "}
        <Link href="/inscription" className="font-medium text-foreground underline-offset-4 hover:underline">
          Créer un compte
        </Link>
      </p>
    </div>
  );
}

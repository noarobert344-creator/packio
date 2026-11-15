import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyEmail } from "@/server/services/auth";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Vérification de l'adresse e-mail" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const token = one((await searchParams).token);
  let ok = false;
  if (token) {
    try {
      await verifyEmail(token);
      ok = true;
    } catch {
      ok = false;
    }
  }
  return (
    <div className="space-y-6 text-center">
      {ok ? <CheckCircle2 className="mx-auto size-10 text-success" /> : <XCircle className="mx-auto size-10 text-danger" />}
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{ok ? "Adresse e-mail confirmée" : "Lien invalide ou expiré"}</h1>
        <p className="text-sm text-muted-foreground">{ok ? "Merci, votre adresse est vérifiée." : "Ce lien a peut-être déjà été utilisé."}</p>
      </div>
      <Button asChild size="lg">
        <Link href="/connexion">Accéder à mon espace</Link>
      </Button>
    </div>
  );
}

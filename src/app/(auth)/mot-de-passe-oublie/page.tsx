import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Mot de passe oublié</h1>
        <p className="text-sm text-muted-foreground">Indiquez votre adresse e-mail : vous recevrez un lien valable une heure.</p>
      </div>
      <ForgotPasswordForm />
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/connexion" className="font-medium text-foreground underline-offset-4 hover:underline">
          Retour à la connexion
        </Link>
      </p>
    </div>
  );
}

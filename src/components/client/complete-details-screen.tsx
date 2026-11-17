import { LogOut, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/server/actions/auth";
import type { CustomerDetailsDefaults } from "@/server/services/customers";
import { CompleteDetailsForm } from "./complete-details-form";

/**
 * Écran imposé juste après le paiement : tant que le nom, le téléphone et
 * l'adresse ne sont pas renseignés, l'espace client affiche ce formulaire.
 */
export function CompleteDetailsScreen({
  defaults,
  email,
}: {
  defaults: CustomerDetailsDefaults;
  email: string;
}) {
  return (
    <div className="min-h-dvh bg-muted/40">
      <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <Logo />
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="sm">
            <LogOut /> Se déconnecter
          </Button>
        </form>
      </header>
      <main className="mx-auto w-full max-w-xl px-4 pb-12 sm:px-0">
        <div className="space-y-6 rounded-2xl border bg-card p-5 shadow-sm sm:p-8">
          <div className="space-y-2">
            <p className="text-sm font-medium text-brand">
              Abonnement actif · Dernière étape
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Complétez vos informations
            </h1>
            <p className="text-sm text-muted-foreground">
              Votre préparateur en a besoin pour vous identifier, réceptionner
              vos colis et vous renvoyer vos articles. Ce formulaire est
              obligatoire pour accéder à votre espace ({email}).
            </p>
          </div>
          <CompleteDetailsForm defaults={defaults} />
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            Vos informations sont visibles uniquement par votre préparateur et
            l&apos;équipe Packio, jamais par les autres clients. Vous pourrez
            les modifier dans Paramètres.
          </p>
        </div>
      </main>
    </div>
  );
}

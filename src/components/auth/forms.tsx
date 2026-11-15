"use client";

import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { CheckboxField, TextField } from "@/components/shared/form-field";
import { PasswordField } from "./password-input";
import { acceptInvitationAction, forgotPasswordAction, loginAction, registerAction, resetPasswordAction } from "@/server/actions/auth";

export function LoginForm({ next }: { next?: string }) {
  return (
    <ActionForm action={loginAction} silent className="grid gap-4">
      <input type="hidden" name="suivant" value={next ?? ""} />
      <TextField name="email" label="Adresse e-mail" type="email" autoComplete="email" required autoFocus placeholder="vous@exemple.fr" />
      <PasswordField name="password" label="Mot de passe" />
      <div className="-mt-1 text-right">
        <Link href="/mot-de-passe-oublie" className="text-xs text-muted-foreground hover:text-foreground">
          Mot de passe oublié ?
        </Link>
      </div>
      <SubmitButton size="lg" className="h-10 w-full" pendingLabel="Connexion…">
        Se connecter
      </SubmitButton>
    </ActionForm>
  );
}

export function RegisterForm({ offre }: { offre?: string }) {
  return (
    <ActionForm action={registerAction} silent className="grid gap-4">
      <input type="hidden" name="offre" value={offre ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="firstName" label="Prénom" autoComplete="given-name" required />
        <TextField name="lastName" label="Nom" autoComplete="family-name" required />
      </div>
      <TextField name="email" label="Adresse e-mail" type="email" autoComplete="email" required placeholder="vous@exemple.fr" />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="phone" label="Téléphone" type="tel" autoComplete="tel" placeholder="Facultatif" />
        <TextField name="companyName" label="Boutique / société" placeholder="Facultatif" />
      </div>
      <PasswordField name="password" label="Mot de passe" autoComplete="new-password" hint="Au moins 10 caractères, dont une lettre et un chiffre." />
      <CheckboxField
        name="acceptTerms"
        required
        label={
          <>
            J&apos;accepte les{" "}
            <Link href="/legal/cgu" className="underline underline-offset-2" target="_blank">
              conditions d&apos;utilisation
            </Link>
            , les{" "}
            <Link href="/legal/cgv" className="underline underline-offset-2" target="_blank">
              conditions de vente
            </Link>{" "}
            et la{" "}
            <Link href="/legal/confidentialite" className="underline underline-offset-2" target="_blank">
              politique de confidentialité
            </Link>
            .
          </>
        }
      />
      <SubmitButton size="lg" className="h-10 w-full" pendingLabel="Création du compte…">
        Créer mon compte
      </SubmitButton>
    </ActionForm>
  );
}

export function ForgotPasswordForm() {
  return (
    <ActionForm action={forgotPasswordAction} resetOnSuccess className="grid gap-4">
      <TextField name="email" label="Adresse e-mail" type="email" autoComplete="email" required />
      <SubmitButton size="lg" className="h-10 w-full" pendingLabel="Envoi…">
        Recevoir un lien de réinitialisation
      </SubmitButton>
    </ActionForm>
  );
}

export function NewPasswordForm({ token, mode }: { token: string; mode: "reset" | "invitation" }) {
  return (
    <ActionForm action={mode === "reset" ? resetPasswordAction : acceptInvitationAction} silent className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <PasswordField name="password" label="Nouveau mot de passe" autoComplete="new-password" hint="Au moins 10 caractères, dont une lettre et un chiffre." />
      <PasswordField name="confirm" label="Confirmation" autoComplete="new-password" />
      <SubmitButton size="lg" className="h-10 w-full" pendingLabel="Enregistrement…">
        {mode === "reset" ? "Réinitialiser le mot de passe" : "Activer mon compte"}
      </SubmitButton>
    </ActionForm>
  );
}

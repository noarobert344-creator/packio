"use client";

import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { TextAreaField, TextField } from "@/components/shared/form-field";
import { contactAction } from "@/server/actions/public";

export function ContactForm() {
  return (
    <ActionForm action={contactAction} resetOnSuccess className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="name" label="Nom" autoComplete="name" required />
        <TextField name="email" label="Adresse e-mail" type="email" autoComplete="email" required />
      </div>
      <TextField name="subject" label="Objet" required placeholder="Ex. : question sur les offres" />
      <TextAreaField name="message" label="Message" required rows={5} />
      <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
        <label>
          Site web
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Vos données servent uniquement à traiter votre demande. Voir notre{" "}
        <Link href="/legal/confidentialite" className="underline underline-offset-2">
          politique de confidentialité
        </Link>
        .
      </p>
      <div>
        <SubmitButton size="lg" className="h-10 px-5" pendingLabel="Envoi…">
          Envoyer le message
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

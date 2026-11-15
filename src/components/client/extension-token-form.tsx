"use client";

import { useState } from "react";
import { KeyRound, TriangleAlert } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { CopyButton } from "@/components/shared/copy-button";
import { TextField } from "@/components/shared/form-field";
import type { FormAction } from "@/lib/action-types";

/** Création d'un jeton : la valeur en clair n'est affichée qu'une seule fois. */
export function ExtensionTokenForm({ action }: { action: FormAction<{ token: string }> }) {
  const [token, setToken] = useState<string | null>(null);
  return (
    <div className="grid gap-4">
      <ActionForm action={action} resetOnSuccess onSuccess={(state) => setToken(state.data?.token ?? null)} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <TextField name="label" label="Nom du jeton" placeholder="Ex. : Chrome, ordinateur du bureau" maxLength={60} />
        <SubmitButton pendingLabel="Création…">
          <KeyRound /> Créer un jeton
        </SubmitButton>
      </ActionForm>
      {token && (
        <div className="grid gap-3 rounded-xl border border-brand/40 bg-brand-soft p-4">
          <p className="flex items-start gap-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-brand" />
            Copiez ce jeton dans les options de l&apos;extension maintenant : pour votre sécurité, il ne sera plus jamais affiché.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-background px-3 py-2 font-mono text-xs">{token}</code>
            <CopyButton value={token} label="Copier le jeton" />
          </div>
        </div>
      )}
    </div>
  );
}

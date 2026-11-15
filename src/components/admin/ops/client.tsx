"use client";

import { useState } from "react";
import { Eye, EyeOff, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { SelectField, TextField } from "@/components/shared/form-field";
import { CopyButton } from "@/components/shared/copy-button";
import { inviteAdminAction } from "@/server/actions/admin/ops";

/** Code de retrait masqué par défaut (donnée sensible). */
export function PickupCode({ code }: { code: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-sm tracking-widest">{shown ? code : "••••••"}</span>
      <Button type="button" variant="ghost" size="icon-xs" onClick={() => setShown((s) => !s)} aria-label={shown ? "Masquer le code" : "Afficher le code"}>
        {shown ? <EyeOff /> : <Eye />}
      </Button>
    </span>
  );
}

export function InviteAdminForm({ roles }: { roles: { value: string; label: string }[] }) {
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="grid gap-4">
      <ActionForm action={inviteAdminAction} resetOnSuccess onSuccess={(s) => setUrl(s.data?.url ?? null)} className="grid gap-4 sm:grid-cols-2">
        <TextField name="firstName" label="Prénom" required />
        <TextField name="lastName" label="Nom" required />
        <TextField name="email" label="Adresse e-mail" type="email" required />
        <SelectField name="roleId" label="Rôle" required options={roles} placeholder="Choisir un rôle" />
        <div className="sm:col-span-2">
          <SubmitButton pendingLabel="Invitation…">Inviter l&apos;administrateur</SubmitButton>
        </div>
      </ActionForm>
      {url && (
        <div className="flex flex-col gap-2 rounded-xl border bg-brand-soft/40 p-3 sm:flex-row sm:items-center">
          <Link2 className="size-4 shrink-0 text-brand" />
          <p className="min-w-0 flex-1 truncate font-mono text-xs" title={url}>
            {url}
          </p>
          <CopyButton value={url} label="Copier le lien d'invitation" />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Le lien d&apos;activation est envoyé par e-mail et reste valable 7 jours. Il est aussi affiché ici, utile si l&apos;envoi d&apos;e-mails n&apos;est pas encore configuré.
      </p>
    </div>
  );
}


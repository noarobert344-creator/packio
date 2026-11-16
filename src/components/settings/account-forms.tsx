"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { TextField } from "@/components/shared/form-field";
import { uploadToPackio } from "@/components/shared/file-uploader";
import { PasswordField } from "@/components/auth/password-input";
import { changePasswordAction, savePreferencesAction, updateProfileAction } from "@/server/actions/account";

export function ProfileForm({
  user,
  showCompany,
  avatarHint,
}: {
  user: { firstName: string; lastName: string; email: string; phone: string | null; companyName?: string | null; avatarFileId: string | null };
  showCompany?: boolean;
  avatarHint?: string;
}) {
  return (
    <div className="grid gap-6">
      <AvatarPicker user={user} hint={avatarHint} />
      <ActionForm action={updateProfileAction} className="grid gap-4 sm:grid-cols-2">
        <TextField name="firstName" label="Prénom" defaultValue={user.firstName} required />
        <TextField name="lastName" label="Nom" defaultValue={user.lastName} required />
        <TextField name="email" label="Adresse e-mail" defaultValue={user.email} disabled hint="Contactez le support pour modifier votre adresse e-mail." />
        <TextField name="phone" label="Téléphone" type="tel" defaultValue={user.phone ?? ""} />
        {showCompany && <TextField name="companyName" label="Boutique / société" defaultValue={user.companyName ?? ""} className="sm:col-span-2" />}
        <div className="sm:col-span-2">
          <SubmitButton pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

/** Photo de profil : aperçu et téléversement immédiat. */
export function AvatarPicker({ user, hint }: { user: { firstName: string; lastName: string; avatarFileId: string | null }; hint?: string }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-16">
        {user.avatarFileId && <AvatarImage src={`/api/files/${user.avatarFileId}`} alt="" />}
        <AvatarFallback className="bg-brand-soft text-lg font-semibold text-brand">
          {user.firstName[0]}
          {user.lastName[0]}
        </AvatarFallback>
      </Avatar>
      <label className="cursor-pointer">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setUploading(true);
            try {
              await uploadToPackio(f, "AVATAR");
              toast.success("Photo de profil mise à jour.");
              router.refresh();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Échec du téléversement");
            } finally {
              setUploading(false);
            }
          }}
        />
        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm hover:bg-muted">
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
          {user.avatarFileId ? "Changer la photo" : "Ajouter une photo"}
        </span>
        {hint && <span className="mt-1.5 block max-w-xs text-xs text-muted-foreground">{hint}</span>}
      </label>
    </div>
  );
}

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess className="grid max-w-md gap-4">
      <PasswordField name="currentPassword" label="Mot de passe actuel" />
      <PasswordField name="newPassword" label="Nouveau mot de passe" autoComplete="new-password" hint="Au moins 10 caractères, dont une lettre et un chiffre." />
      <PasswordField name="confirm" label="Confirmation" autoComplete="new-password" />
      <div>
        <SubmitButton pendingLabel="Modification…">Modifier le mot de passe</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function NotificationPreferencesForm({ rows }: { rows: { type: string; label: string; inApp: boolean; email: boolean; locked: boolean; emailAvailable: boolean }[] }) {
  return (
    <ActionForm action={savePreferencesAction} className="grid gap-4">
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Événement</th>
              <th className="w-24 px-2 py-2.5 text-center font-medium">Application</th>
              <th className="w-24 px-2 py-2.5 text-center font-medium">E-mail</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.type}>
                <td className="px-4 py-2.5">
                  {r.label}
                  {r.locked && <span className="ml-2 text-xs text-muted-foreground">(obligatoire)</span>}
                  <input type="hidden" name={`present:${r.type}`} value="1" />
                </td>
                <td className="px-2 py-2.5 text-center">
                  <input type="checkbox" name={`inApp:${r.type}`} defaultChecked={r.inApp} disabled={r.locked} className="size-4 accent-[var(--brand)]" aria-label={`${r.label} — application`} />
                  {r.locked && <input type="hidden" name={`inApp:${r.type}`} value="on" />}
                </td>
                <td className="px-2 py-2.5 text-center">
                  {r.emailAvailable ? (
                    <>
                      <input type="checkbox" name={`email:${r.type}`} defaultChecked={r.email} disabled={r.locked} className="size-4 accent-[var(--brand)]" aria-label={`${r.label} — e-mail`} />
                      {r.locked && r.email && <input type="hidden" name={`email:${r.type}`} value="on" />}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <SubmitButton pendingLabel="Enregistrement…">Enregistrer les préférences</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function SettingsNav({ tabs, current, basePath }: { tabs: { key: string; label: string }[]; current: string; basePath: string }) {
  const router = useRouter();
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-muted p-1 scrollbar-none">
      {tabs.map((t) => (
        <Button key={t.key} variant={t.key === current ? "outline" : "ghost"} size="sm" className={t.key === current ? "bg-background shadow-sm" : ""} onClick={() => router.push(`${basePath}?onglet=${t.key}`)}>
          {t.label}
        </Button>
      ))}
    </div>
  );
}

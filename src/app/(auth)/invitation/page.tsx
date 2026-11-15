import type { Metadata } from "next";
import { NewPasswordForm } from "@/components/auth/forms";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Activer mon compte" };

export default async function InvitationPage({ searchParams }: { searchParams: SearchParams }) {
  const token = one((await searchParams).token);
  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Activez votre accès Packio</h1>
        <p className="text-sm text-muted-foreground">Choisissez le mot de passe de votre compte. Le lien d&apos;invitation est valable 7 jours.</p>
      </div>
      {token ? <NewPasswordForm token={token} mode="invitation" /> : <p className="rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">Lien d&apos;invitation incomplet.</p>}
    </div>
  );
}

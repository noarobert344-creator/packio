import type { Metadata } from "next";
import Link from "next/link";
import { NewPasswordForm } from "@/components/auth/forms";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Nouveau mot de passe" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const token = one((await searchParams).token);
  return (
    <div className="space-y-7">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Choisissez un nouveau mot de passe</h1>
        <p className="text-sm text-muted-foreground">Toutes vos sessions ouvertes seront déconnectées par sécurité.</p>
      </div>
      {token ? (
        <NewPasswordForm token={token} mode="reset" />
      ) : (
        <p className="rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
          Lien incomplet. <Link href="/mot-de-passe-oublie" className="underline">Demandez un nouveau lien</Link>.
        </p>
      )}
    </div>
  );
}

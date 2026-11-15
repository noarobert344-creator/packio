import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlaskConical, Lock } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ActionForm, SubmitButton } from "@/components/shared/action-form";
import { requireCustomer } from "@/server/auth/current";
import { billingMode } from "@/server/billing";
import { db } from "@/server/db";
import { devCheckoutAction } from "@/server/actions/customer";
import { formatMoney } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Paiement (démonstration)", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Écran de paiement simulé — disponible uniquement si BILLING_MODE=dev hors production. */
export default async function DemoCheckoutPage({ searchParams }: { searchParams: SearchParams }) {
  if (billingMode() !== "dev") notFound();
  const actor = await requireCustomer();
  const sp = await searchParams;
  const type = one(sp.type) === "credits" ? "credits" : "abonnement";
  const id = one(type === "credits" ? sp.pack : sp.offre) ?? "";
  const item =
    type === "abonnement"
      ? await db.plan.findUnique({ where: { id } }).then((p) => p && { title: `Abonnement Packio ${p.name}`, detail: `${p.monthlyCredits} crédits par mois · renouvellement mensuel`, price: p.priceCents, suffix: "/ mois" })
      : await db.creditPack.findUnique({ where: { id } }).then((p) => p && { title: `Recharge ${p.name}`, detail: `${p.credits} crédits ajoutés à votre portefeuille`, price: p.priceCents, suffix: "" });
  if (!item) notFound();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md space-y-5">
        <div className="flex items-center justify-between">
          <Logo />
          <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning">
            <FlaskConical className="size-3.5" /> Démonstration
          </span>
        </div>
        <div className="space-y-5 rounded-2xl border bg-card p-6 shadow-soft">
          <div>
            <p className="text-sm text-muted-foreground">{actor.email}</p>
            <h1 className="mt-1 text-lg font-semibold">{item.title}</h1>
            <p className="text-sm text-muted-foreground">{item.detail}</p>
          </div>
          <div className="flex items-baseline justify-between border-y py-4">
            <span className="text-sm">Total</span>
            <span className="text-2xl font-semibold tabular">
              {formatMoney(item.price)} <span className="text-sm font-normal text-muted-foreground">{item.suffix}</span>
            </span>
          </div>
          <p className="rounded-xl bg-warning-soft p-3 text-xs text-warning">
            Environnement de développement : ce paiement est simulé. Aucune carte n&apos;est demandée et aucun montant n&apos;est encaissé. En production, cet écran est remplacé par Stripe Checkout.
          </p>
          <ActionForm action={devCheckoutAction} silent>
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="id" value={id} />
            <SubmitButton className="h-11 w-full" pendingLabel="Traitement…">
              <Lock /> Simuler le paiement
            </SubmitButton>
          </ActionForm>
          <Link href={type === "abonnement" ? "/client/abonnement?paiement=annule" : "/client/credits?recharge=annulee"} className="block text-center text-sm text-muted-foreground hover:text-foreground">
            Annuler et revenir
          </Link>
        </div>
      </div>
    </div>
  );
}

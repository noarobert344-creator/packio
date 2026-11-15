import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { PlanPicker } from "@/components/client/plan-picker";
import { requireCustomer } from "@/server/auth/current";
import { db } from "@/server/db";
import { getActiveSubscription } from "@/server/services/customers";
import { changePlanAction, startSubscriptionAction } from "@/server/actions/customer";
import { billingMode } from "@/server/billing";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Abonnement" };

export default async function SubscriptionPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireCustomer();
  const sp = await searchParams;
  const [plans, sub] = await Promise.all([db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }), getActiveSubscription(actor.customerId)]);
  const preselect = one(sp.offre)?.toUpperCase();
  return (
    <div className="space-y-8">
      <PageHeader
        title={sub ? "Changer d'offre" : "Choisissez votre abonnement"}
        description={
          sub
            ? "Une offre supérieure s'applique immédiatement (prorata facturé, crédits supplémentaires ajoutés). Une offre inférieure s'applique au prochain renouvellement."
            : "Chaque abonnement inclut un préparateur attitré, le tableau de bord, le suivi du stock et la messagerie. Sans engagement, résiliable à tout moment."
        }
        back={sub ? { href: "/client/facturation", label: "Facturation" } : undefined}
      />
      {one(sp.paiement) === "annule" && (
        <p className="flex items-center gap-2 rounded-xl bg-muted px-4 py-3 text-sm">
          <XCircle className="size-4" /> Paiement annulé : aucun montant n&apos;a été débité.
        </p>
      )}
      <PlanPicker
        plans={plans}
        action={sub ? changePlanAction : startSubscriptionAction}
        currentPlanId={sub?.planId}
        preselect={preselect}
        ctaLabel={(p) => (sub ? `Passer à ${p.name}` : `Souscrire ${p.name}`)}
      />
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
        {billingMode() === "dev"
          ? "Mode démonstration : le paiement est simulé, aucun montant n'est encaissé."
          : "Paiement sécurisé par Stripe. Vos données bancaires ne transitent jamais par les serveurs de Packio."}{" "}
        Les frais de transport éventuels sont distincts des crédits de préparation.{" "}
        <Link href="/legal/cgv" className="underline underline-offset-2">
          Conditions de vente
        </Link>
      </p>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { PlanPicker } from "@/components/client/plan-picker";
import { requireCustomer } from "@/server/auth/current";
import { db } from "@/server/db";
import { getActiveSubscription } from "@/server/services/customers";
import { changePlanAction, startSubscriptionAction } from "@/server/actions/customer";
import { billingMode } from "@/server/billing";
import { commonAnnualBadge, intervalFromParam } from "@/lib/billing-intervals";
import { formatDate } from "@/lib/format";
import { one, type SearchParams } from "@/lib/params";

export const metadata: Metadata = { title: "Abonnement" };

export default async function SubscriptionPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireCustomer();
  const sp = await searchParams;
  const [plans, sub, replaced, lastEnded] = await Promise.all([
    db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    getActiveSubscription(actor.customerId),
    db.subscription.findMany({
      where: { customerId: actor.customerId, supersededAt: { not: null }, status: { in: ["ACTIVE", "TRIALING"] } },
      include: { plan: true },
    }),
    db.subscription.findFirst({ where: { customerId: actor.customerId, status: "CANCELED" }, orderBy: { endedAt: "desc" }, include: { pendingPlan: true } }),
  ]);
  // Fin d'une formule annuelle avec passage au mensuel demandé : offre pré-sélectionnée.
  const awaitingMonthly = !sub && lastEnded?.pendingBillingInterval === "MONTHLY" && lastEnded.pendingPlan?.isActive ? lastEnded.pendingPlan : null;
  const preselect = awaitingMonthly?.code ?? one(sp.offre)?.toUpperCase();
  const annualBadge = commonAnnualBadge(plans);
  const initialInterval = awaitingMonthly ? "MONTHLY" : one(sp.periodicite) ? intervalFromParam(one(sp.periodicite)) : undefined;

  return (
    <div className="space-y-8">
      <PageHeader
        title={sub ? "Changer d'offre" : "Choisissez votre abonnement"}
        description={
          sub
            ? "Une offre supérieure ou le passage à l'annuel s'appliquent tout de suite, avec un nouveau paiement. Une offre inférieure prend effet à votre prochain renouvellement. Besoin de crédits ponctuellement ? Achetez 10, 30, 50 ou 100 crédits supplémentaires."
            : `Chaque abonnement inclut un préparateur attitré, le tableau de bord, le suivi du stock et la messagerie. En mensuel, sans engagement${annualBadge ? ` ; en annuel, ${annualBadge} et vos crédits versés chaque mois` : ""}.`
        }
        back={sub ? { href: "/client/facturation", label: "Facturation" } : undefined}
      />
      {one(sp.paiement) === "annule" && (
        <p className="flex items-center gap-2 rounded-xl bg-muted px-4 py-3 text-sm">
          <XCircle className="size-4" /> Paiement annulé : aucun montant n&apos;a été débité.
        </p>
      )}
      {one(sp.changement) === "confirme" && sub && (
        <p className="flex items-center gap-2 rounded-xl bg-success-soft px-4 py-3 text-sm text-success">
          <CheckCircle2 className="size-4" /> Votre nouvelle offre {sub.plan.name}
          {sub.billingInterval === "YEARLY" ? " (formule annuelle)" : ""} est active.
        </p>
      )}
      {awaitingMonthly && (
        <p className="flex items-start gap-2 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-brand" />
          Votre formule annuelle est arrivée à échéance. Activez la formule mensuelle {awaitingMonthly.name} ci-dessous pour continuer à recevoir vos crédits et à expédier vos colis.
        </p>
      )}
      {replaced.map((r) => (
        <p key={r.id} className="flex items-start gap-2 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          <CalendarClock className="mt-0.5 size-4 shrink-0" />
          Offre précédente {r.plan.name}
          {r.billingInterval === "YEARLY" ? " (annuelle)" : ""} : non renouvelée, elle prend fin le {formatDate(r.currentPeriodEnd)}.
          {r.billingInterval === "YEARLY" && r.nextCreditGrantAt ? ` Ses crédits mensuels déjà payés continuent d'être versés d'ici là.` : " Ses crédits restent utilisables jusqu'à leur échéance."}
        </p>
      ))}
      <PlanPicker
        plans={plans}
        action={sub ? changePlanAction : startSubscriptionAction}
        current={
          sub
            ? {
                planId: sub.planId,
                interval: sub.billingInterval,
                pendingPlanId: sub.pendingPlanId,
                pendingInterval: sub.pendingBillingInterval,
                pendingLocked: sub.provider === "whop" && !!sub.pendingSyncedAt,
                periodEndLabel: sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd, "d MMMM yyyy") : null,
              }
            : undefined
        }
        preselect={preselect}
        initialInterval={initialInterval}
      />
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
        {billingMode() === "dev"
          ? "Mode démonstration : le paiement est simulé, aucun montant n'est encaissé."
          : "Paiement sécurisé par Whop. Vos données bancaires ne transitent jamais par les serveurs de Packio."}{" "}
        Les frais de transport éventuels sont distincts des crédits de préparation.{" "}
        <Link href="/legal/cgv" className="underline underline-offset-2">
          Conditions de vente
        </Link>
      </p>
    </div>
  );
}

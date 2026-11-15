import { Info, Package, TriangleAlert, Warehouse } from "lucide-react";
import type { Settings } from "@/server/services/settings";
import { commonAnnualBadge } from "@/lib/billing-intervals";
import { formatMoney } from "@/lib/format";
import { Container, SectionHeading } from "./section";
import { PricingPlans, type PricingPlan } from "./pricing-plans";

export type StorageRules = Settings["storage"];

/** Durée lisible : 14 → « 2 semaines », 30 → « 30 jours ». */
export function durationLabel(days: number) {
  if (days % 7 === 0) {
    const weeks = days / 7;
    return `${weeks} semaine${weeks > 1 ? "s" : ""}`;
  }
  return `${days} jour${days > 1 ? "s" : ""}`;
}
type SizeRule = { size: string; label: string; description: string | null; creditCost: number; maxLengthCm: number | null; maxWidthCm: number | null; maxHeightCm: number | null; maxWeightGrams: number | null };
type Pack = { id: string; name: string; credits: number; priceCents: number; currency: string };

function dims(r: SizeRule) {
  const parts: string[] = [];
  if (r.maxLengthCm && r.maxWidthCm && r.maxHeightCm) parts.push(`${r.maxLengthCm} × ${r.maxWidthCm} × ${r.maxHeightCm} cm`);
  if (r.maxWeightGrams) parts.push(`${(r.maxWeightGrams / 1000).toLocaleString("fr-FR")} kg max`);
  return parts.join(" · ") || "Selon appréciation du préparateur";
}

export function Pricing({
  plans,
  sizeRules,
  packs,
  storage,
  shippingHours,
}: {
  plans: PricingPlan[];
  sizeRules: SizeRule[];
  packs: Pack[];
  storage: StorageRules;
  shippingHours: number;
}) {
  const annualBadge = commonAnnualBadge(plans);
  const extension = `${storage.extensionCredits} crédit${storage.extensionCredits > 1 ? "s" : ""}`;
  return (
    <section id="tarifs" className="scroll-mt-20 border-t py-24 sm:py-28">
      <Container className="space-y-14">
        <SectionHeading
          eyebrow="Tarifs"
          title="Un abonnement simple, des crédits pour chaque colis"
          description={`Chaque offre inclut un préparateur attitré, des places de stockage, l'expédition sous ${shippingHours} h, le tableau de bord et la messagerie. En mensuel, sans engagement : résiliable à tout moment, effectif à la fin de la période de 30 jours en cours.${annualBadge ? ` En annuel : ${annualBadge}, engagement de 12 mois.` : ""}`}
        />
        <PricingPlans plans={plans} />

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-3xl border bg-card p-6 sm:p-7">
            <div className="flex items-center gap-2">
              <Package className="size-4 text-brand" />
              <p className="font-semibold">Coût de préparation par colis</p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">La taille réelle est déterminée par votre préparateur, selon les règles ci-dessous. Vous êtes notifié avant tout débit.</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {sizeRules.map((r) => (
                <div key={r.size} className="rounded-2xl bg-muted/50 p-4">
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular">
                    {r.creditCost} <span className="text-sm font-normal text-muted-foreground">crédit{r.creditCost > 1 ? "s" : ""}</span>
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{dims(r)}</p>
                  {r.description && <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>}
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col rounded-3xl border bg-card p-6 sm:p-7">
            <p className="font-semibold">Crédits supplémentaires</p>
            <p className="mt-1 text-sm text-muted-foreground">Besoin de plus de crédits un mois donné ? Achetez 10, 30, 50 ou 100 crédits depuis votre espace, sans changer d&apos;offre.</p>
            <ul className="mt-5 divide-y rounded-2xl border">
              {packs.map((pk) => (
                <li key={pk.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>
                    <span className="font-medium">{pk.credits} crédits</span>
                    <span className="ml-2 text-xs text-muted-foreground">{formatMoney(Math.round(pk.priceCents / pk.credits), pk.currency)} / crédit</span>
                  </span>
                  <span className="font-semibold tabular">{formatMoney(pk.priceCents, pk.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="rounded-3xl border bg-card p-6 sm:p-7">
          <div className="flex items-center gap-2">
            <Warehouse className="size-4 text-brand" />
            <p className="font-semibold">Stockage</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Une place correspond à un article stocké chez votre préparateur. Sont comptés les articles en stock et ceux de vos commandes en cours d&apos;acheminement.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-muted/50 p-4">
              <p className="text-sm font-medium">Places incluses</p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {plans.map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">{p.name}</span>
                    <span className="font-semibold tabular">{p.storageLimit === null ? "Illimité" : `${p.storageLimit} articles`}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">En même temps, selon votre offre.</p>
            </div>
            <div className="rounded-2xl bg-muted/50 p-4">
              <p className="text-sm font-medium">Durée de stockage</p>
              <p className="mt-2 text-2xl font-semibold">{durationLabel(storage.includedDays)}</p>
              <p className="text-xs text-muted-foreground">incluses pour chaque article</p>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {storage.extensionCredits > 0
                  ? `Au-delà : ${extension} par article pour ${durationLabel(storage.extensionDays)} de plus, prélevé automatiquement.${storage.reminderDaysBefore > 0 ? ` Vous êtes prévenu ${durationLabel(storage.reminderDaysBefore)} avant.` : ""}`
                  : `Au-delà, la durée est prolongée par périodes de ${durationLabel(storage.extensionDays)}.`}
              </p>
            </div>
            <div className="rounded-2xl bg-muted/50 p-4">
              <p className="text-sm font-medium">Places supplémentaires</p>
              <p className="mt-2 text-2xl font-semibold">
                1 crédit <span className="text-base font-normal text-muted-foreground">=</span> {storage.slotsPerCredit} places
              </p>
              <p className="text-xs text-muted-foreground">pendant {durationLabel(storage.extraSlotsDays)}</p>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">À ajouter depuis « Mon stock », quand vous en avez besoin.</p>
            </div>
          </div>
          <p className="mt-5 flex gap-2.5 rounded-2xl border border-warning/30 bg-warning-soft/50 p-4 text-sm leading-relaxed">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              <span className="font-medium">Une commande qui dépasse vos places ?</span>{" "}
              <span className="text-muted-foreground">
                Le formulaire de commande indique les crédits nécessaires pour les places manquantes ; ils ne sont débités qu&apos;avec votre accord, et la commande
                est refusée si votre solde ne suffit pas. Les commandes en dropshipping n&apos;occupent aucune place.
              </span>
            </span>
          </p>
        </div>

        <div className="flex gap-3 rounded-2xl border bg-muted/40 p-5 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-brand" />
          <p className="leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Frais de transport non inclus.</span> Les crédits couvrent la réception, le stockage et la préparation, y compris pour un
            retour à votre domicile. L&apos;affranchissement est
            distinct : vous fournissez votre propre étiquette (par exemple celle générée par Vinted), ou les frais d&apos;envoi vous sont indiqués et facturés séparément.
          </p>
        </div>
      </Container>
    </section>
  );
}

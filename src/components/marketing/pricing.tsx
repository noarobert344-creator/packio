import { Info, Package, Warehouse } from "lucide-react";
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
type SizeRule = {
  size: string;
  label: string;
  description: string | null;
  creditCost: number;
  maxLengthCm: number | null;
  maxWidthCm: number | null;
  maxHeightCm: number | null;
  maxWeightGrams: number | null;
};
type Pack = {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
  currency: string;
};

function dims(r: SizeRule) {
  const parts: string[] = [];
  if (r.maxLengthCm && r.maxWidthCm && r.maxHeightCm)
    parts.push(`${r.maxLengthCm} × ${r.maxWidthCm} × ${r.maxHeightCm} cm`);
  if (r.maxWeightGrams)
    parts.push(`${(r.maxWeightGrams / 1000).toLocaleString("fr-FR")} kg max`);
  return parts.join(" · ") || "Selon appréciation du préparateur";
}

export function Pricing({
  plans,
  sizeRules,
  packs,
  storage,
  shippingHours,
  returnCredits,
  addressDeliveryCredits = 0,
}: {
  plans: PricingPlan[];
  sizeRules: SizeRule[];
  packs: Pack[];
  storage: StorageRules;
  shippingHours: number;
  returnCredits: number;
  addressDeliveryCredits?: number;
}) {
  const annualBadge = commonAnnualBadge(plans);
  const extension = `${storage.extensionCredits} crédit${storage.extensionCredits > 1 ? "s" : ""}`;
  return (
    <section id="tarifs" className="scroll-mt-20 border-t py-24 sm:py-28">
      <Container className="space-y-14">
        <SectionHeading
          eyebrow="Tarifs"
          title="Un abonnement simple, des crédits pour chaque colis"
          description={`Préparateur attitré, stockage, expédition sous ${shippingHours} h et messagerie inclus. Sans engagement en mensuel${annualBadge ? ` ; en annuel : ${annualBadge}` : ""}.`}
        />
        <PricingPlans plans={plans} />

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div data-reveal className="rounded-3xl border bg-card p-6 sm:p-7">
            <div className="flex items-center gap-2">
              <Package className="size-4 text-brand" />
              <p className="font-semibold">Coût de préparation par colis</p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Selon la taille du colis, mesurée par votre préparateur.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {sizeRules.map((r) => (
                <div key={r.size} className="rounded-2xl bg-muted/50 p-4">
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular">
                    {r.creditCost}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      crédit{r.creditCost > 1 ? "s" : ""}
                    </span>
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {dims(r)}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div
            data-reveal
            className="flex flex-col rounded-3xl border bg-card p-6 sm:p-7"
            style={{ "--d": "100ms" } as React.CSSProperties}
          >
            <p className="font-semibold">Crédits supplémentaires</p>
            <p className="mt-1 text-sm text-muted-foreground">
              À tout moment, sans changer d&apos;offre.
            </p>
            <ul className="mt-5 divide-y rounded-2xl border">
              {packs.map((pk) => (
                <li
                  key={pk.id}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <span>
                    <span className="font-medium">{pk.credits} crédits</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatMoney(
                        Math.round(pk.priceCents / pk.credits),
                        pk.currency,
                      )}{" "}
                      / crédit
                    </span>
                  </span>
                  <span className="font-semibold tabular">
                    {formatMoney(pk.priceCents, pk.currency)} HT
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div data-reveal className="rounded-3xl border bg-card p-6 sm:p-7">
          <div className="flex items-center gap-2">
            <Warehouse className="size-4 text-brand" />
            <p className="font-semibold">Stockage</p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Une place = un article chez votre préparateur, y compris les
            commandes en route. Le dropshipping ne prend aucune place.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-muted/50 p-4">
              <p className="text-sm font-medium">Places incluses</p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {plans.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="text-muted-foreground">{p.name}</span>
                    <span className="font-semibold tabular">
                      {p.storageLimit === null
                        ? "Illimité"
                        : `${p.storageLimit} articles`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-muted/50 p-4">
              <p className="text-sm font-medium">Durée de stockage</p>
              <p className="mt-2 text-2xl font-semibold">
                {durationLabel(storage.includedDays)}
              </p>
              <p className="text-xs text-muted-foreground">
                incluses pour chaque article
              </p>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {storage.extensionCredits > 0
                  ? `Au-delà : ${extension} par article pour ${durationLabel(storage.extensionDays)} de plus, prélevé automatiquement.${storage.reminderDaysBefore > 0 ? ` Vous êtes prévenu ${durationLabel(storage.reminderDaysBefore)} avant.` : ""}`
                  : `Au-delà, la durée est prolongée par périodes de ${durationLabel(storage.extensionDays)}.`}
              </p>
            </div>
            <div className="rounded-2xl bg-muted/50 p-4">
              <p className="text-sm font-medium">Places supplémentaires</p>
              <p className="mt-2 text-2xl font-semibold">
                1 crédit{" "}
                <span className="text-base font-normal text-muted-foreground">
                  =
                </span>{" "}
                {storage.slotsPerCredit} place
                {storage.slotsPerCredit > 1 ? "s" : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                pendant {durationLabel(storage.extraSlotsDays)}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                À ajouter depuis « Mon stock », quand vous en avez besoin.
              </p>
            </div>
          </div>
        </div>

        <div
          data-reveal
          className="flex gap-3 rounded-2xl border bg-muted/40 p-5 text-sm"
        >
          <Info className="mt-0.5 size-4 shrink-0 text-brand" />
          <p className="leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              Frais de transport non inclus.
            </span>{" "}
            Vous fournissez votre étiquette (celle de Vinted, par exemple). Un
            retour à votre domicile coûte {returnCredits} crédit
            {returnCredits > 1 ? "s" : ""}, avec votre propre bordereau prépayé.
            {addressDeliveryCredits > 0 &&
              ` Une commande livrée à une adresse (poste restante) coûte ${addressDeliveryCredits} crédit${addressDeliveryCredits > 1 ? "s" : ""} de plus ; points relais et lockers : sans supplément.`}
          </p>
        </div>
      </Container>
    </section>
  );
}

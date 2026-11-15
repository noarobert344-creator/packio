/**
 * Périodicités de facturation (utilisable côté client et serveur).
 * La formule annuelle est facturée en une fois ; les crédits restent
 * distribués chaque mois.
 */

export type BillingIntervalValue = "MONTHLY" | "YEARLY";

/** Durée d'une période de facturation Whop, en jours. */
export const BILLING_PERIOD_DAYS: Record<BillingIntervalValue, number> = { MONTHLY: 30, YEARLY: 365 };

/** Nombre de distributions mensuelles de crédits sur une période annuelle. */
export const MONTHS_PER_YEAR = 12;

type PlanPrices = { priceCents: number; annualPriceCents: number | null };

export function intervalFromParam(value: string | null | undefined): BillingIntervalValue {
  return value === "annuel" || value === "YEARLY" ? "YEARLY" : "MONTHLY";
}

export function intervalParam(interval: BillingIntervalValue) {
  return interval === "YEARLY" ? "annuel" : "mensuel";
}

export function intervalLabel(interval: BillingIntervalValue) {
  return interval === "YEARLY" ? "Annuel" : "Mensuel";
}

export function hasAnnualOffer(plan: PlanPrices): plan is { priceCents: number; annualPriceCents: number } {
  return typeof plan.annualPriceCents === "number" && plan.annualPriceCents > 0;
}

/** Prix facturé pour la périodicité (null si la formule annuelle n'est pas proposée). */
export function priceFor(plan: PlanPrices, interval: BillingIntervalValue): number | null {
  if (interval === "MONTHLY") return plan.priceCents;
  return hasAnnualOffer(plan) ? plan.annualPriceCents : null;
}

/** Équivalent mensuel, utile pour comparer et pour le revenu récurrent mensuel. */
export function monthlyEquivalentCents(plan: PlanPrices, interval: BillingIntervalValue): number {
  if (interval === "YEARLY" && hasAnnualOffer(plan)) return Math.round(plan.annualPriceCents / MONTHS_PER_YEAR);
  return plan.priceCents;
}

/** Économie de la formule annuelle par rapport à 12 mensualités. */
export function annualSavings(plan: PlanPrices): { savedCents: number; percent: number; freeMonths: number | null } | null {
  if (!hasAnnualOffer(plan)) return null;
  const savedCents = plan.priceCents * MONTHS_PER_YEAR - plan.annualPriceCents;
  if (savedCents <= 0) return null;
  const months = savedCents / plan.priceCents;
  const freeMonths = Math.abs(months - Math.round(months)) < 0.01 && Math.round(months) >= 1 ? Math.round(months) : null;
  return { savedCents, percent: Math.round((savedCents / (plan.priceCents * MONTHS_PER_YEAR)) * 100), freeMonths };
}

/** Libellé court de l'avantage annuel : « 1 mois offert » ou « −15 % ». */
export function annualSavingsLabel(plan: PlanPrices): string | null {
  const s = annualSavings(plan);
  if (!s) return null;
  return s.freeMonths ? `${s.freeMonths} mois offert${s.freeMonths > 1 ? "s" : ""}` : `−${s.percent} %`;
}

/** Avantage commun à toutes les offres (« 1 mois offert »), sinon le meilleur pourcentage. */
export function commonAnnualBadge(plans: PlanPrices[]): string | null {
  const labels = plans.map(annualSavingsLabel);
  const present = labels.filter((l): l is string => !!l);
  if (!present.length) return null;
  if (present.length === labels.length && present.every((l) => l === present[0])) return present[0];
  const best = Math.max(...plans.map((p) => annualSavings(p)?.percent ?? 0));
  return best > 0 ? `jusqu'à −${best} %` : null;
}

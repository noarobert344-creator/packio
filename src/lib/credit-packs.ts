/** Quantités de crédits supplémentaires proposées à l'achat. */
export const CREDIT_PACK_SIZES = [10, 30, 50, 100] as const;

export type CreditPackSize = (typeof CREDIT_PACK_SIZES)[number];

export function isCreditPackSize(n: number): n is CreditPackSize {
  return (CREDIT_PACK_SIZES as readonly number[]).includes(n);
}

/**
 * Prix minimum d'un crédit vendu à l'unité de compte mensuelle (abonnement
 * mensuel ou recharge) : 1,90 €. La formule annuelle (1 mois offert) peut
 * descendre en dessous.
 */
export const MIN_CREDIT_PRICE_CENTS = 190;

export function pricePerCreditCents(priceCents: number, credits: number) {
  return credits > 0 ? priceCents / credits : Infinity;
}

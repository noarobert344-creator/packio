/** Quantités de crédits supplémentaires proposées à l'achat. */
export const CREDIT_PACK_SIZES = [10, 30, 50, 100] as const;

export type CreditPackSize = (typeof CREDIT_PACK_SIZES)[number];

export function isCreditPackSize(n: number): n is CreditPackSize {
  return (CREDIT_PACK_SIZES as readonly number[]).includes(n);
}

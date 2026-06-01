import { roundMoney } from '@finance-tracker/domain';

/**
 * Convert an amount expressed in a receipt's original currency to EUR using the
 * stored per-receipt fx rate. Mirrors the `total_eur` derivation in the domain
 * factories so the Insights charts line up with the persisted EUR totals.
 */
export function toEur(amountOrig: number, fxRateEur: number): number {
  return roundMoney(amountOrig / fxRateEur);
}

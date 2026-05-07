// Decimal precision rules — single source of truth for the rounding-on-write contract.
// See docs/data-model.md §Гроші.

export const MONEY_DECIMALS = 2;
export const QTY_DECIMALS = 3;
export const FX_RATE_DECIMALS = 6;

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function roundMoney(value: number): number {
  return round(value, MONEY_DECIMALS);
}

export function roundQty(value: number): number {
  return round(value, QTY_DECIMALS);
}

export function roundFxRate(value: number): number {
  return round(value, FX_RATE_DECIMALS);
}

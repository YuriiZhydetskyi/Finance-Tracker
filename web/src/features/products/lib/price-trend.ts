import type { PricePoint } from '../api/use-price-history';

export type PriceTrend = {
  first: number;
  latest: number;
  averageNet: number;
  changePct: number;
};

/**
 * Summary stats for the price-history chart header.
 *
 * The very first sample is the product's introductory price and tends to skew
 * the baseline (launch promos, opening-week discounts), so we drop it before
 * computing the trend.
 */
export function computePriceTrend(points: PricePoint[]): PriceTrend {
  const series = points.slice(1);

  const first = series[0]?.price_orig ?? 0;
  const latest = series[series.length - 1]?.price_orig ?? 0;

  const sum = series.reduce((acc, p) => acc + p.price_net, 0);
  const averageNet = sum / series.length;

  const changePct = ((latest - first) / first) * 100;

  return { first, latest, averageNet, changePct };
}

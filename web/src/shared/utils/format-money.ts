// Display formatter for currency amounts. NOT a rounding utility — that's
// `roundMoney` in @finance-tracker/domain, used at write-time in factories.
// This is purely for UI display.

const FORMATTER_CACHE = new Map<string, Intl.NumberFormat>();

export function formatMoney(value: number, currency = 'EUR', locale = 'uk-UA'): string {
  const key = `${locale}|${currency}`;
  let fmt = FORMATTER_CACHE.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    FORMATTER_CACHE.set(key, fmt);
  }
  return fmt.format(value);
}

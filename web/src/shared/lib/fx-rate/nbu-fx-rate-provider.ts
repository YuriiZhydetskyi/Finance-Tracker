import { roundFxRate } from '@finance-tracker/domain';
import type { IFxRateProvider } from './fx-rate.types';

// NBU exchange-rate API. Public, CORS-open, no key required.
// Response: [{ "r030": 978, "txt": "Євро", "rate": 44.6531, "cc": "EUR", "exchangedate": "DD.MM.YYYY" }]
// `rate` is EUR-to-UAH (1 EUR = N UAH). We invert → UAH-to-EUR.

const NBU_URL = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange';
const MAX_LOOKBACK_DAYS = 7;

export type NbuRateRow = {
  r030?: number;
  txt?: string;
  rate?: number;
  cc?: string;
  exchangedate?: string;
};

/** Date → 'YYYYMMDD' for the NBU URL `date=` parameter. */
function formatNbuDate(date: Date): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

type CrossCurrency = 'PLN' | 'USD';

function isCrossCurrency(currency: string): currency is CrossCurrency {
  return currency === 'PLN' || currency === 'USD';
}

async function fetchNbuRateOnDate(
  valcode: 'EUR' | CrossCurrency,
  date: Date,
): Promise<number | null> {
  let response: Response;
  try {
    response = await fetch(`${NBU_URL}?valcode=${valcode}&date=${formatNbuDate(date)}&json`);
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return null;
  }

  if (!Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as NbuRateRow;
  return typeof row.rate === 'number' && row.rate > 0 ? row.rate : null;
}

// NBU quotes everything against UAH, so EUR per UAH is 1 / rate(EUR) and
// EUR per PLN or USD is rate(X) / rate(EUR) taken on the same day.
async function fetchNbuRate(currency: 'UAH' | CrossCurrency, dateIso: string): Promise<number> {
  const target = new Date(`${dateIso}T00:00:00`);
  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    const d = new Date(target);
    d.setDate(target.getDate() - i);

    const eurRate = await fetchNbuRateOnDate('EUR', d);
    if (eurRate === null) continue;
    if (currency === 'UAH') return roundFxRate(1 / eurRate);
    const crossRate = await fetchNbuRateOnDate(currency, d);
    if (crossRate !== null) return roundFxRate(crossRate / eurRate);
  }

  throw new Error(
    `No NBU ${currency} rate found for ${dateIso} (or any of the ${String(MAX_LOOKBACK_DAYS)} prior days). ` +
      'NBU may be down or your date is too far in the past.',
  );
}

export const nbuFxRateProvider: IFxRateProvider = {
  async getRateLive(currency, dateIso) {
    if (currency === 'EUR') return 1.0;
    if (currency === 'UAH' || isCrossCurrency(currency)) return fetchNbuRate(currency, dateIso);
    throw new Error(
      `FX lookup not supported for "${currency}". Only EUR (base), UAH, PLN and USD are supported. ` +
        'Add another provider or extend nbu-fx-rate-provider.ts.',
    );
  },
};

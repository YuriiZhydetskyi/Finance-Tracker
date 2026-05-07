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

async function fetchNbuUahRate(dateIso: string): Promise<number> {
  const target = new Date(`${dateIso}T00:00:00`);
  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    const d = new Date(target);
    d.setDate(target.getDate() - i);
    const url = `${NBU_URL}?valcode=EUR&date=${formatNbuDate(d)}&json`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      continue;
    }
    if (!response.ok) continue;

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      continue;
    }

    if (!Array.isArray(data) || data.length === 0) continue;
    const row = data[0] as NbuRateRow;
    if (typeof row.rate !== 'number' || row.rate <= 0) continue;
    return roundFxRate(1 / row.rate);
  }

  throw new Error(
    `No NBU UAH rate found for ${dateIso} (or any of the ${String(MAX_LOOKBACK_DAYS)} prior days). ` +
      'NBU may be down or your date is too far in the past.',
  );
}

export const nbuFxRateProvider: IFxRateProvider = {
  async getRateLive(currency, dateIso) {
    if (currency === 'EUR') return 1.0;
    if (currency === 'UAH') return fetchNbuUahRate(dateIso);
    throw new Error(
      `FX lookup not supported for "${currency}". Only EUR (base) and UAH are supported. ` +
        'Add another provider or extend nbu-fx-rate-provider.ts.',
    );
  },
};

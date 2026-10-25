const NBU_URL = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange';
const MAX_LOOKBACK_DAYS = 7;

// NBU quotes every currency against UAH (`rate` = UAH per 1 unit), so EUR per UAH
// is 1 / rate(EUR) and EUR per PLN is rate(PLN) / rate(EUR).
async function nbuRate(
  fetchImpl: typeof fetch,
  valcode: 'EUR' | 'PLN',
  compactDate: string,
): Promise<number | null> {
  const response = await fetchImpl(`${NBU_URL}?valcode=${valcode}&date=${compactDate}&json`);
  if (!response.ok) return null;
  const rows = (await response.json()) as { rate?: number }[];
  const rate = rows[0]?.rate;
  return typeof rate === 'number' && rate > 0 ? rate : null;
}

export async function getFxRate(
  fetchImpl: typeof fetch,
  currency: string,
  dateIso: string | null,
): Promise<number> {
  if (currency === 'EUR') return 1;
  if ((currency !== 'UAH' && currency !== 'PLN') || !dateIso) {
    throw new Error('Unsupported currency or date');
  }
  const target = new Date(`${dateIso}T00:00:00Z`);
  for (let offset = 0; offset < MAX_LOOKBACK_DAYS; offset += 1) {
    const date = new Date(target);
    date.setUTCDate(date.getUTCDate() - offset);
    const compact = date.toISOString().slice(0, 10).replaceAll('-', '');
    const eurRate = await nbuRate(fetchImpl, 'EUR', compact);
    if (eurRate === null) continue;
    if (currency === 'UAH') return Math.round((1 / eurRate) * 1e6) / 1e6;
    const plnRate = await nbuRate(fetchImpl, 'PLN', compact);
    if (plnRate !== null) return Math.round((plnRate / eurRate) * 1e6) / 1e6;
  }
  throw new Error('NBU rate unavailable');
}

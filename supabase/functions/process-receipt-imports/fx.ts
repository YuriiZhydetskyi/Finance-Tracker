export async function getFxRate(
  fetchImpl: typeof fetch,
  currency: string,
  dateIso: string | null,
): Promise<number> {
  if (currency === 'EUR') return 1;
  if (currency !== 'UAH' || !dateIso) throw new Error('Unsupported currency or date');
  const target = new Date(`${dateIso}T00:00:00Z`);
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(target);
    date.setUTCDate(date.getUTCDate() - offset);
    const compact = date.toISOString().slice(0, 10).replaceAll('-', '');
    const response = await fetchImpl(
      `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&date=${compact}&json`,
    );
    if (!response.ok) continue;
    const rows = (await response.json()) as { rate?: number }[];
    const rate = rows[0]?.rate;
    if (typeof rate === 'number' && rate > 0) return Math.round((1 / rate) * 1e6) / 1e6;
  }
  throw new Error('NBU rate unavailable');
}

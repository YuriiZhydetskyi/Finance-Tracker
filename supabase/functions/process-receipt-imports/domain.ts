import type { BulkParsedDocument, ParsedItem } from '../parse-receipt/types.ts';

export type FinalizedReceipt = {
  receipt: Record<string, string | number | null>;
  items: Record<string, string | number | null>[];
};

export type ValidationResult =
  | { ok: true; value: FinalizedReceipt }
  | { ok: false; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{2}:\d{2}(:\d{2})?$/;

export function validateBulkDocument(value: unknown): BulkParsedDocument {
  if (!value || typeof value !== 'object') throw new Error('AI result is not an object');
  const row = value as Record<string, unknown>;
  if (!['receipt', 'not_receipt', 'uncertain'].includes(String(row.document_kind))) {
    throw new Error('AI result has invalid document_kind');
  }
  if (!Array.isArray(row.items)) throw new Error('AI result has no items array');

  const documentKind = row.document_kind as BulkParsedDocument['document_kind'];
  if (documentKind !== 'receipt') {
    return {
      document_kind: documentKind,
      classification_reason:
        typeof row.classification_reason === 'string'
          ? row.classification_reason.slice(0, 500)
          : '',
      store: typeof row.store === 'string' ? row.store.trim() : null,
      store_address: typeof row.store_address === 'string' ? row.store_address.trim() : null,
      date: typeof row.date === 'string' ? row.date : null,
      time: typeof row.time === 'string' ? row.time : null,
      currency: typeof row.currency === 'string' ? row.currency.toUpperCase() : '',
      total_orig:
        typeof row.total_orig === 'number' && Number.isFinite(row.total_orig)
          ? row.total_orig
          : null,
      items: [],
    };
  }

  const items: ParsedItem[] = row.items.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Invalid item ${String(index + 1)}`);
    const it = item as Record<string, unknown>;
    if (typeof it.product_name !== 'string' || !it.product_name.trim()) {
      throw new Error(`Item ${String(index + 1)} has no name`);
    }
    if (typeof it.qty !== 'number' || !Number.isFinite(it.qty) || it.qty <= 0) {
      throw new Error(`Item ${String(index + 1)} has invalid quantity`);
    }
    if (typeof it.unit_price_orig !== 'number' || !Number.isFinite(it.unit_price_orig)) {
      throw new Error(`Item ${String(index + 1)} has invalid price`);
    }
    const discount = it.discount_orig;
    if (discount != null && (typeof discount !== 'number' || discount < 0)) {
      throw new Error(`Item ${String(index + 1)} has invalid discount`);
    }
    return {
      product_name: it.product_name.trim(),
      qty: it.qty,
      unit_price_orig: it.unit_price_orig,
      category_suggestion:
        typeof it.category_suggestion === 'string' ? it.category_suggestion : null,
      discount_orig: typeof discount === 'number' ? discount : 0,
      product_code: typeof it.product_code === 'string' ? it.product_code : null,
    };
  });

  return {
    document_kind: documentKind,
    classification_reason:
      typeof row.classification_reason === 'string' ? row.classification_reason.slice(0, 500) : '',
    store: typeof row.store === 'string' ? row.store.trim() : null,
    store_address: typeof row.store_address === 'string' ? row.store_address.trim() : null,
    date: typeof row.date === 'string' ? row.date : null,
    time: typeof row.time === 'string' ? row.time : null,
    currency: typeof row.currency === 'string' ? row.currency.toUpperCase() : '',
    total_orig:
      typeof row.total_orig === 'number' && Number.isFinite(row.total_orig) ? row.total_orig : null,
    items,
  };
}

export function prepareReceipt(
  parsed: BulkParsedDocument,
  fxRate: number,
  categories: ReadonlySet<string>,
  makeId: () => string,
  photoUrl: string | null,
): ValidationResult {
  if (parsed.document_kind !== 'receipt') {
    return {
      ok: false,
      reason: parsed.classification_reason || 'Документ не класифіковано як чек.',
    };
  }
  if (!parsed.store?.trim()) return { ok: false, reason: 'Не вдалося надійно прочитати продавця.' };
  if (!parsed.date || !ISO_DATE.test(parsed.date) || !isRealDate(parsed.date)) {
    return { ok: false, reason: 'Не вдалося надійно прочитати дату.' };
  }
  if (
    parsed.time != null &&
    parsed.time !== '' &&
    (!ISO_TIME.test(parsed.time) || !isRealTime(parsed.time))
  ) {
    return { ok: false, reason: 'Час має невірний формат.' };
  }
  if (!['EUR', 'UAH'].includes(parsed.currency)) {
    return { ok: false, reason: `Валюта ${parsed.currency || 'невідома'} не підтримується.` };
  }
  if (parsed.total_orig == null || !Number.isFinite(parsed.total_orig)) {
    return { ok: false, reason: 'Не вдалося надійно прочитати підсумок чека.' };
  }
  if (parsed.items.length === 0) return { ok: false, reason: 'У документі немає позицій.' };
  if (!Number.isFinite(fxRate) || fxRate <= 0) return { ok: false, reason: 'Не знайдено курс.' };

  const normalized = mergePairs(parsed.items);
  if (normalized.length === 0) return { ok: false, reason: 'Після перевірки не лишилося позицій.' };
  if (normalized.length > 500) return { ok: false, reason: 'У документі забагато позицій.' };
  for (const item of normalized) {
    const qty = round(item.qty, 3);
    const unitPrice = round(item.unit_price_orig, 2);
    const discount = round(item.discount_orig ?? 0, 2);
    if (qty <= 0) return { ok: false, reason: `Кількість для «${item.product_name}» надто мала.` };
    if (unitPrice > 0 && discount > unitPrice) {
      return { ok: false, reason: `Знижка для «${item.product_name}» більша за ціну.` };
    }
    if (Math.abs(qty * (unitPrice - discount)) > 9_999_999_999) {
      return { ok: false, reason: `Сума позиції «${item.product_name}» виходить за межі.` };
    }
  }
  const receiptId = makeId();
  const items = normalized.map((item) => {
    const qty = round(item.qty, 3);
    const unitPrice = round(item.unit_price_orig, 2);
    const discount = round(item.discount_orig ?? 0, 2);
    const totalOrig = round(qty * (unitPrice - discount), 2);
    return {
      id: makeId(),
      price_id: makeId(),
      product_candidate_id: makeId(),
      product_name: item.product_name,
      store_product_code: item.product_code?.trim() || null,
      category:
        item.category_suggestion && categories.has(item.category_suggestion)
          ? item.category_suggestion
          : 'Інше',
      qty,
      unit_price_orig: unitPrice,
      discount_orig: discount,
      total_orig: totalOrig,
      total_eur: round(totalOrig * fxRate, 2),
      price_net: round(unitPrice - discount, 2),
      note: null,
    };
  });
  const computed = round(
    items.reduce((sum, item) => sum + Number(item.total_orig), 0),
    2,
  );
  const printed = round(parsed.total_orig, 2);
  const tolerance = Math.max(0.05, Math.min(Math.abs(printed) * 0.005, 0.5));
  if (Math.abs(computed - printed) > tolerance) {
    return {
      ok: false,
      reason: `Сума позицій ${computed.toFixed(2)} не збігається з підсумком ${printed.toFixed(2)}.`,
    };
  }

  const raw = JSON.stringify(parsed);
  return {
    ok: true,
    value: {
      receipt: {
        id: receiptId,
        date: parsed.date,
        time: parsed.time ? (parsed.time.length === 5 ? `${parsed.time}:00` : parsed.time) : null,
        store: parsed.store.trim(),
        store_address: parsed.store_address?.trim() || null,
        currency: parsed.currency,
        total_orig: computed,
        fx_rate_eur: round(fxRate, 6),
        total_eur: round(computed * fxRate, 2),
        photo_url: photoUrl,
        raw_ocr_json: raw.length <= 45_000 ? raw : null,
      },
      items,
    },
  };
}

function mergePairs(items: ParsedItem[]): ParsedItem[] {
  const result = items.map((item) => ({ ...item }));
  const removed = new Set<number>();
  for (let negativeIndex = 0; negativeIndex < result.length; negativeIndex += 1) {
    const negative = result[negativeIndex];
    if (!negative || negative.unit_price_orig >= 0) continue;
    const positiveIndex = result.findIndex(
      (candidate, index) =>
        index !== negativeIndex &&
        !removed.has(index) &&
        candidate.unit_price_orig > 0 &&
        normalize(candidate.product_name) === normalize(negative.product_name) &&
        Math.abs(candidate.qty - negative.qty) <= 0.001,
    );
    if (positiveIndex < 0) continue;
    const positive = result[positiveIndex];
    if (!positive) continue;
    const positiveTotal = round(positive.qty * positive.unit_price_orig, 2);
    const negativeTotal = round(Math.abs(negative.qty * negative.unit_price_orig), 2);
    if (positiveTotal === negativeTotal) {
      positive.unit_price_orig = 0;
      positive.discount_orig = 0;
      removed.add(negativeIndex);
    } else if (positiveTotal > negativeTotal) {
      positive.discount_orig = round(Math.abs(negative.unit_price_orig), 2);
      removed.add(negativeIndex);
    }
  }
  return result.filter((_, index) => !removed.has(index));
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isRealDate(value: string): boolean {
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function isRealTime(value: string): boolean {
  const [hourText, minuteText, secondText = '0'] = value.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

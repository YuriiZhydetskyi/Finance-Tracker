import type { BulkParsedDocument, ParsedItem } from '../parse-receipt/types.ts';

export type FinalizedReceipt = {
  receipt: Record<string, string | number | null>;
  items: Record<string, string | number | null>[];
};

export type ValidationResult =
  | { ok: true; value: FinalizedReceipt }
  | { ok: false; reason: string };

export type ReceiptArithmeticCheck = {
  normalizedItems: ParsedItem[];
  computedTotal: number;
  printedTotal: number;
  tolerance: number;
  matches: boolean;
};

export type ReceiptArticleCountCheck = {
  printedCount: number;
  computedCount: number;
  missingCount: number;
  matches: boolean;
};

export type ReceiptEvidenceIssue = {
  code:
    | 'missing_total_evidence'
    | 'total_evidence_mismatch'
    | 'missing_article_count_evidence'
    | 'article_count_evidence_mismatch'
    | 'article_count_item_mismatch'
    | 'missing_row_evidence'
    | 'invalid_row_order'
    | 'unsupported_quantity'
    | 'line_total_mismatch';
  itemIndex: number | null;
  message: string;
};

export type ReceiptEvidenceAudit = {
  ok: boolean;
  issues: ReceiptEvidenceIssue[];
};

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
  const articleCount = parseArticleCount(row.article_count);
  const articleCountRawText =
    typeof row.article_count_raw_text === 'string'
      ? row.article_count_raw_text.trim().slice(0, 1000)
      : null;
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
      total_raw_text:
        typeof row.total_raw_text === 'string' ? row.total_raw_text.trim().slice(0, 1000) : null,
      article_count: articleCount,
      article_count_raw_text: articleCountRawText,
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
      source_ordinal:
        typeof it.source_ordinal === 'number' && Number.isInteger(it.source_ordinal)
          ? it.source_ordinal
          : undefined,
      raw_text: typeof it.raw_text === 'string' ? it.raw_text.trim().slice(0, 1000) : undefined,
      row_kind: isRowKind(it.row_kind) ? it.row_kind : undefined,
      qty_evidence: isQtyEvidence(it.qty_evidence) ? it.qty_evidence : undefined,
      printed_line_total_orig:
        it.printed_line_total_orig == null
          ? null
          : typeof it.printed_line_total_orig === 'number' &&
              Number.isFinite(it.printed_line_total_orig)
            ? it.printed_line_total_orig
            : undefined,
      tax_class: it.tax_class === '1' || it.tax_class === '2' ? it.tax_class : null,
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
    total_raw_text:
      typeof row.total_raw_text === 'string' ? row.total_raw_text.trim().slice(0, 1000) : null,
    article_count: articleCount,
    article_count_raw_text: articleCountRawText,
    items,
  };
}

export function auditReceiptEvidence(parsed: BulkParsedDocument): ReceiptEvidenceAudit {
  const issues: ReceiptEvidenceIssue[] = [];
  if (!parsed.total_raw_text?.trim()) {
    issues.push({
      code: 'missing_total_evidence',
      itemIndex: null,
      message: 'Модель не навела текст рядка з підсумком чека.',
    });
  } else if (
    parsed.total_orig != null &&
    !amountAppearsInText(parsed.total_raw_text, parsed.total_orig)
  ) {
    issues.push({
      code: 'total_evidence_mismatch',
      itemIndex: null,
      message: 'Розпізнаний підсумок не знайдено в наведеному тексті підсумкового рядка.',
    });
  }

  if (parsed.article_count != null) {
    if (!parsed.article_count_raw_text?.trim()) {
      issues.push({
        code: 'missing_article_count_evidence',
        itemIndex: null,
        message: 'Модель не навела текст рядка з надрукованою кількістю товарів.',
      });
    } else if (!integerAppearsInText(parsed.article_count_raw_text, parsed.article_count)) {
      issues.push({
        code: 'article_count_evidence_mismatch',
        itemIndex: null,
        message: 'Розпізнану кількість товарів не знайдено в наведеному тексті чека.',
      });
    }
  }

  const ordinals: number[] = [];
  parsed.items.forEach((item, itemIndex) => {
    if (
      item.source_ordinal == null ||
      !item.raw_text?.trim() ||
      !item.row_kind ||
      !item.qty_evidence
    ) {
      issues.push({
        code: 'missing_row_evidence',
        itemIndex,
        message: `Для позиції ${String(itemIndex + 1)} бракує посилання на видимий рядок.`,
      });
      return;
    }
    ordinals.push(item.source_ordinal);

    const quantityIsSupported =
      item.qty_evidence === 'implicit_one'
        ? Math.abs(item.qty - 1) <= 0.001
        : item.qty_evidence === 'explicit_multiplier'
          ? hasExplicitMultiplier(item.raw_text, item.qty)
          : hasWeightOrVolume(item.raw_text);
    if (!quantityIsSupported) {
      issues.push({
        code: 'unsupported_quantity',
        itemIndex,
        message: `Кількість позиції ${String(itemIndex + 1)} не підтверджена наведеним текстом рядка.`,
      });
    }

    if (item.printed_line_total_orig != null) {
      const computed = round(item.qty * (item.unit_price_orig - (item.discount_orig ?? 0)), 2);
      if (Math.abs(computed - round(item.printed_line_total_orig, 2)) > 0.02) {
        issues.push({
          code: 'line_total_mismatch',
          itemIndex,
          message: `Розрахунок позиції ${String(itemIndex + 1)} не збігається з надрукованою сумою рядка.`,
        });
      }
    }
  });

  const ordered = [...ordinals].sort((left, right) => left - right);
  if (
    ordered.length !== parsed.items.length ||
    ordered.some((ordinal, index) => ordinal !== index + 1)
  ) {
    issues.push({
      code: 'invalid_row_order',
      itemIndex: null,
      message: 'Нумерація розпізнаних рядків має пропуски або дублікати.',
    });
  }

  const articleCount = checkReceiptArticleCount(parsed);
  if (articleCount && !articleCount.matches) {
    issues.push({
      code: 'article_count_item_mismatch',
      itemIndex: null,
      message: `На чеку надруковано ${String(articleCount.printedCount)} товарів, але розпізнано ${String(articleCount.computedCount)}.`,
    });
  }

  return { ok: issues.length === 0, issues };
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

  const arithmetic = checkReceiptArithmetic(parsed);
  if (!arithmetic) return { ok: false, reason: 'Не вдалося перевірити арифметику чека.' };
  const normalized = arithmetic.normalizedItems;
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
  const computed = arithmetic.computedTotal;
  if (!arithmetic.matches) {
    return {
      ok: false,
      reason: `Сума позицій ${computed.toFixed(2)} не збігається з підсумком ${arithmetic.printedTotal.toFixed(2)}.`,
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

export function checkReceiptArithmetic(parsed: BulkParsedDocument): ReceiptArithmeticCheck | null {
  if (
    parsed.document_kind !== 'receipt' ||
    parsed.total_orig == null ||
    !Number.isFinite(parsed.total_orig)
  ) {
    return null;
  }
  const normalizedItems = mergePairs(parsed.items);
  const computedTotal = round(
    normalizedItems.reduce((sum, item) => {
      const qty = round(item.qty, 3);
      const unitPrice = round(item.unit_price_orig, 2);
      const discount = round(item.discount_orig ?? 0, 2);
      return sum + round(qty * (unitPrice - discount), 2);
    }, 0),
    2,
  );
  const printedTotal = round(parsed.total_orig, 2);
  // Receipts are accounting documents rounded per printed row. A percentage
  // tolerance can hide a genuinely omitted low-value item on a large receipt.
  const tolerance = 0.02;
  return {
    normalizedItems,
    computedTotal,
    printedTotal,
    tolerance,
    matches: Math.abs(computedTotal - printedTotal) <= tolerance,
  };
}

export function checkReceiptArticleCount(
  parsed: BulkParsedDocument,
): ReceiptArticleCountCheck | null {
  if (
    parsed.document_kind !== 'receipt' ||
    parsed.article_count == null ||
    !Number.isInteger(parsed.article_count) ||
    parsed.article_count < 0
  ) {
    return null;
  }
  const normalizedItems = mergePairs(parsed.items);
  const computedCount = normalizedItems.reduce((sum, item) => {
    if (item.unit_price_orig <= 0) return sum;
    if (item.qty_evidence === 'explicit_multiplier' && Number.isInteger(item.qty)) {
      return sum + item.qty;
    }
    return sum + 1;
  }, 0);
  return {
    printedCount: parsed.article_count,
    computedCount,
    missingCount: parsed.article_count - computedCount,
    matches: parsed.article_count === computedCount,
  };
}

function mergePairs(items: ParsedItem[]): ParsedItem[] {
  const result = items.map((item) => ({ ...item }));
  const removed = new Set<number>();
  const groups = groupItemIndices(result);

  for (const indices of groups.values()) {
    const positives = indices.filter((index) => isSignedPrice(result[index], 1));
    const negatives = indices.filter((index) => isSignedPrice(result[index], -1));
    const claimed = new Set<number>();

    // Exact cancellations must claim first; otherwise a cancellation could be
    // consumed as a partial discount. Both passes share the same claimed set.
    claimPairPass(result, positives, negatives, claimed, removed, 'cancellation');
    claimPairPass(result, positives, negatives, claimed, removed, 'discount');
  }
  return result.filter((_, index) => !removed.has(index));
}

function groupItemIndices(items: ParsedItem[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  items.forEach((item, index) => {
    const key = normalize(item.product_name);
    if (!key) return;
    const indices = groups.get(key);
    if (indices) indices.push(index);
    else groups.set(key, [index]);
  });
  return groups;
}

type PairPass = 'cancellation' | 'discount';

function claimPairPass(
  items: ParsedItem[],
  positiveIndices: number[],
  negativeIndices: number[],
  claimed: Set<number>,
  removed: Set<number>,
  pass: PairPass,
): void {
  for (const negativeIndex of negativeIndices) {
    if (claimed.has(negativeIndex)) continue;
    const negative = items[negativeIndex];
    if (!negative) continue;
    const positiveIndex = positiveIndices.find((candidateIndex) =>
      isPairCandidate(items[candidateIndex], negative, claimed.has(candidateIndex), pass),
    );
    if (positiveIndex === undefined) continue;
    const positive = items[positiveIndex];
    if (!positive) continue;

    claimed.add(positiveIndex);
    claimed.add(negativeIndex);
    removed.add(negativeIndex);
    if (pass === 'cancellation') {
      positive.unit_price_orig = 0;
      positive.discount_orig = 0;
    } else {
      positive.discount_orig = round(Math.abs(negative.unit_price_orig), 2);
    }
  }
}

function isPairCandidate(
  positive: ParsedItem | undefined,
  negative: ParsedItem,
  alreadyClaimed: boolean,
  pass: PairPass,
): boolean {
  if (!positive || alreadyClaimed || Math.abs(positive.qty - negative.qty) > 0.001) return false;
  const positiveTotal = grossLineTotal(positive);
  const negativeTotal = grossLineTotal(negative);
  return pass === 'cancellation' ? positiveTotal === negativeTotal : positiveTotal > negativeTotal;
}

function grossLineTotal(item: ParsedItem): number {
  return round(Math.abs(item.qty * item.unit_price_orig), 2);
}

function isSignedPrice(item: ParsedItem | undefined, sign: 1 | -1): boolean {
  return sign * (item?.unit_price_orig ?? 0) > 0;
}

const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF]/g;

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

function isRowKind(value: unknown): value is NonNullable<ParsedItem['row_kind']> {
  return ['item', 'discount', 'deposit', 'refund', 'cancellation'].includes(String(value));
}

function isQtyEvidence(value: unknown): value is NonNullable<ParsedItem['qty_evidence']> {
  return ['implicit_one', 'explicit_multiplier', 'weight_or_volume'].includes(String(value));
}

function parseArticleCount(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('AI result has invalid article_count');
  }
  return value;
}

function amountAppearsInText(text: string, amount: number): boolean {
  const absolute = Math.abs(round(amount, 2)).toFixed(2);
  const variants = [absolute, absolute.replace('.', ',')];
  const compactText = text.replace(/\s/g, '');
  return variants.some((variant) => compactText.includes(variant));
}

function integerAppearsInText(text: string, value: number): boolean {
  return new RegExp(`(?:^|\\D)${String(value)}(?:\\D|$)`, 'u').test(text);
}

function hasExplicitMultiplier(text: string, qty: number): boolean {
  const rawQty = String(round(qty, 3)).replace('.', '[.,]');
  const quantityPattern = new RegExp(
    `(?:^|\\s)(?:${rawQty}\\s*(?:x|×|stk\\.?|st\\.?|pcs)|(?:x|×)\\s*${rawQty})(?:\\s|$)`,
    'iu',
  );
  return quantityPattern.test(text);
}

function hasWeightOrVolume(text: string): boolean {
  return /(?:^|\s)\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml)(?:\s|$)/iu.test(text);
}

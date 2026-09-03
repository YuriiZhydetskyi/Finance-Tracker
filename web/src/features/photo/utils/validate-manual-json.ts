import { roundMoney, roundQty, type ParsedReceipt } from '@finance-tracker/domain';

const MONEY_TOLERANCE = 0.02;
const ROW_KINDS = new Set(['item', 'deposit', 'discount', 'refund', 'cancellation']);
const QTY_EVIDENCE = new Set(['implicit_one', 'explicit_multiplier', 'weight_or_volume']);

type JsonRecord = Record<string, unknown>;

export type ManualJsonValidationOptions = {
  requireEvidence?: boolean;
  requireSavableReceipt?: boolean;
  expectedTotalOrig?: number | null;
  expectedArticleCount?: number | null;
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function formatMoney(value: number, currency: string): string {
  return value.toFixed(2).replace('.', ',') + ' ' + currency;
}

function itemTotal(item: ParsedReceipt['items'][number]): number {
  const qty = roundQty(item.qty);
  const unitPrice = roundMoney(item.unit_price_orig);
  const discount = roundMoney(item.discount_orig ?? 0);
  return roundMoney(qty * (unitPrice - discount));
}

/**
 * Validates pasted AI data before it can enter either review or the durable
 * import queue. Batch resolution requires row-level evidence; standalone
 * photo review keeps evidence optional because the user reviews every field.
 */
export function validateManualJsonReceipt(
  candidate: unknown,
  receipt: ParsedReceipt,
  options: ManualJsonValidationOptions = {},
): string[] {
  const issues: string[] = [];
  const record = asRecord(candidate);
  const rawItems = Array.isArray(record?.items) ? record.items : [];
  const accountingItems = mergeAccountingPairs(receipt.items);

  if (receipt.items.length === 0) {
    issues.push('JSON не містить позицій, тому чек неможливо перевірити.');
    return issues;
  }

  if (options.requireSavableReceipt) {
    if (!receipt.store?.trim()) issues.push('Не вказано продавця store.');
    if (!receipt.date) issues.push('Не вказано дату date.');
    if (!['EUR', 'UAH'].includes(receipt.currency)) {
      issues.push('Валюта ' + receipt.currency + ' не підтримується для автоматичного збереження.');
    }
  }

  validateReceiptTotal(record, receipt, accountingItems, options, issues);
  validateReceiptEvidence(record, receipt, options, issues);

  rawItems.forEach((rawItem, index) => {
    const raw = asRecord(rawItem);
    const parsedItem = receipt.items[index];
    if (!raw || !parsedItem) return;
    validateRowEvidence(raw, parsedItem, index, receipt.currency, options, issues);
  });

  validateArticleCount(record, accountingItems, receipt, options, issues);
  validateSourceOrdinals(rawItems, options.requireEvidence === true, issues);
  return issues;
}

function validateReceiptTotal(
  record: JsonRecord | null,
  receipt: ParsedReceipt,
  items: ParsedReceipt['items'],
  options: ManualJsonValidationOptions,
  issues: string[],
): void {
  if (receipt.total_orig == null) {
    issues.push('У JSON немає підсумкової суми total_orig, тому чек неможливо перевірити.');
    return;
  }

  const computedTotal = roundMoney(items.reduce((sum, item) => sum + itemTotal(item), 0));
  const printedTotal = roundMoney(receipt.total_orig);
  const difference = roundMoney(computedTotal - printedTotal);
  if (Math.abs(difference) > MONEY_TOLERANCE) {
    issues.push(
      'Сума позицій ' +
        formatMoney(computedTotal, receipt.currency) +
        ' не збігається з total_orig ' +
        formatMoney(printedTotal, receipt.currency) +
        ' (різниця ' +
        formatMoney(Math.abs(difference), receipt.currency) +
        ').',
    );
  }

  if (
    options.expectedTotalOrig != null &&
    Math.abs(printedTotal - roundMoney(options.expectedTotalOrig)) > MONEY_TOLERANCE
  ) {
    issues.push(
      'total_orig ' +
        formatMoney(printedTotal, receipt.currency) +
        ' не збігається з раніше прочитаним підсумком ' +
        formatMoney(roundMoney(options.expectedTotalOrig), receipt.currency) +
        '.',
    );
  }

  const totalRawText = record?.total_raw_text;
  if (options.requireEvidence && (typeof totalRawText !== 'string' || !totalRawText.trim())) {
    issues.push('Додай total_raw_text — дослівний рядок чека з фінальним підсумком.');
  } else if (
    typeof totalRawText === 'string' &&
    totalRawText.trim() &&
    !amountAppearsInText(totalRawText, printedTotal)
  ) {
    issues.push('total_raw_text не містить значення total_orig.');
  }
}

function validateReceiptEvidence(
  record: JsonRecord | null,
  receipt: ParsedReceipt,
  options: ManualJsonValidationOptions,
  issues: string[],
): void {
  if (options.expectedArticleCount != null) {
    if (receipt.article_count == null) {
      issues.push(
        'Додай article_count: попередній аналіз прочитав ' +
          String(options.expectedArticleCount) +
          ' товарів.',
      );
    } else if (receipt.article_count !== options.expectedArticleCount) {
      issues.push(
        'article_count вказує ' +
          String(receipt.article_count) +
          ', але попередній аналіз прочитав ' +
          String(options.expectedArticleCount) +
          '.',
      );
    }
  }

  if (receipt.article_count == null) return;
  const rawText = record?.article_count_raw_text;
  if (options.requireEvidence && (typeof rawText !== 'string' || !rawText.trim())) {
    issues.push('Додай article_count_raw_text — дослівний рядок із кількістю товарів.');
  } else if (
    typeof rawText === 'string' &&
    rawText.trim() &&
    !integerAppearsInText(rawText, receipt.article_count)
  ) {
    issues.push('article_count_raw_text не містить значення article_count.');
  }
}

function validateRowEvidence(
  raw: JsonRecord,
  item: ParsedReceipt['items'][number],
  index: number,
  currency: string,
  options: ManualJsonValidationOptions,
  issues: string[],
): void {
  const rowNumber = index + 1;
  const rowKind = raw.row_kind;
  if (options.requireEvidence && rowKind == null) {
    issues.push('Рядок ' + String(rowNumber) + ': додай row_kind.');
  } else if (rowKind != null && (typeof rowKind !== 'string' || !ROW_KINDS.has(rowKind))) {
    issues.push('Рядок ' + String(rowNumber) + ': невідомий row_kind.');
  }

  const qtyEvidence = raw.qty_evidence;
  if (options.requireEvidence && qtyEvidence == null) {
    issues.push('Рядок ' + String(rowNumber) + ': додай qty_evidence.');
  } else if (
    qtyEvidence != null &&
    (typeof qtyEvidence !== 'string' || !QTY_EVIDENCE.has(qtyEvidence))
  ) {
    issues.push('Рядок ' + String(rowNumber) + ': невідомий qty_evidence.');
  }

  const rawText = raw.raw_text;
  if (options.requireEvidence && (typeof rawText !== 'string' || !rawText.trim())) {
    issues.push('Рядок ' + String(rowNumber) + ': додай raw_text із дослівним текстом позиції.');
  }
  if (typeof rawText === 'string' && typeof qtyEvidence === 'string') {
    const quantitySupported =
      qtyEvidence === 'implicit_one'
        ? Math.abs(item.qty - 1) <= 0.001
        : qtyEvidence === 'explicit_multiplier'
          ? hasExplicitMultiplier(rawText, item.qty)
          : hasWeightOrVolume(rawText);
    if (!quantitySupported) {
      issues.push(
        'Рядок ' + String(rowNumber) + ': qty не підтверджується raw_text і qty_evidence.',
      );
    }
  }

  const hasPrintedLineTotal = Object.hasOwn(raw, 'printed_line_total_orig');
  const printedLineTotal = raw.printed_line_total_orig;
  if (
    options.requireEvidence &&
    (!hasPrintedLineTotal ||
      typeof printedLineTotal !== 'number' ||
      !Number.isFinite(printedLineTotal))
  ) {
    issues.push('Рядок ' + String(rowNumber) + ': додай числовий printed_line_total_orig.');
    return;
  }
  if (!hasPrintedLineTotal) return;
  if (typeof printedLineTotal !== 'number' || !Number.isFinite(printedLineTotal)) {
    issues.push('Рядок ' + String(rowNumber) + ': printed_line_total_orig має бути числом.');
    return;
  }

  const computedLineTotal = itemTotal(item);
  if (Math.abs(computedLineTotal - roundMoney(printedLineTotal)) > MONEY_TOLERANCE) {
    issues.push(
      'Рядок ' +
        String(rowNumber) +
        ': сума ' +
        formatMoney(computedLineTotal, currency) +
        ' не збігається з printed_line_total_orig ' +
        formatMoney(roundMoney(printedLineTotal), currency) +
        '.',
    );
  }
  if (
    typeof rawText === 'string' &&
    rawText.trim() &&
    !amountAppearsInText(rawText, printedLineTotal)
  ) {
    issues.push('Рядок ' + String(rowNumber) + ': raw_text не містить printed_line_total_orig.');
  }
}

function validateArticleCount(
  record: JsonRecord | null,
  items: ParsedReceipt['items'],
  receipt: ParsedReceipt,
  options: ManualJsonValidationOptions,
  issues: string[],
): void {
  if (!record || !Object.hasOwn(record, 'article_count') || receipt.article_count == null) {
    if (options.requireEvidence && options.expectedArticleCount == null) {
      issues.push('Додай article_count або null, якщо на чеку немає лічильника товарів.');
    }
    return;
  }

  const computedCount = items.reduce((count, item) => {
    if (item.unit_price_orig <= 0) return count;
    if (item.qty_evidence === 'explicit_multiplier' && Number.isInteger(item.qty)) {
      return count + item.qty;
    }
    return count + 1;
  }, 0);

  if (computedCount !== receipt.article_count) {
    issues.push(
      'article_count вказує ' +
        String(receipt.article_count) +
        ' товарів, але в JSON розпізнано ' +
        String(computedCount) +
        '.',
    );
  }
}

function validateSourceOrdinals(rawItems: unknown[], required: boolean, issues: string[]): void {
  const itemsWithOrdinal = rawItems
    .map((rawItem, index) => ({ raw: asRecord(rawItem), index }))
    .filter(({ raw }) => raw && Object.hasOwn(raw, 'source_ordinal'));

  if (itemsWithOrdinal.length === 0) {
    if (required) issues.push('Додай source_ordinal у кожний рядок.');
    return;
  }
  if (itemsWithOrdinal.length !== rawItems.length) {
    issues.push('Якщо вказано source_ordinal, він має бути у кожному рядку.');
    return;
  }

  const ordinals = new Set<number>();
  let hasInvalidOrdinal = false;
  for (const { raw, index } of itemsWithOrdinal) {
    const ordinal = raw?.source_ordinal;
    if (typeof ordinal !== 'number' || !Number.isInteger(ordinal) || ordinal < 1) {
      issues.push(
        'Рядок ' + String(index + 1) + ': source_ordinal має бути додатним цілим числом.',
      );
      hasInvalidOrdinal = true;
      continue;
    }
    if (ordinals.has(ordinal)) {
      issues.push('source_ordinal ' + String(ordinal) + ' повторюється.');
    }
    ordinals.add(ordinal);
  }

  if (hasInvalidOrdinal) return;
  for (let ordinal = 1; ordinal <= rawItems.length; ordinal += 1) {
    if (!ordinals.has(ordinal)) {
      issues.push('Пропущено source_ordinal ' + String(ordinal) + '.');
    }
  }
}

function mergeAccountingPairs(items: ParsedReceipt['items']): ParsedReceipt['items'] {
  const result = items.map((item) => ({ ...item }));
  const removed = new Set<number>();
  const groups = new Map<string, number[]>();
  result.forEach((item, index) => {
    const key = normalize(item.product_name);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });

  for (const indices of groups.values()) {
    const positives = indices.filter((index) => (result[index]?.unit_price_orig ?? 0) > 0);
    const negatives = indices.filter((index) => (result[index]?.unit_price_orig ?? 0) < 0);
    const claimed = new Set<number>();
    claimPairs(result, positives, negatives, claimed, removed, 'cancellation');
    claimPairs(result, positives, negatives, claimed, removed, 'discount');
  }
  return result.filter((_, index) => !removed.has(index));
}

function claimPairs(
  items: ParsedReceipt['items'],
  positiveIndices: number[],
  negativeIndices: number[],
  claimed: Set<number>,
  removed: Set<number>,
  pass: 'cancellation' | 'discount',
): void {
  for (const negativeIndex of negativeIndices) {
    if (claimed.has(negativeIndex)) continue;
    const negative = items[negativeIndex];
    if (!negative) continue;
    const negativeTotal = roundMoney(Math.abs(negative.qty * negative.unit_price_orig));
    const positiveIndex = positiveIndices.find((index) => {
      const positive = items[index];
      if (!positive || claimed.has(index) || Math.abs(positive.qty - negative.qty) > 0.001) {
        return false;
      }
      const positiveTotal = roundMoney(Math.abs(positive.qty * positive.unit_price_orig));
      return pass === 'cancellation'
        ? positiveTotal === negativeTotal
        : positiveTotal > negativeTotal;
    });
    if (positiveIndex == null) continue;
    const positive = items[positiveIndex];
    if (!positive) continue;
    claimed.add(positiveIndex);
    claimed.add(negativeIndex);
    removed.add(negativeIndex);
    if (pass === 'cancellation') {
      positive.unit_price_orig = 0;
      positive.discount_orig = 0;
    } else {
      positive.discount_orig = roundMoney(Math.abs(negative.unit_price_orig));
    }
  }
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function amountAppearsInText(text: string, amount: number): boolean {
  const absolute = Math.abs(roundMoney(amount)).toFixed(2);
  const compactText = text.replace(/\s/g, '');
  return [absolute, absolute.replace('.', ',')].some((variant) => compactText.includes(variant));
}

function integerAppearsInText(text: string, value: number): boolean {
  return new RegExp('(?:^|\\D)' + String(value) + '(?:\\D|$)', 'u').test(text);
}

function hasExplicitMultiplier(text: string, qty: number): boolean {
  const rawQty = String(roundQty(qty)).replace('.', '[.,]');
  return new RegExp(
    '(?:^|\\s)(?:' + rawQty + '\\s*(?:x|×|stk\\.?|st\\.?|pcs)|(?:x|×)\\s*' + rawQty + ')(?:\\s|$)',
    'iu',
  ).test(text);
}

function hasWeightOrVolume(text: string): boolean {
  return /(?:^|\s)\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml)(?:\s|$)/iu.test(text);
}

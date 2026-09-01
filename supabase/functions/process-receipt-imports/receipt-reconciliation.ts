import type { BulkParsedDocument, ParsedItem } from '../parse-receipt/types.ts';
import {
  auditReceiptEvidence,
  checkReceiptArithmetic,
  type ReceiptArithmeticCheck,
  type ReceiptEvidenceAudit,
} from './domain.ts';

export type ReceiptDiagnosisCode =
  | 'tax_class_as_quantity'
  | 'missing_repeated_row'
  | 'missing_discount'
  | 'corrected_items'
  | 'secondary_not_receipt'
  | 'printed_total_disagreement'
  | 'metadata_disagreement'
  | 'secondary_arithmetic_mismatch'
  | 'secondary_evidence_invalid';

export type ReceiptReconciliation = {
  status: 'accepted' | 'rejected';
  parsed: BulkParsedDocument;
  diagnosisCode: ReceiptDiagnosisCode;
  publicMessage: string;
  before: ReceiptArithmeticCheck | null;
  after: ReceiptArithmeticCheck | null;
  evidence: ReceiptEvidenceAudit;
  details: Record<string, unknown>;
};

/**
 * Compares two independent readings of the same document. The secondary model
 * never receives the primary values, so arithmetic agreement is evidence rather
 * than a prompted target. Receipt identity fields remain controlled by primary.
 */
export function reconcileIndependentReceipt(
  primary: BulkParsedDocument,
  secondary: BulkParsedDocument,
): ReceiptReconciliation {
  const before = checkReceiptArithmetic(primary);
  const after = checkReceiptArithmetic(secondary);
  const evidence = auditReceiptEvidence(secondary);

  if (secondary.document_kind !== 'receipt') {
    return rejected(
      primary,
      'secondary_not_receipt',
      'Незалежна перевірка не підтвердила, що документ є чеком.',
      before,
      after,
      evidence,
    );
  }
  if (!samePrintedTotal(primary, secondary)) {
    return rejected(
      primary,
      'printed_total_disagreement',
      'Дві незалежні перевірки прочитали різні підсумкові суми.',
      before,
      after,
      evidence,
    );
  }
  if (!sameReceiptIdentity(primary, secondary)) {
    return rejected(
      primary,
      'metadata_disagreement',
      'Дві незалежні перевірки не погодилися щодо реквізитів чека.',
      before,
      after,
      evidence,
    );
  }
  if (!after?.matches) {
    return rejected(
      primary,
      'secondary_arithmetic_mismatch',
      'Незалежна перевірка також не змогла узгодити позиції з підсумком.',
      before,
      after,
      evidence,
    );
  }
  if (!evidence.ok) {
    return rejected(
      primary,
      'secondary_evidence_invalid',
      `Незалежна перевірка має непідтверджені рядки: ${evidence.issues[0]?.message ?? 'бракує доказів.'}`,
      before,
      after,
      evidence,
    );
  }

  const diagnosisCode = diagnoseChange(primary, secondary, before, after);
  return {
    status: 'accepted',
    parsed: {
      ...primary,
      total_raw_text: secondary.total_raw_text,
      items: secondary.items.map((item) => ({ ...item })),
    },
    diagnosisCode,
    publicMessage: diagnosisMessage(diagnosisCode),
    before,
    after,
    evidence,
    details: comparisonDetails(primary, secondary, before, after, evidence),
  };
}

function rejected(
  parsed: BulkParsedDocument,
  diagnosisCode: ReceiptDiagnosisCode,
  publicMessage: string,
  before: ReceiptArithmeticCheck | null,
  after: ReceiptArithmeticCheck | null,
  evidence: ReceiptEvidenceAudit,
): ReceiptReconciliation {
  return {
    status: 'rejected',
    parsed,
    diagnosisCode,
    publicMessage,
    before,
    after,
    evidence,
    details: comparisonDetails(parsed, null, before, after, evidence),
  };
}

function samePrintedTotal(primary: BulkParsedDocument, secondary: BulkParsedDocument): boolean {
  return (
    primary.total_orig != null &&
    secondary.total_orig != null &&
    Math.abs(primary.total_orig - secondary.total_orig) <= 0.01
  );
}

function sameReceiptIdentity(primary: BulkParsedDocument, secondary: BulkParsedDocument): boolean {
  if (primary.currency !== secondary.currency || primary.date !== secondary.date) return false;
  if (primary.time && secondary.time && primary.time.slice(0, 5) !== secondary.time.slice(0, 5)) {
    return false;
  }
  const left = normalize(primary.store ?? '');
  const right = normalize(secondary.store ?? '');
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

function diagnoseChange(
  primary: BulkParsedDocument,
  secondary: BulkParsedDocument,
  before: ReceiptArithmeticCheck | null,
  after: ReceiptArithmeticCheck | null,
): ReceiptDiagnosisCode {
  if (hasTaxClassQuantityCorrection(primary, secondary)) return 'tax_class_as_quantity';
  if (hasMissingRepeatedRow(primary.items, secondary.items, before, after)) {
    return 'missing_repeated_row';
  }
  const primaryNegative = primary.items.filter((item) => item.unit_price_orig < 0).length;
  const secondaryNegative = secondary.items.filter((item) => item.unit_price_orig < 0).length;
  if (secondaryNegative > primaryNegative) return 'missing_discount';
  return 'corrected_items';
}

function hasTaxClassQuantityCorrection(
  primary: BulkParsedDocument,
  secondary: BulkParsedDocument,
): boolean {
  return primary.items.some((item) => {
    if (item.qty <= 1 || item.qty_evidence === 'explicit_multiplier') return false;
    const match = secondary.items.find((candidate) => sameProductAndPrice(item, candidate));
    if (!match || Math.abs(match.qty - 1) > 0.001) return false;
    return (
      item.tax_class === String(Math.round(item.qty)) ||
      /(?:^|\s)[12]\s*$/u.test(item.raw_text ?? '')
    );
  });
}

function hasMissingRepeatedRow(
  primary: ParsedItem[],
  secondary: ParsedItem[],
  before: ReceiptArithmeticCheck | null,
  after: ReceiptArithmeticCheck | null,
): boolean {
  if (!before || !after) return false;
  const gap = round(after.computedTotal - before.computedTotal, 2);
  const primaryCounts = countItems(primary);
  const secondaryCounts = countItems(secondary);
  for (const [key, secondaryCount] of secondaryCounts) {
    if (secondaryCount <= (primaryCounts.get(key) ?? 0)) continue;
    const item = secondary.find((candidate) => itemKey(candidate) === key);
    if (!item) continue;
    const lineTotal = round(item.qty * (item.unit_price_orig - (item.discount_orig ?? 0)), 2);
    if (Math.abs(gap - lineTotal) <= 0.02) return true;
  }
  return false;
}

function countItems(items: ParsedItem[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const item of items) {
    const key = itemKey(item);
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}

function itemKey(item: ParsedItem): string {
  return [
    normalize(item.product_code || item.product_name),
    round(item.qty, 3).toFixed(3),
    round(item.unit_price_orig, 2).toFixed(2),
  ].join('|');
}

function sameProductAndPrice(left: ParsedItem, right: ParsedItem): boolean {
  const sameIdentity =
    left.product_code && right.product_code
      ? normalize(left.product_code) === normalize(right.product_code)
      : normalize(left.product_name) === normalize(right.product_name);
  return sameIdentity && Math.abs(left.unit_price_orig - right.unit_price_orig) <= 0.01;
}

function comparisonDetails(
  primary: BulkParsedDocument,
  secondary: BulkParsedDocument | null,
  before: ReceiptArithmeticCheck | null,
  after: ReceiptArithmeticCheck | null,
  evidence: ReceiptEvidenceAudit,
): Record<string, unknown> {
  return {
    primary_item_count: primary.items.length,
    secondary_item_count: secondary?.items.length ?? null,
    computed_before: before?.computedTotal ?? null,
    computed_after: after?.computedTotal ?? null,
    printed_total: before?.printedTotal ?? after?.printedTotal ?? null,
    evidence_issue_codes: evidence.issues.map((issue) => issue.code),
  };
}

function diagnosisMessage(code: ReceiptDiagnosisCode): string {
  const messages: Record<ReceiptDiagnosisCode, string> = {
    tax_class_as_quantity:
      'Незалежна перевірка підтвердила: VAT-клас у правій колонці було помилково прочитано як кількість.',
    missing_repeated_row:
      'Незалежна перевірка знайшла окремий повторний рядок, пропущений під час першого аналізу.',
    missing_discount: 'Незалежна перевірка знайшла пропущений рядок знижки або повернення.',
    corrected_items:
      'Незалежна перевірка підтвердила інший набір видимих позицій, арифметика якого збігається.',
    secondary_not_receipt: '',
    printed_total_disagreement: '',
    metadata_disagreement: '',
    secondary_arithmetic_mismatch: '',
    secondary_evidence_invalid: '',
  };
  return messages[code];
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

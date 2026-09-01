import type { BulkParsedDocument, ParsedItem } from '../parse-receipt/types.ts';
import {
  auditReceiptEvidence,
  checkReceiptArticleCount,
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
  | 'secondary_article_count_mismatch'
  | 'unresolved_repeated_row_candidate'
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

export type ReceiptProviderRole = 'primary' | 'fallback';
export type ReceiptVerificationKind = 'cross_provider' | 'same_provider_row_audit';

export function selectParseProviderRole(deliveryAttempt: number): ReceiptProviderRole {
  return deliveryAttempt === 1 ? 'primary' : 'fallback';
}

export function selectVerificationKind(
  seedProvider: 'gemini' | 'anthropic',
): ReceiptVerificationKind {
  return seedProvider === 'gemini' ? 'cross_provider' : 'same_provider_row_audit';
}

export function shouldLoadStoredVerificationSeed(deliveryAttempt: number): boolean {
  return deliveryAttempt > 1;
}

export function selectSeedStages(previousWorkerDiagnosis: string | null): string[] {
  return previousWorkerDiagnosis === 'independent_check_required'
    ? ['primary_parse', 'fallback_parse', 'independent_check']
    : ['primary_parse', 'fallback_parse'];
}

export function shouldQueueIndependentCheck(
  providerRole: ReceiptProviderRole,
  deliveryAttempt: number,
  arithmeticMatches: boolean,
  evidenceIsValid: boolean,
): boolean {
  if (arithmeticMatches && evidenceIsValid) return false;
  return (
    (providerRole === 'primary' && deliveryAttempt === 1) ||
    (providerRole === 'fallback' && deliveryAttempt === 2)
  );
}

/**
 * Compares two separately prompted readings of the same document. A Gemini to
 * Sonnet check is cross-provider; a Sonnet fallback can instead receive the
 * focused row-audit prompt. Neither path receives the first reading's values,
 * so arithmetic agreement is evidence rather than a prompted target. Receipt
 * identity fields remain controlled by the first reading.
 */
export function reconcileIndependentReceipt(
  primary: BulkParsedDocument,
  secondary: BulkParsedDocument,
): ReceiptReconciliation {
  const before = checkReceiptArithmetic(primary);
  const after = checkReceiptArithmetic(secondary);
  const primaryEvidence = auditReceiptEvidence(primary);
  const evidence = auditReceiptEvidence(secondary);

  if (secondary.document_kind !== 'receipt') {
    return rejected(
      primary,
      'secondary_not_receipt',
      'Окрема перевірка не підтвердила, що документ є чеком.',
      before,
      after,
      evidence,
    );
  }
  if (!samePrintedTotal(primary, secondary)) {
    return rejected(
      primary,
      'printed_total_disagreement',
      'Два окремі читання документа дали різні підсумкові суми.',
      before,
      after,
      evidence,
    );
  }
  if (!sameReceiptIdentity(primary, secondary)) {
    return rejected(
      primary,
      'metadata_disagreement',
      'Два окремі читання документа не погодилися щодо реквізитів чека.',
      before,
      after,
      evidence,
    );
  }
  if (hasBlockingEvidenceIssue(evidence)) {
    const blockingIssue = evidence.issues.find(
      (issue) => issue.code !== 'article_count_item_mismatch',
    );
    return rejected(
      primary,
      'secondary_evidence_invalid',
      `Окрема перевірка має непідтверджені рядки: ${blockingIssue?.message ?? 'бракує доказів.'}`,
      before,
      after,
      evidence,
    );
  }
  const secondaryArticleCount = checkReceiptArticleCount(secondary);
  if (!after?.matches || (secondaryArticleCount && !secondaryArticleCount.matches)) {
    const articleCountRepair = after
      ? repairRepeatedRowsUsingArticleCount(primary, secondary, before, after, primaryEvidence)
      : null;
    if (articleCountRepair) {
      return {
        status: 'accepted',
        parsed: articleCountRepair.parsed,
        diagnosisCode: 'missing_repeated_row',
        publicMessage: diagnosisMessage('missing_repeated_row'),
        before,
        after: articleCountRepair.after,
        evidence: articleCountRepair.evidence,
        details: {
          ...comparisonDetails(primary, secondary, before, after, evidence),
          article_count_repair: articleCountRepair.details,
        },
      };
    }
    const repeatedRowRepair = after
      ? repairSingleRepeatedRow(primary, secondary, before, after, primaryEvidence)
      : null;
    if (repeatedRowRepair) {
      return {
        status: 'accepted',
        parsed: repeatedRowRepair.parsed,
        diagnosisCode: 'missing_repeated_row',
        publicMessage: diagnosisMessage('missing_repeated_row'),
        before,
        after: repeatedRowRepair.after,
        evidence: repeatedRowRepair.evidence,
        details: {
          ...comparisonDetails(primary, secondary, before, after, evidence),
          targeted_repair: repeatedRowRepair.details,
        },
      };
    }
    const candidate = after ? repeatedRowGapCandidate(secondary.items, after) : null;
    if (candidate) {
      const missingRows =
        candidate.missingOccurrences === 1
          ? 'ще одному рядку'
          : `ще ${String(candidate.missingOccurrences)} рядкам`;
      return rejected(
        primary,
        'unresolved_repeated_row_candidate',
        `Окремий аудит не підтвердив повну арифметику. Різниця ${candidate.gap.toFixed(2)} дорівнює ${missingRows} «${candidate.productName}» за ${candidate.lineTotal.toFixed(2)}, але автоматично додавати непідтверджені рядки небезпечно.`,
        before,
        after,
        evidence,
        { repeated_row_candidate: candidate },
      );
    }
    if (after?.matches && secondaryArticleCount && !secondaryArticleCount.matches) {
      return rejected(
        primary,
        'secondary_article_count_mismatch',
        `Арифметика збігається, але на чеку надруковано ${String(secondaryArticleCount.printedCount)} товарів, а окрема перевірка розпізнала ${String(secondaryArticleCount.computedCount)}.`,
        before,
        after,
        evidence,
      );
    }
    return rejected(
      primary,
      'secondary_arithmetic_mismatch',
      'Окрема перевірка також не змогла узгодити позиції з підсумком.',
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
      article_count: secondary.article_count,
      article_count_raw_text: secondary.article_count_raw_text,
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
  extraDetails: Record<string, unknown> = {},
): ReceiptReconciliation {
  return {
    status: 'rejected',
    parsed,
    diagnosisCode,
    publicMessage,
    before,
    after,
    evidence,
    details: { ...comparisonDetails(parsed, null, before, after, evidence), ...extraDetails },
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
    const primaryCount = primaryCounts.get(key) ?? 0;
    const additionalRows = secondaryCount - primaryCount;
    if (additionalRows <= 0) continue;
    const item = secondary.find((candidate) => itemKey(candidate) === key);
    if (!item) continue;
    const lineTotal = round(item.qty * (item.unit_price_orig - (item.discount_orig ?? 0)), 2);
    if (Math.abs(gap - round(additionalRows * lineTotal, 2)) <= 0.02) return true;
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
    round(item.discount_orig ?? 0, 2).toFixed(2),
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
  const primaryArticleCount = checkReceiptArticleCount(primary);
  const secondaryArticleCount = secondary ? checkReceiptArticleCount(secondary) : null;
  return {
    primary_item_count: primary.items.length,
    secondary_item_count: secondary?.items.length ?? null,
    computed_before: before?.computedTotal ?? null,
    computed_after: after?.computedTotal ?? null,
    printed_total: before?.printedTotal ?? after?.printedTotal ?? null,
    primary_printed_article_count: primaryArticleCount?.printedCount ?? null,
    primary_computed_article_count: primaryArticleCount?.computedCount ?? null,
    secondary_printed_article_count: secondaryArticleCount?.printedCount ?? null,
    secondary_computed_article_count: secondaryArticleCount?.computedCount ?? null,
    evidence_issue_codes: evidence.issues.map((issue) => issue.code),
  };
}

function diagnosisMessage(code: ReceiptDiagnosisCode): string {
  const messages: Record<ReceiptDiagnosisCode, string> = {
    tax_class_as_quantity:
      'Окрема перевірка підтвердила: VAT-клас у правій колонці було помилково прочитано як кількість.',
    missing_repeated_row:
      'Окрема перевірка знайшла повторні рядки, пропущені під час першого аналізу.',
    missing_discount: 'Окрема перевірка знайшла пропущений рядок знижки або повернення.',
    corrected_items:
      'Окрема перевірка підтвердила інший набір видимих позицій, арифметика якого збігається.',
    secondary_not_receipt: '',
    printed_total_disagreement: '',
    metadata_disagreement: '',
    secondary_arithmetic_mismatch: '',
    secondary_article_count_mismatch: '',
    unresolved_repeated_row_candidate: '',
    secondary_evidence_invalid: '',
  };
  return messages[code];
}

function repeatedRowGapCandidate(
  items: ParsedItem[],
  arithmetic: ReceiptArithmeticCheck,
  requiredMissingOccurrences?: number,
): {
  productName: string;
  productCode: string | null;
  key: string;
  occurrences: number;
  missingOccurrences: number;
  expectedOccurrences: number;
  lineTotal: number;
  gap: number;
} | null {
  const gap = round(arithmetic.printedTotal - arithmetic.computedTotal, 2);
  if (gap <= 0) return null;
  const counts = countItems(items);
  const candidates: Array<{
    productName: string;
    productCode: string | null;
    key: string;
    occurrences: number;
    missingOccurrences: number;
    expectedOccurrences: number;
    lineTotal: number;
    gap: number;
  }> = [];
  for (const [key, occurrences] of counts) {
    if (occurrences < 2) continue;
    const item = items.find((candidate) => itemKey(candidate) === key);
    if (!item) continue;
    const lineTotal = round(item.qty * (item.unit_price_orig - (item.discount_orig ?? 0)), 2);
    if (lineTotal <= 0) continue;
    const missingOccurrences = Math.round(gap / lineTotal);
    if (
      missingOccurrences < 1 ||
      missingOccurrences > 20 ||
      (requiredMissingOccurrences != null && missingOccurrences !== requiredMissingOccurrences) ||
      Math.abs(gap - round(missingOccurrences * lineTotal, 2)) > 0.02
    ) {
      continue;
    }
    candidates.push({
      productName: item.product_name,
      productCode: item.product_code ?? null,
      key,
      occurrences,
      missingOccurrences,
      expectedOccurrences: occurrences + missingOccurrences,
      lineTotal,
      gap,
    });
  }
  return candidates.length === 1 ? candidates[0]! : null;
}

function repairRepeatedRowsUsingArticleCount(
  primary: BulkParsedDocument,
  secondary: BulkParsedDocument,
  before: ReceiptArithmeticCheck | null,
  secondaryArithmetic: ReceiptArithmeticCheck,
  primaryEvidence: ReceiptEvidenceAudit,
): {
  parsed: BulkParsedDocument;
  after: ReceiptArithmeticCheck;
  evidence: ReceiptEvidenceAudit;
  details: Record<string, unknown>;
} | null {
  if (
    !before ||
    before.matches ||
    secondaryArithmetic.matches ||
    hasBlockingEvidenceIssue(primaryEvidence)
  ) {
    return null;
  }
  const primaryArticleCount = checkReceiptArticleCount(primary);
  const secondaryArticleCount = checkReceiptArticleCount(secondary);
  if (
    !primaryArticleCount ||
    !secondaryArticleCount ||
    primaryArticleCount.printedCount !== secondaryArticleCount.printedCount ||
    primaryArticleCount.missingCount <= secondaryArticleCount.missingCount ||
    secondaryArticleCount.missingCount <= 0
  ) {
    return null;
  }

  const primaryCandidate = repeatedRowGapCandidate(
    primary.items,
    before,
    primaryArticleCount.missingCount,
  );
  const secondaryCandidate = repeatedRowGapCandidate(
    secondary.items,
    secondaryArithmetic,
    secondaryArticleCount.missingCount,
  );
  if (!primaryCandidate || !secondaryCandidate) return null;
  if (
    primaryCandidate.key !== secondaryCandidate.key ||
    primaryCandidate.expectedOccurrences !== secondaryCandidate.expectedOccurrences ||
    primaryCandidate.missingOccurrences !== primaryArticleCount.missingCount ||
    secondaryCandidate.missingOccurrences !== secondaryArticleCount.missingCount ||
    secondaryCandidate.occurrences < 2 ||
    !sameNonCandidateRows(primary.items, secondary.items, primaryCandidate.key) ||
    !sameCandidateEvidence(primary.items, secondary.items, primaryCandidate.key)
  ) {
    return null;
  }

  const candidate = secondary.items.find((item) => itemKey(item) === secondaryCandidate.key);
  if (!candidate) return null;
  const items = secondary.items.map((item) => ({ ...item }));
  const insertionIndex =
    items.findLastIndex((item) => itemKey(item) === secondaryCandidate.key) + 1;
  items.splice(
    insertionIndex,
    0,
    ...Array.from({ length: secondaryArticleCount.missingCount }, () => ({ ...candidate })),
  );
  const parsed: BulkParsedDocument = {
    ...primary,
    total_raw_text: secondary.total_raw_text,
    article_count: secondary.article_count,
    article_count_raw_text: secondary.article_count_raw_text,
    items: items.map((item, index) => ({ ...item, source_ordinal: index + 1 })),
  };
  const after = checkReceiptArithmetic(parsed);
  const repairedArticleCount = checkReceiptArticleCount(parsed);
  const evidence = auditReceiptEvidence(parsed);
  if (!after?.matches || !repairedArticleCount?.matches || !evidence.ok) return null;

  return {
    parsed,
    after,
    evidence,
    details: {
      product_name: candidate.product_name,
      product_code: candidate.product_code ?? null,
      printed_article_count: repairedArticleCount.printedCount,
      primary_computed_article_count: primaryArticleCount.computedCount,
      secondary_computed_article_count: secondaryArticleCount.computedCount,
      added_occurrences: secondaryArticleCount.missingCount,
      expected_occurrences: secondaryCandidate.expectedOccurrences,
      line_total: secondaryCandidate.lineTotal,
      primary_gap: primaryCandidate.gap,
      secondary_gap: secondaryCandidate.gap,
      evidence_basis: 'printed_article_count+arithmetic_gap+stable_rows+independent_recount',
    },
  };
}

function sameNonCandidateRows(
  primary: ParsedItem[],
  secondary: ParsedItem[],
  candidateKey: string,
): boolean {
  const primaryKeys = primary
    .filter((item) => itemKey(item) !== candidateKey)
    .map(stableFinancialRowKey)
    .sort((left, right) => left.localeCompare(right));
  const secondaryKeys = secondary
    .filter((item) => itemKey(item) !== candidateKey)
    .map(stableFinancialRowKey)
    .sort((left, right) => left.localeCompare(right));
  return JSON.stringify(primaryKeys) === JSON.stringify(secondaryKeys);
}

function stableFinancialRowKey(item: ParsedItem): string {
  const financialValues = [
    round(item.qty, 3).toFixed(3),
    round(item.unit_price_orig, 2).toFixed(2),
    round(item.discount_orig ?? 0, 2).toFixed(2),
  ].join('|');
  if (item.unit_price_orig < 0) return `negative|${financialValues}`;
  const identity = item.product_code
    ? `code:${normalize(item.product_code)}`
    : `name:${normalize(item.product_name)}`;
  return `${identity}|${financialValues}`;
}

function sameCandidateEvidence(
  primary: ParsedItem[],
  secondary: ParsedItem[],
  candidateKey: string,
): boolean {
  const primaryText = new Set(
    primary
      .filter((item) => itemKey(item) === candidateKey)
      .map((item) => normalizeEvidence(item.raw_text ?? '')),
  );
  const secondaryText = new Set(
    secondary
      .filter((item) => itemKey(item) === candidateKey)
      .map((item) => normalizeEvidence(item.raw_text ?? '')),
  );
  return (
    primaryText.size === 1 &&
    secondaryText.size === 1 &&
    !primaryText.has('') &&
    [...primaryText][0] === [...secondaryText][0]
  );
}

function hasBlockingEvidenceIssue(evidence: ReceiptEvidenceAudit): boolean {
  return evidence.issues.some((issue) => issue.code !== 'article_count_item_mismatch');
}

function repairSingleRepeatedRow(
  primary: BulkParsedDocument,
  secondary: BulkParsedDocument,
  before: ReceiptArithmeticCheck | null,
  secondaryArithmetic: ReceiptArithmeticCheck,
  primaryEvidence: ReceiptEvidenceAudit,
): {
  parsed: BulkParsedDocument;
  after: ReceiptArithmeticCheck;
  evidence: ReceiptEvidenceAudit;
  details: Record<string, unknown>;
} | null {
  if (!before || before.matches || !primaryEvidence.ok) return null;
  const gap = round(before.printedTotal - before.computedTotal, 2);
  if (gap <= 0) return null;

  const primaryCounts = countItems(primary.items);
  const secondaryCounts = countItems(secondary.items);
  const candidates: Array<{ key: string; item: ParsedItem; lineTotal: number }> = [];
  for (const [key, secondaryCount] of secondaryCounts) {
    const primaryCount = primaryCounts.get(key) ?? 0;
    if (primaryCount < 1 || secondaryCount !== primaryCount + 1) continue;
    const secondaryRows = secondary.items.filter((item) => itemKey(item) === key);
    const primaryRows = primary.items.filter((item) => itemKey(item) === key);
    const item = primaryRows[0];
    if (!item) continue;
    const lineTotal = round(item.qty * (item.unit_price_orig - (item.discount_orig ?? 0)), 2);
    if (lineTotal <= 0 || Math.abs(gap - lineTotal) > 0.02) continue;

    const primaryTexts = new Set(primaryRows.map((row) => normalizeEvidence(row.raw_text ?? '')));
    const secondaryTexts = new Set(
      secondaryRows.map((row) => normalizeEvidence(row.raw_text ?? '')),
    );
    if (
      primaryTexts.has('') ||
      secondaryTexts.size !== 1 ||
      !primaryTexts.has([...secondaryTexts][0] ?? '')
    ) {
      continue;
    }
    candidates.push({ key, item, lineTotal });
  }
  if (candidates.length !== 1) return null;

  const candidate = candidates[0];
  if (!candidate) return null;
  const insertionIndex = primary.items.findLastIndex((item) => itemKey(item) === candidate.key) + 1;
  const items = primary.items.map((item) => ({ ...item }));
  items.splice(insertionIndex, 0, { ...candidate.item });
  const parsed: BulkParsedDocument = {
    ...primary,
    items: items.map((item, index) => ({ ...item, source_ordinal: index + 1 })),
  };
  const after = checkReceiptArithmetic(parsed);
  const repairedEvidence = auditReceiptEvidence(parsed);
  if (!after?.matches || !repairedEvidence.ok) return null;

  return {
    parsed,
    after,
    evidence: repairedEvidence,
    details: {
      product_name: candidate.item.product_name,
      product_code: candidate.item.product_code ?? null,
      primary_occurrences: primaryCounts.get(candidate.key),
      secondary_occurrences: secondaryCounts.get(candidate.key),
      line_total: candidate.lineTotal,
      primary_gap: gap,
      secondary_computed_total: secondaryArithmetic.computedTotal,
    },
  };
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function normalizeEvidence(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

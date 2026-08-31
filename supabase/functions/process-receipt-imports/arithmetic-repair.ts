import type {
  AiContext,
  BulkParsedDocument,
  BulkReceiptItemRepair,
  BulkReceiptRepairContext,
} from '../parse-receipt/types.ts';
import {
  checkReceiptArithmetic,
  type ReceiptArithmeticCheck,
  validateBulkDocument,
} from './domain.ts';

export type BulkItemRepairProvider = {
  repairBulkItems(
    imageBase64: string,
    ctx: AiContext,
    repair: BulkReceiptRepairContext,
  ): Promise<BulkReceiptItemRepair>;
};

export type ArithmeticRepairResult = {
  parsed: BulkParsedDocument;
  status: 'not_needed' | 'unavailable' | 'accepted' | 'rejected' | 'failed';
  before: ReceiptArithmeticCheck | null;
  after: ReceiptArithmeticCheck | null;
};

/**
 * Gives one independent provider a chance to re-read item rows. The repair
 * response cannot modify the printed total or receipt metadata by contract;
 * only a candidate whose deterministic arithmetic matches is accepted.
 */
export async function repairArithmeticMismatch(
  parsed: BulkParsedDocument,
  imageBase64: string,
  ctx: AiContext,
  provider: BulkItemRepairProvider | null,
): Promise<ArithmeticRepairResult> {
  const before = checkReceiptArithmetic(parsed);
  if (!before || before.matches) {
    return { parsed, status: 'not_needed', before, after: before };
  }
  if (!provider) {
    return { parsed, status: 'unavailable', before, after: null };
  }

  try {
    const repair = await provider.repairBulkItems(imageBase64, ctx, {
      expectedTotalOrig: before.printedTotal,
      previousComputedTotal: before.computedTotal,
      previousItems: parsed.items.map((item) => ({ ...item })),
    });
    const candidate = validateBulkDocument({ ...parsed, items: repair.items });
    const after = checkReceiptArithmetic(candidate);
    if (!after?.matches) {
      return { parsed, status: 'rejected', before, after };
    }
    return { parsed: candidate, status: 'accepted', before, after };
  } catch {
    return { parsed, status: 'failed', before, after: null };
  }
}

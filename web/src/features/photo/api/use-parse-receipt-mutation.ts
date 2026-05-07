import { useMutation } from '@tanstack/react-query';
import type { ParsedReceipt } from '@finance-tracker/domain';
import { parseReceiptService } from '@/shared/lib/dependencies';
import { blobToBase64 } from '../utils/resize-image';

export type ParseReceiptVars = {
  /** Already-resized JPEG blob ready to send to the AI. */
  blob: Blob;
  /** Allowed category names — passed to the model so its `category_suggestion` output is constrained. */
  categories: string[];
  /** Known product names — soft hints, not enforced. Defaults to []. */
  products?: { name: string }[];
};

/**
 * Calls the parse-receipt Edge Function with the photo bytes and returns the
 * structured `ParsedReceipt`. Validation against the canonical Zod schema
 * happens inside `parseReceiptService.parse` (see edge-fn-parse-receipt.ts).
 */
export function useParseReceiptMutation() {
  return useMutation<ParsedReceipt, Error, ParseReceiptVars>({
    mutationFn: async ({ blob, categories, products }) => {
      const imageBase64 = await blobToBase64(blob);
      return parseReceiptService.parse({
        imageBase64,
        mimeType: blob.type || 'image/jpeg',
        categories,
        products: products ?? [],
      });
    },
  });
}

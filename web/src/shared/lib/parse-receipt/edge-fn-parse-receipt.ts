// Calls the Supabase Edge Function `parse-receipt`. The function does the
// AI provider orchestration + allowlist check; the Zod validation is here on
// the client so a malformed AI response fails loudly with the canonical
// schema's error message.

import { ParsedReceiptSchema, type ParsedReceipt } from '@finance-tracker/domain';
import { supabase } from '../supabase-client';
import type { IParseReceiptService, ParseReceiptInput } from './parse-receipt.types';

const FUNCTION_NAME = 'parse-receipt';

export const edgeFunctionParseReceiptService: IParseReceiptService = {
  async parse(input: ParseReceiptInput): Promise<ParsedReceipt> {
    const response = await supabase.functions.invoke<unknown>(FUNCTION_NAME, {
      body: {
        imageBase64: input.imageBase64,
        mimeType: input.mimeType ?? 'image/jpeg',
        categories: input.categories,
        products: input.products ?? [],
      },
    });
    if (response.error) {
      const e: unknown = response.error;
      const message =
        e && typeof e === 'object' && 'message' in e && typeof e.message === 'string'
          ? e.message
          : 'unknown error';
      throw new Error(`parse-receipt failed: ${message}`);
    }
    const parsed = ParsedReceiptSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new Error(`parse-receipt returned invalid shape: ${parsed.error.message}`);
    }
    return parsed.data;
  },
};

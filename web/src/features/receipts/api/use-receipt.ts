import { useQuery } from '@tanstack/react-query';
import type { Item, Receipt } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { receiptQueryKey } from './receipts-query-keys';

export type ReceiptBundle = { receipt: Receipt; items: Item[] };

/**
 * Loads a single receipt + its items. Returns null when not found OR not
 * accessible (RLS hides rows from non-allowlisted users — both look the same
 * from the client's point of view).
 */
export function useReceipt(id: string | undefined) {
  return useQuery<ReceiptBundle | null>({
    queryKey: receiptQueryKey(id ?? '__none__'),
    enabled: !!id,
    queryFn: async () => {
      if (!id) return null;
      const [receiptRes, itemsRes] = await Promise.all([
        supabase.from('receipts').select('*').eq('id', id).maybeSingle(),
        supabase.from('items').select('*').eq('receipt_id', id).order('created_at'),
      ]);
      if (receiptRes.error) throw receiptRes.error;
      if (itemsRes.error) throw itemsRes.error;
      if (!receiptRes.data) return null;
      return { receipt: receiptRes.data, items: itemsRes.data ?? [] };
    },
  });
}

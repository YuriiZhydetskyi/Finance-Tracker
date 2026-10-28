import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import { packagedProductQueryKey } from './packaged-products-query-keys';
import { receiptHintsFromRawImport, type PackagingReceiptHint } from '../utils/packaging-import';

/**
 * The receipt-name hints the AI gave when this card was imported. Read from the
 * import's audit payload, which no other screen selects; they are suggestions to
 * link by hand, never links (ADR-0028).
 */
export function usePackagedProductReceiptHints(id: string) {
  return useQuery({
    queryKey: [...packagedProductQueryKey(id), 'receipt-hints'],
    queryFn: async (): Promise<PackagingReceiptHint[]> => {
      const { data, error } = await supabase
        .from('packaged_products')
        .select('raw_import_json')
        .eq('id', id)
        .single();
      if (error) throw error;
      return receiptHintsFromRawImport(data.raw_import_json);
    },
  });
}

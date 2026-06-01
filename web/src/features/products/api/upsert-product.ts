import { makeProduct } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';

/**
 * Ensure a catalog product exists for (store, name) and return its id. Used by
 * the price-import flow, which can encounter products not yet in the catalog.
 * Reuses the same code-less identity rule as the receipt save path.
 */
export async function ensureProduct(args: {
  store: string;
  name: string;
  category: string;
}): Promise<string> {
  const { data: existing } = await supabase
    .from('products')
    .select('id')
    .eq('store', args.store)
    .eq('name', args.name)
    .is('store_product_code', null)
    .maybeSingle();
  if (existing) return existing.id;

  const product = makeProduct({
    name: args.name,
    store: args.store,
    store_product_code: null,
    category: args.category,
  });
  const { error } = await supabase.from('products').insert(product);
  if (error) throw new Error(`Product insert failed: ${error.message}`);
  return product.id;
}

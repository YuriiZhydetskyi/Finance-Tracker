import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  packagedProductFromImport,
  type PackagedProduct,
  type PackagedProductImport,
} from '@finance-tracker/domain';
import { productsQueryKey } from '@/features/products/api/use-products';
import { supabase } from '@/shared/lib/supabase-client';
import type { Json } from '@/shared/types/database.types';
import { wrapError } from '@/shared/utils/wrap-error';
import {
  packagedProductsQueryKey,
  packagingCandidatesQueryKey,
} from './packaged-products-query-keys';

export type SavePackagedProductsVars = {
  /** Validated payloads paired with the verbatim JSON they came from. */
  imports: { parsed: PackagedProductImport; raw: unknown }[];
  /** Store-label rows (public.products.id) this card covers, linked in the same call. */
  linkProductIds?: string[];
};

const DUPLICATE_KEY = '23505';

/**
 * Postgres constraint names mapped to what the user should actually do about it.
 * `wrapError` alone would surface "duplicate key value violates unique
 * constraint packaged_products_barcode_uniq", which tells them nothing.
 */
function describeConstraint(message: string): string | null {
  if (message.includes('packaged_products_barcode_uniq')) {
    return 'Такий штрихкод уже має інша картка. Онови ту картку замість створення нової.';
  }
  if (message.includes('packaged_products_name_nobarcode_uniq')) {
    return 'Картка без штрихкоду з такою назвою вже існує. Додай штрихкод або уточни назву.';
  }
  return null;
}

export function useSavePackagedProductsMutation() {
  const queryClient = useQueryClient();

  return useMutation<PackagedProduct[], Error, SavePackagedProductsVars>({
    mutationFn: async ({ imports, linkProductIds = [] }) => {
      const rows = imports.map(({ parsed, raw }) =>
        packagedProductFromImport(parsed, { import_source: 'manual-json', raw_import_json: raw }),
      );

      // `raw_import_json` is `unknown` in the vendor-free domain; here it is known
      // to be JSON because it came straight out of parseJsonText.
      const { error } = await supabase
        .from('packaged_products')
        .insert(rows.map((row) => ({ ...row, raw_import_json: row.raw_import_json as Json })));
      if (error) {
        const friendly = error.code === DUPLICATE_KEY ? describeConstraint(error.message) : null;
        throw friendly
          ? new Error(friendly, { cause: error })
          : wrapError('Не вдалося зберегти картку товару', error);
      }

      if (linkProductIds.length > 0) {
        const firstRow = rows[0];
        if (!firstRow) throw new Error('Нема картки, до якої прив’язати позиції.');
        const { error: linkError } = await supabase
          .from('products')
          .update({ packaged_product_id: firstRow.id })
          .in('id', linkProductIds);
        if (linkError)
          throw wrapError('Картку збережено, але не вдалося прив’язати позиції', linkError);
      }

      return rows;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: packagedProductsQueryKey });
      void queryClient.invalidateQueries({ queryKey: packagingCandidatesQueryKey });
      void queryClient.invalidateQueries({ queryKey: productsQueryKey });
    },
  });
}

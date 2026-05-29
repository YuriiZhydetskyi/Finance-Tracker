import { useMutation } from '@tanstack/react-query';
import { env } from '@/shared/lib/env';

/**
 * Fetch a competitor's price page through the parse-receipt function's
 * /import-prices helper and return its raw text for client-side parsing.
 */
export function useImportPricesMutation() {
  return useMutation<string, Error, { url: string }>({
    mutationFn: async ({ url }) => {
      const endpoint = `${env.VITE_SUPABASE_URL}/functions/v1/parse-receipt/import-prices?url=${encodeURIComponent(url)}`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`Import failed: ${res.status}`);
      return res.text();
    },
  });
}

// Single Supabase JS client instance.
//
// IMPORTANT: this module is private to adapters in `web/src/shared/lib/<area>/`
// and feature `api/` folders. ESLint enforces this via `no-restricted-imports`
// (see web/eslint.config.js). Never import from a route, page, or component —
// go through the relevant port (authService / photoStorage / fxRateProvider /
// parseReceiptService) exported from `@/shared/lib/dependencies`.
//
// The schema overlay includes the pending purchase-correction migration.
// Regenerate database.types.ts and remove the overlay after deploying it.

import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import type { DatabaseWithPurchaseCorrections } from '@/shared/types/purchase-corrections-schema';

export const supabase = createClient<DatabaseWithPurchaseCorrections>(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

export type SupabaseClientInstance = typeof supabase;

// Row shapes returned by the v_stats_* views (see migration 20260507000003).
// These are not (yet) auto-included in database.types.ts because they were
// added after the last `supabase gen types`. Until that runs again, hooks cast
// row results to these types — Postgres-side numerics arrive as `string` over
// the JSON wire, so we coerce to number at the hook boundary.

export type StatsByMonthRow = {
  month: string; // 'YYYY-MM'
  total_eur: number;
  receipts_count: number;
};

export type StatsByCategoryRow = {
  category: string;
  total_eur: number;
  items_count: number;
};

export type StatsByUserRow = {
  paid_by: string;
  total_eur: number;
  receipts_count: number;
};

export type StatsByStoreRow = {
  store: string;
  total_eur: number;
  receipts_count: number;
};

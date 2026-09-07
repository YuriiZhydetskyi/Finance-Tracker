// Row shapes returned by the date-aware stats functions. Postgres-side
// numerics can arrive as strings over the JSON wire, so hooks coerce them at
// the boundary before exposing chart data.

export type StatsDateRange = {
  dateFrom?: string;
  dateTo?: string;
};

export type StatsFilters = {
  categories?: string[];
  stores?: string[];
};

export type StatsFilterOptions = {
  categories: string[];
  stores: string[];
};

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

export type StatsSavingsByMonthRow = {
  month: string; // 'YYYY-MM'
  savings_eur: number;
  discounted_items_count: number;
};

export type StatsWasteByMonthRow = {
  month: string; // 'YYYY-MM'
  wasted_value_eur: number;
  wasted_items_count: number;
};

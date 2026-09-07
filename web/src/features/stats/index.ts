// Public surface of the stats feature.

export { ByMonthChart } from './components/ByMonthChart';
export { ByCategoryChart } from './components/ByCategoryChart';
export { ByUserChart } from './components/ByUserChart';
export { ByStoreChart } from './components/ByStoreChart';
export { SavingsByMonthChart } from './components/SavingsByMonthChart';
export { WasteByMonthChart } from './components/WasteByMonthChart';
export { StatsPeriodPicker } from './components/StatsPeriodPicker';
export { StatsFiltersPicker } from './components/StatsFiltersPicker';
export { StatsCategoryDetails } from './components/StatsCategoryDetails';
export { StatsBreakdown } from './components/StatsBreakdown';
export { groupCategoryStats, type StatsSelection } from './category-details';

export {
  useStatsByMonth,
  useStatsByCategory,
  useStatsFilterOptions,
  useStatsByUser,
  useStatsByStore,
  useStatsSavingsByMonth,
  useStatsWasteByMonth,
  statsByMonthQueryKey,
  statsByCategoryQueryKey,
  statsByUserQueryKey,
  statsByStoreQueryKey,
  statsSavingsByMonthQueryKey,
  wasteByMonthQueryKey,
  statsFilterOptionsQueryKey,
} from './api/use-stats';

export type {
  StatsByMonthRow,
  StatsByCategoryRow,
  StatsByUserRow,
  StatsByStoreRow,
  StatsSavingsByMonthRow,
  StatsWasteByMonthRow,
  StatsDateRange,
  StatsFilters,
} from './api/stats.types';
export { formatPeriodRange, periodToDateRange } from './stats-period';
export { loadStatsDateRange, loadStatsFilters } from './stats-preferences';

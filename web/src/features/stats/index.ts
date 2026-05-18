// Public surface of the stats feature.

export { ByMonthChart } from './components/ByMonthChart';
export { ByCategoryChart } from './components/ByCategoryChart';
export { ByUserChart } from './components/ByUserChart';
export { ByStoreChart } from './components/ByStoreChart';
export { SavingsByMonthChart } from './components/SavingsByMonthChart';
export { WasteByMonthChart } from './components/WasteByMonthChart';

export {
  useStatsByMonth,
  useStatsByCategory,
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
} from './api/use-stats';

export type {
  StatsByMonthRow,
  StatsByCategoryRow,
  StatsByUserRow,
  StatsByStoreRow,
  StatsSavingsByMonthRow,
  StatsWasteByMonthRow,
} from './api/stats.types';

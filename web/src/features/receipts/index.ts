// Public surface of the receipts feature.

export { ManualReceiptForm } from './components/ManualReceiptForm';
export { EditReceiptForm } from './components/EditReceiptForm';
export { ReceiptFormFields } from './components/ReceiptFormFields';
export { ReceiptCard } from './components/ReceiptCard';
export { EmptyReceiptsState } from './components/EmptyReceiptsState';
export { NoMatchingReceipts } from './components/NoMatchingReceipts';
export { DuplicateWarningBanner } from './components/DuplicateWarningBanner';
export { RecentFiltersBar } from './components/RecentFiltersBar';
export { ItemsList } from './components/ItemsList';
export { ItemRow } from './components/ItemRow';
export { SummaryFooter } from './components/SummaryFooter';

export { RecentSearchSchema, countActiveFilters, searchToFilters } from './recent-search';
export type { RecentSearchParams, RecentSearchInput } from './recent-search';

export { useReceipts } from './api/use-receipts';
export type { ReceiptFilters } from './api/use-receipts';
export { useReceipt } from './api/use-receipt';
export type { ReceiptBundle } from './api/use-receipt';
export { useSaveReceiptMutation } from './api/use-save-receipt-mutation';
export type {
  SaveReceiptInput,
  SaveItemInput,
  SaveReceiptVars,
  SaveReceiptResult,
} from './api/use-save-receipt-mutation';
export { useUpdateReceiptMutation } from './api/use-update-receipt-mutation';
export type { UpdateReceiptVars, UpdateReceiptResult } from './api/use-update-receipt-mutation';
export { useDeleteReceiptMutation } from './api/use-delete-receipt-mutation';
export type { DeleteReceiptVars } from './api/use-delete-receipt-mutation';
export { receiptsQueryKey, receiptQueryKey } from './api/receipts-query-keys';
export { useDuplicateReceipts, withinTimeWindow } from './api/use-duplicate-receipts';
export type { DuplicateCandidate, DuplicateCheckInput } from './api/use-duplicate-receipts';

export { useReceiptForm, emptyItemRow } from './hooks/use-receipt-form';
export type { ManualFormValues, ItemFormValues, SupportedCurrency } from './schemas/manual-form';
export { ManualFormSchema, SUPPORTED_CURRENCIES } from './schemas/manual-form';

export { computeRowTotal, computeGrandTotal, computeCategoryBreakdown } from './utils/totals';

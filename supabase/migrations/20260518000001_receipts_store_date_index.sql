-- Speeds up duplicate detection: (store, date) is the hot lookup combo used by
-- the new useDuplicateReceipts query (PhotoReviewForm / ManualReceiptForm).
-- Existing idx_receipts_date (date desc) and idx_receipts_paid_by_date don't
-- cover this access pattern.

create index if not exists idx_receipts_store_date
  on public.receipts (store, date);

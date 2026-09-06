-- Preserve stable merchant references from structured order emails. These fields
-- are nullable so existing receipts and non-Amazon imports are unaffected.
alter table public.receipts
  add column if not exists merchant_order_id text;

alter table public.items
  add column if not exists product_url text,
  add column if not exists product_image_url text;

-- An imported Amazon order is one receipt. Prevent a second paste from creating
-- another receipt for the same merchant order while allowing other merchants to
-- use their own identifiers.
create unique index if not exists idx_receipts_store_merchant_order_id
  on public.receipts (store, merchant_order_id)
  where merchant_order_id is not null;

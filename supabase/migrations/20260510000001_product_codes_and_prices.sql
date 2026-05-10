-- Product codes, store-scoped products, price history.
--
-- Three changes that work together:
--   1) items.store_product_code — snapshot of the per-line code printed on
--      the receipt (e.g. Aldi prints "297855 Multivitamin 1l 1,39"). Snapshot,
--      never normalized; lives next to product_name for the same reason.
--   2) products gets `store` (NOT NULL) and `store_product_code` (nullable).
--      Drop UNIQUE(name); replace with UNIQUE(name, store) — same product name
--      can legitimately exist across different stores, and we want to disambig.
--   3) New product_prices table — append-only price snapshot per line item
--      (price_orig + price_net so trends survive store-side promotions).

-- ── items: snapshot column ──────────────────────────────────────────────────

alter table public.items
  add column store_product_code text;

-- ── products: store + canonical code ────────────────────────────────────────

alter table public.products
  add column store text not null default '',
  add column store_product_code text;

-- Old global UNIQUE(name) was a Sheets-era artifact (no store column then).
-- Replace with two partial unique indexes that match the new identity model:
--   * within a store, code is unique among coded products (so the same code
--     can't refer to two different SKUs in the same shop);
--   * within a store, name is unique among code-less products (so manual
--     entries without a code get deduplicated by name).
-- A product with name "Молоко" code=null can legitimately coexist with one
-- named "Молоко" code="12345" — the matching layer handles backfill in that
-- case. See use-save-receipt-mutation.ts for the resolution rules.

alter table public.products drop constraint products_name_key;

create unique index products_store_code_uniq
  on public.products (store, store_product_code)
  where store_product_code is not null;

create unique index products_store_name_nocode_uniq
  on public.products (store, name)
  where store_product_code is null;

create index idx_products_store_name
  on public.products (store, name);

-- ── product_prices: append-only history ─────────────────────────────────────
-- product_id ON DELETE RESTRICT — deleting a product (manual ops) should not
-- silently nuke its price history. Receipt deletes still cascade, since the
-- snapshot only makes sense in the context of an existing receipt.

create table public.product_prices (
  id          text primary key,
  product_id  text not null references public.products(id) on delete restrict,
  receipt_id  text not null references public.receipts(id) on delete cascade,
  price_orig  numeric(12, 2) not null,
  price_net   numeric(12, 2) not null,
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  date        date not null,
  created_at  timestamptz not null default now()
);

create index idx_product_prices_product_date
  on public.product_prices (product_id, date desc);

create index idx_product_prices_receipt
  on public.product_prices (receipt_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.product_prices enable row level security;

create policy "allowlist_all_product_prices" on public.product_prices
  for all using (public.is_allowed_user()) with check (public.is_allowed_user());

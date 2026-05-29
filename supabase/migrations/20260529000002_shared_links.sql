-- Shareable read-only price snapshots. A short token maps to a frozen copy of a
-- product's price history, so /share/<token> can render it without a login.
--
-- snapshot is a JSON-encoded PricePoint[] captured at share time, so the link
-- keeps working even if the product or its prices change later.

create table public.shared_links (
  token       text primary key,
  product_id  text not null references public.products(id) on delete cascade,
  snapshot    text not null,
  view_count  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index idx_shared_links_product on public.shared_links (product_id);

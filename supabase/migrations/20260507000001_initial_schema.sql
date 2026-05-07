-- Initial schema for Finance Tracker.
-- Mirrors docs/data-model.md.
--
-- Conventions:
--   - All entity IDs are 26-char Crockford Base32 ULIDs (text), generated client-side
--     by @finance-tracker/domain. We don't use Postgres uuid because the legacy
--     contract is ULID and we want time-sortable keys.
--   - Money: numeric(12, 2). Quantity: numeric(10, 3). FX rate: numeric(14, 6).
--   - Schema evolution rule: add columns at end of table only. Never reorder/rename/drop
--     during MVP. Storage code reads by name, not by position.

-- ── Enums ───────────────────────────────────────────────────────────────────

create type public.receipt_source as enum ('photo', 'manual', 'edit');
create type public.product_unit  as enum ('pcs', 'g', 'kg', 'ml', 'l');

-- ── Tables ──────────────────────────────────────────────────────────────────

create table public.categories (
  name        text primary key,
  group_name  text not null
);
comment on column public.categories.group_name is
  'Display group for dashboards (e.g. "Продукти", "Побут"). Renamed from data-model "group" because group is a SQL reserved word.';

create table public.products (
  id          text primary key,
  name        text not null unique,
  category    text not null references public.categories(name) on update cascade,
  unit        public.product_unit,
  unit_size   numeric(10, 3),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.receipts (
  id            text primary key,
  date          date not null,
  store         text not null,
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  total_orig    numeric(12, 2) not null,
  fx_rate_eur   numeric(14, 6) not null check (fx_rate_eur > 0),
  total_eur     numeric(12, 2) not null,
  paid_by       text not null check (paid_by like '%@%'),
  photo_url     text,
  source        public.receipt_source not null,
  raw_ocr_json  text check (raw_ocr_json is null or length(raw_ocr_json) <= 45000),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.items (
  id              text primary key,
  receipt_id      text not null references public.receipts(id) on delete cascade,
  product_id      text references public.products(id) on delete set null,
  product_name    text not null,
  category        text not null references public.categories(name) on update cascade,
  qty             numeric(10, 3) not null check (qty > 0),
  unit_price_orig numeric(12, 2) not null,
  total_orig      numeric(12, 2) not null,
  total_eur       numeric(12, 2) not null,
  consumed_by     text not null check (
    consumed_by in ('his', 'hers', 'shared')
    or consumed_by ~ '^custom:\d+/\d+$'
  ),
  note            text,
  wasted_qty      numeric(10, 3) not null default 0
                  check (wasted_qty >= 0 and wasted_qty <= qty),
  discount_orig   numeric(12, 2) not null default 0
                  check (discount_orig >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- App-level allowlist. Manual updates via Supabase Studio.
create table public.app_users (
  email text primary key
);
comment on table public.app_users is
  'Email allowlist gating all tables via RLS. Add a row to grant access; delete to revoke.';

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index idx_receipts_date         on public.receipts (date desc);
create index idx_receipts_paid_by_date on public.receipts (paid_by, date desc);
create index idx_items_receipt_id      on public.items (receipt_id);
create index idx_items_category        on public.items (category);
create index idx_items_product_id      on public.items (product_id) where product_id is not null;

-- ── Triggers: auto-bump updated_at ──────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_receipts_updated_at
  before update on public.receipts
  for each row execute function public.set_updated_at();

create trigger trg_items_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ── Row-level security ─────────────────────────────────────────────────────

alter table public.categories enable row level security;
alter table public.products   enable row level security;
alter table public.receipts   enable row level security;
alter table public.items      enable row level security;
alter table public.app_users  enable row level security;

-- Helper: is the current authenticated user in the allowlist?
create or replace function public.is_allowed_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.app_users
     where email = (auth.jwt() ->> 'email')
  );
$$;
comment on function public.is_allowed_user() is
  'Returns true if the JWT email is present in app_users. Used by every RLS policy.';

-- Policies: allowlisted users get full read/write on data tables.
create policy "allowlist_all_receipts" on public.receipts
  for all using (public.is_allowed_user()) with check (public.is_allowed_user());

create policy "allowlist_all_items" on public.items
  for all using (public.is_allowed_user()) with check (public.is_allowed_user());

create policy "allowlist_all_products" on public.products
  for all using (public.is_allowed_user()) with check (public.is_allowed_user());

-- Categories are read-only at runtime; mutate via Studio.
create policy "allowlist_read_categories" on public.categories
  for select using (public.is_allowed_user());

-- app_users: each user can read their own row (so the client knows it's allowed).
-- Mutations go through Studio (or a future admin UI).
create policy "self_read_app_users" on public.app_users
  for select using (email = (auth.jwt() ->> 'email'));

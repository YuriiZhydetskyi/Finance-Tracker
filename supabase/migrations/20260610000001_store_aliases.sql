-- Learned store-name pairs: when the user confirms a reconcile match whose
-- statement name did NOT fuzzy-match the receipt's store, we remember the pair
-- so future reconciles treat it as a store match (pre-checked group). Both
-- columns hold NORMALIZED names (normalizeStoreName in packages/domain) — the
-- unique index must dedupe "McDonald's" vs "MCDONALDS". See docs/data-model.md.

create table public.store_aliases (
  id             text primary key,            -- ULID, client-generated
  statement_name text not null,               -- normalized statement merchant or raw
  receipt_store  text not null,               -- normalized receipt store
  created_at     timestamptz not null default now()
);

-- Confirming the same pair again must be a no-op; the client upserts with
-- onConflict: 'statement_name,receipt_store', ignoreDuplicates.
create unique index uq_store_aliases_pair on public.store_aliases (statement_name, receipt_store);

alter table public.store_aliases enable row level security;

create policy "allowlist_all_store_aliases" on public.store_aliases
  for all using (public.is_allowed_user()) with check (public.is_allowed_user());

-- Orphan card transactions: statement lines that matched NO receipt on import
-- (reason 'no-candidate'). Persisted so they survive page reloads and can be
-- re-matched later when the real receipt is finally entered, or turned into a
-- stub receipt (source='statement') by the user. See docs/data-model.md.
--
-- Only orphans live here — matched lines (toFix/alreadyCorrect) act directly on
-- the receipts table and need no persistence. Refunds/receipt-taken lines are
-- informational and not stored.

create table public.statement_transactions (
  id          text primary key,                                  -- ULID, client-generated
  date        date not null,
  time        time,
  amount_orig numeric(12, 2) not null,                           -- always positive (abs of the charge)
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  merchant    text,
  raw         text,
  paid_by     text not null check (paid_by like '%@%'),          -- card owner chosen at import
  status      text not null default 'unmatched'
              check (status in ('unmatched', 'receipt_created', 'dismissed')),
  receipt_id  text references public.receipts(id) on delete set null,
  suggested_category text,                                       -- AI's category guess at import; stub-receipt fallback
  dedup_key   text not null,                                     -- date|amount|currency|label|occurrence
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Re-importing the same statement must not duplicate orphans; the upsert on the
-- client relies on this unique key (onConflict: 'dedup_key', ignoreDuplicates).
create unique index uq_statement_txn_dedup on public.statement_transactions (dedup_key);
create index idx_statement_txn_status on public.statement_transactions (status);

create trigger trg_statement_transactions_updated_at
  before update on public.statement_transactions
  for each row execute function public.set_updated_at();

alter table public.statement_transactions enable row level security;

create policy "allowlist_all_statement_transactions" on public.statement_transactions
  for all using (public.is_allowed_user()) with check (public.is_allowed_user());

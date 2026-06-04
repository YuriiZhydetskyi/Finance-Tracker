-- Persistent queue for receipt photos whose AI parse failed.
-- See docs/data-model.md "Таблиця pending_parses".
--
-- Why a dedicated table and not a flag on receipts: a failed parse has no
-- total_orig, no fx_rate, no items — stuffing it into receipts would force a
-- pile of nullable columns and pollute the stats views. Presence of a row =
-- "waiting to be re-parsed"; no status column needed.
--
-- photo_path stores the Storage path (NOT a signed URL) so we can re-sign on
-- demand — this also closes the long-standing "photo_path column" todo.

create table public.pending_parses (
  id                text primary key,                       -- ULID, client-generated
  photo_path        text not null,                          -- Storage path: {email}/{yyyy}/{mm}/{ulid}.{ext}
  paid_by           text not null check (paid_by like '%@%'),
  error_message     text,
  attempts          integer not null default 0,
  original_filename text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_pending_parses_created_at on public.pending_parses (created_at desc);

create trigger trg_pending_parses_updated_at
  before update on public.pending_parses
  for each row execute function public.set_updated_at();

alter table public.pending_parses enable row level security;

create policy "allowlist_all_pending_parses" on public.pending_parses
  for all using (public.is_allowed_user()) with check (public.is_allowed_user());

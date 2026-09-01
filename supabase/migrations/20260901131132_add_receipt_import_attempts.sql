create table public.receipt_import_attempts (
  id bigint generated always as identity primary key,
  file_id text not null references public.receipt_import_files(id) on delete cascade,
  analysis_run integer not null check (analysis_run > 0),
  delivery_attempt integer not null check (delivery_attempt > 0),
  stage text not null check (
    stage in ('primary_parse', 'fallback_parse', 'independent_check', 'worker')
  ),
  provider text,
  model text,
  status text not null check (
    status in ('started', 'succeeded', 'accepted', 'rejected', 'failed')
  ),
  settings jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  printed_total numeric(14, 2),
  computed_total numeric(14, 2),
  difference numeric(14, 2),
  diagnosis_code text,
  public_message text check (public_message is null or length(public_message) <= 1000),
  details jsonb,
  result_json jsonb,
  provider_request_id text,
  stop_reason text,
  input_tokens bigint,
  output_tokens bigint,
  created_at timestamptz not null default now(),
  unique (file_id, analysis_run, stage)
);

create index receipt_import_attempts_file_run_idx
  on public.receipt_import_attempts (file_id, analysis_run desc, id);

alter table public.receipt_import_attempts enable row level security;

create policy "allowlist_read_receipt_import_attempts"
  on public.receipt_import_attempts for select to authenticated
  using ((select public.is_allowed_user()));

revoke all on public.receipt_import_attempts from public, anon, authenticated, service_role;
revoke all on sequence public.receipt_import_attempts_id_seq
  from public, anon, authenticated, service_role;

grant select on public.receipt_import_attempts to authenticated;
grant select, insert, update on public.receipt_import_attempts to service_role;
grant usage, select on sequence public.receipt_import_attempts_id_seq to service_role;

comment on table public.receipt_import_attempts is
  'Persistent, user-readable audit trail for every bulk receipt AI analysis stage.';
comment on column public.receipt_import_attempts.result_json is
  'Validated structured provider result; protected by allowlist RLS and never written to console logs.';

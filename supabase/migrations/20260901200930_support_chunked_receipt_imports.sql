-- A long structured receipt may need several bounded provider calls. Keep each
-- validated slice distinct from complete provider results so verification seed
-- queries can never mistake a partial receipt for a complete one.
alter table public.receipt_import_attempts
  drop constraint receipt_import_attempts_stage_check;

alter table public.receipt_import_attempts
  add constraint receipt_import_attempts_stage_check check (
    stage in ('primary_parse', 'fallback_parse', 'independent_check', 'chunk_parse', 'worker')
  );

comment on column public.receipt_import_attempts.stage is
  'Worker/provider phase. chunk_parse is a validated absolute-ordinal slice of a long receipt, never a complete verification seed.';

-- Normal imports still stop after the established provider/audit stages. Only
-- the worker explicitly schedules deliveries beyond three for chunked long
-- receipts, up to this hard safety ceiling.
create or replace function public.schedule_receipt_import_retry(
  p_file_id text,
  p_msg_id bigint,
  p_read_count integer,
  p_error_message text,
  p_delay_seconds integer default 30
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_read_count >= 12 then
    raise exception 'Receipt import delivery limit reached';
  end if;

  update public.receipt_import_files
  set status = 'queued', error_message = left(p_error_message, 4000)
  where id = p_file_id and status = 'processing';

  if found then
    perform pgmq.set_vt(
      'receipt_imports',
      p_msg_id,
      greatest(5, least(coalesce(p_delay_seconds, 30), 300))
    );
  end if;
end;
$$;

revoke execute on function public.schedule_receipt_import_retry(text, bigint, integer, text, integer)
from public, anon, authenticated;
grant execute on function public.schedule_receipt_import_retry(text, bigint, integer, text, integer)
to service_role;

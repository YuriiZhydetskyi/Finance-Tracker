-- Intentional stage transitions should not wait for the five-minute crash
-- visibility timeout. Provider/network failures still use the existing
-- record_receipt_import_failure path and retain its backoff.
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
  if p_read_count >= 3 then
    raise exception 'A third delivery cannot be scheduled again';
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

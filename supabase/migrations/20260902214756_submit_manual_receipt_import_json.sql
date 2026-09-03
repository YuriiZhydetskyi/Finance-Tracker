-- A reviewed JSON submission stays attached to the durable import file. The
-- background worker validates it with the same evidence/arithmetic gates and
-- then uses the existing transactional finalizer.

alter table public.receipt_import_files
  add column manual_json jsonb;

alter table public.receipt_import_files
  add constraint receipt_import_files_manual_json_object check (
    manual_json is null or (
      jsonb_typeof(manual_json) = 'object'
      and octet_length(manual_json::text) <= 1048576
    )
  );

comment on column public.receipt_import_files.manual_json is
  'User-submitted receipt JSON awaiting the same worker validation and transactional finalization as provider output.';

alter table public.receipt_import_attempts
  drop constraint receipt_import_attempts_stage_check;

alter table public.receipt_import_attempts
  add constraint receipt_import_attempts_stage_check check (
    stage in (
      'primary_parse', 'fallback_parse', 'independent_check',
      'chunk_parse', 'manual_json', 'worker'
    )
  );

create or replace function public.submit_receipt_import_json(
  p_file_id text,
  p_manual_json jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (auth.jwt() ->> 'email') is null or not public.is_allowed_user() then
    raise exception 'Not authorized';
  end if;
  if p_manual_json is null
     or jsonb_typeof(p_manual_json) is distinct from 'object'
     or octet_length(p_manual_json::text) > 1048576 then
    raise exception 'Manual JSON must be an object no larger than 1 MiB';
  end if;
  if jsonb_typeof(p_manual_json -> 'items') is distinct from 'array' then
    raise exception 'Manual JSON must contain an items array';
  end if;
  if jsonb_array_length(p_manual_json -> 'items') < 1
     or jsonb_array_length(p_manual_json -> 'items') > 500 then
    raise exception 'Manual JSON must contain between 1 and 500 items';
  end if;

  update public.receipt_import_files as f
  set status = 'queued',
      attempts = 0,
      document_kind = null,
      exception_kind = null,
      error_message = null,
      duplicate_receipt_id = null,
      force_receipt = false,
      skip_duplicate_check = false,
      processed_at = null,
      manual_json = p_manual_json
  where f.id = p_file_id
    and f.status = 'needs_review'
    and f.storage_path is not null
    and exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'receipts'
        and o.name = f.storage_path
    );

  if not found then
    raise exception 'Import file cannot accept manual JSON';
  end if;

  perform pgmq.send('receipt_imports', jsonb_build_object('import_file_id', p_file_id));
end;
$$;

-- A normal retry must return to provider parsing instead of replaying the last
-- manual submission.
create or replace function public.requeue_receipt_import_file(
  p_file_id text,
  p_force_receipt boolean default false,
  p_skip_duplicate_check boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_allowed_user() then raise exception 'Not authorized'; end if;
  update public.receipt_import_files
  set status = 'queued', attempts = 0, document_kind = null,
      exception_kind = null, error_message = null, force_receipt = p_force_receipt,
      skip_duplicate_check = p_skip_duplicate_check,
      processed_at = null, manual_json = null
  where id = p_file_id
    and status = 'needs_review';
  if not found then raise exception 'Import file cannot be requeued'; end if;
  perform pgmq.send('receipt_imports', jsonb_build_object('import_file_id', p_file_id));
end;
$$;

-- Invalid manual input must return to review immediately. Keeping parsed_json
-- unchanged preserves the provider result used as the printed-total/count
-- baseline, while manual_json and the attempt journal retain the submission.
create or replace function public.complete_manual_receipt_import_exception(
  p_file_id text,
  p_msg_id bigint,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.receipt_import_files
  set status = 'needs_review',
      document_kind = 'receipt',
      exception_kind = 'validation',
      error_message = left(p_error_message, 4000),
      processed_at = now()
  where id = p_file_id
    and status = 'processing'
    and manual_json is not null;

  if not found then
    raise exception 'Manual import exception cannot be completed';
  end if;

  perform pgmq.archive('receipt_imports', p_msg_id);
end;
$$;

revoke execute on function public.submit_receipt_import_json(text, jsonb)
  from public, anon;
revoke execute on function public.requeue_receipt_import_file(text, boolean, boolean)
  from public, anon;
revoke execute on function public.complete_manual_receipt_import_exception(text, bigint, text)
  from public, anon, authenticated;

grant execute on function public.submit_receipt_import_json(text, jsonb)
  to authenticated;
grant execute on function public.requeue_receipt_import_file(text, boolean, boolean)
  to authenticated;
grant execute on function public.complete_manual_receipt_import_exception(text, bigint, text)
  to service_role;

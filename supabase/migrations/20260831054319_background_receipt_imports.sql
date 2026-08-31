-- Durable background receipt imports.
--
-- The browser uploads prepared files and registers them here. PGMQ keeps the
-- processing work durable after the browser closes; a scheduled Edge Function
-- claims short batches, calls the AI providers, and finalizes each receipt via
-- one transactional RPC.

create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

alter table public.receipts
  add column photo_path text;

create table public.receipt_import_batches (
  id            text primary key,
  uploaded_by   text not null check (uploaded_by like '%@%'),
  paid_by       text not null check (paid_by like '%@%'),
  status        text not null default 'uploading' check (
    status in ('uploading', 'processing', 'completed', 'completed_with_exceptions')
  ),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.receipt_import_files (
  id                    text primary key,
  batch_id              text not null references public.receipt_import_batches(id) on delete cascade,
  original_filename     text not null,
  mime_type              text not null check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  ),
  original_size_bytes   bigint not null check (original_size_bytes > 0),
  content_sha256        text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path          text,
  status                text not null check (
    status in (
      'uploading', 'queued', 'processing', 'saved', 'needs_review',
      'duplicate', 'upload_failed', 'discarded'
    )
  ),
  attempts              integer not null default 0 check (attempts >= 0),
  document_kind         text check (document_kind in ('receipt', 'not_receipt', 'uncertain')),
  exception_kind        text check (
    exception_kind in (
      'not_receipt', 'uncertain', 'possible_duplicate', 'validation',
      'parse_failed', 'save_failed'
    )
  ),
  parsed_json           jsonb,
  error_message         text check (error_message is null or length(error_message) <= 4000),
  receipt_id            text references public.receipts(id) on delete set null,
  duplicate_receipt_id  text references public.receipts(id) on delete set null,
  duplicate_of_file_id  text references public.receipt_import_files(id) on delete set null,
  force_receipt         boolean not null default false,
  skip_duplicate_check  boolean not null default false,
  processed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_receipt_import_batches_created
  on public.receipt_import_batches (created_at desc);
create index idx_receipt_import_files_batch
  on public.receipt_import_files (batch_id, created_at);
create index idx_receipt_import_files_active
  on public.receipt_import_files (status, created_at)
  where status in ('queued', 'processing');
create index idx_receipt_import_files_receipt
  on public.receipt_import_files (receipt_id)
  where receipt_id is not null;
create index idx_receipt_import_files_duplicate_receipt
  on public.receipt_import_files (duplicate_receipt_id)
  where duplicate_receipt_id is not null;
create index idx_receipt_import_files_duplicate_file
  on public.receipt_import_files (duplicate_of_file_id)
  where duplicate_of_file_id is not null;
create unique index receipt_import_files_canonical_hash_uniq
  on public.receipt_import_files (content_sha256)
  where duplicate_of_file_id is null and status not in ('discarded', 'upload_failed');

create trigger trg_receipt_import_batches_updated_at
  before update on public.receipt_import_batches
  for each row execute function public.set_updated_at();

create trigger trg_receipt_import_files_updated_at
  before update on public.receipt_import_files
  for each row execute function public.set_updated_at();

create or replace function public.refresh_receipt_import_batch_status(p_batch_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_has_uploading boolean;
  v_has_processing boolean;
  v_has_exceptions boolean;
begin
  select
    coalesce(bool_or(status = 'uploading'), false),
    coalesce(bool_or(status in ('queued', 'processing')), false),
    coalesce(bool_or(status in ('needs_review', 'duplicate', 'upload_failed')), false)
  into v_has_uploading, v_has_processing, v_has_exceptions
  from public.receipt_import_files
  where batch_id = p_batch_id;

  update public.receipt_import_batches
  set status = case
        when v_has_uploading then 'uploading'
        when v_has_processing then 'processing'
        when v_has_exceptions then 'completed_with_exceptions'
        else 'completed'
      end,
      completed_at = case
        when not v_has_uploading and not v_has_processing then coalesce(completed_at, now())
        else null
      end
  where id = p_batch_id;
end;
$$;

create or replace function public.trg_refresh_receipt_import_batch_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.refresh_receipt_import_batch_status(coalesce(new.batch_id, old.batch_id));
  return coalesce(new, old);
end;
$$;

revoke execute on function public.refresh_receipt_import_batch_status(text) from public, anon, authenticated;
revoke execute on function public.trg_refresh_receipt_import_batch_status() from public, anon, authenticated;

create trigger trg_receipt_import_file_refresh_batch
  after insert or update or delete on public.receipt_import_files
  for each row execute function public.trg_refresh_receipt_import_batch_status();

alter table public.receipt_import_batches enable row level security;
alter table public.receipt_import_files enable row level security;

create policy "allowlist_read_receipt_import_batches"
  on public.receipt_import_batches for select to authenticated
  using ((select public.is_allowed_user()));

create policy "allowlist_read_receipt_import_files"
  on public.receipt_import_files for select to authenticated
  using ((select public.is_allowed_user()));

revoke all on public.receipt_import_batches from anon, authenticated;
revoke all on public.receipt_import_files from anon, authenticated;
grant select on public.receipt_import_batches to authenticated;
grant select on public.receipt_import_files to authenticated;

select pgmq.create('receipt_imports');

create or replace function public.create_receipt_import_batch(
  p_batch_id text,
  p_paid_by text,
  p_files jsonb
)
returns table (
  id text,
  status text,
  storage_path text,
  duplicate_of_file_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := auth.jwt() ->> 'email';
  v_file jsonb;
  v_file_id text;
  v_hash text;
  v_mime text;
  v_ext text;
  v_path text;
  v_existing_id text;
begin
  if v_email is null or not public.is_allowed_user() then
    raise exception 'Not authorized';
  end if;
  if length(p_batch_id) <> 26 then
    raise exception 'Invalid batch id';
  end if;
  if not exists (select 1 from public.app_users where email = p_paid_by) then
    raise exception 'Invalid paid_by';
  end if;
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) < 1
     or jsonb_array_length(p_files) > 200 then
    raise exception 'A batch must contain between 1 and 200 files';
  end if;

  insert into public.receipt_import_batches (id, uploaded_by, paid_by)
  values (p_batch_id, v_email, p_paid_by);

  for v_file in select value from jsonb_array_elements(p_files)
  loop
    v_file_id := v_file ->> 'id';
    v_hash := lower(v_file ->> 'content_sha256');
    v_mime := v_file ->> 'mime_type';
    if length(v_file_id) <> 26 or v_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid import file descriptor';
    end if;
    v_ext := case v_mime
      when 'application/pdf' then 'pdf'
      when 'image/png' then 'png'
      when 'image/webp' then 'webp'
      else 'jpg'
    end;
    v_path := v_email || '/imports/' || p_batch_id || '/' || v_file_id || '.' || v_ext;

    select f.id into v_existing_id
    from public.receipt_import_files f
    where f.content_sha256 = v_hash
      and f.duplicate_of_file_id is null
      and f.status not in ('discarded', 'upload_failed')
    limit 1;

    if v_existing_id is not null then
      insert into public.receipt_import_files (
        id, batch_id, original_filename, mime_type, original_size_bytes,
        content_sha256, status, duplicate_of_file_id
      ) values (
        v_file_id, p_batch_id, coalesce(v_file ->> 'original_filename', 'document'),
        v_mime, (v_file ->> 'original_size_bytes')::bigint,
        v_hash, 'duplicate', v_existing_id
      );
    else
      insert into public.receipt_import_files (
        id, batch_id, original_filename, mime_type, original_size_bytes,
        content_sha256, storage_path, status
      ) values (
        v_file_id, p_batch_id, coalesce(v_file ->> 'original_filename', 'document'),
        v_mime, (v_file ->> 'original_size_bytes')::bigint,
        v_hash, v_path, 'uploading'
      );
    end if;
    v_existing_id := null;
  end loop;

  return query
  select f.id, f.status, f.storage_path, f.duplicate_of_file_id
  from public.receipt_import_files f
  where f.batch_id = p_batch_id
  order by f.created_at, f.id;
end;
$$;

create or replace function public.queue_receipt_import_file(p_file_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.receipt_import_files%rowtype;
  v_email text := auth.jwt() ->> 'email';
begin
  if v_email is null or not public.is_allowed_user() then
    raise exception 'Not authorized';
  end if;
  select f.* into v_file
  from public.receipt_import_files f
  join public.receipt_import_batches b on b.id = f.batch_id
  where f.id = p_file_id and b.uploaded_by = v_email
  for update of f;
  if not found or v_file.status not in ('uploading', 'upload_failed') then
    raise exception 'Import file cannot be queued';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'receipts' and o.name = v_file.storage_path
  ) then
    raise exception 'Uploaded Storage object not found';
  end if;
  update public.receipt_import_files
  set status = 'queued', error_message = null
  where id = p_file_id;
  perform pgmq.send('receipt_imports', jsonb_build_object('import_file_id', p_file_id));
end;
$$;

create or replace function public.mark_receipt_import_upload_failed(
  p_file_id text,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_allowed_user() then raise exception 'Not authorized'; end if;
  update public.receipt_import_files f
  set status = 'upload_failed', error_message = left(p_error_message, 4000)
  from public.receipt_import_batches b
  where f.id = p_file_id and b.id = f.batch_id
    and b.uploaded_by = (auth.jwt() ->> 'email')
    and f.status in ('uploading', 'upload_failed');
end;
$$;

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
      processed_at = null
  where id = p_file_id
    and status = 'needs_review';
  if not found then raise exception 'Import file cannot be requeued'; end if;
  perform pgmq.send('receipt_imports', jsonb_build_object('import_file_id', p_file_id));
end;
$$;

create or replace function public.resolve_receipt_import_file(
  p_file_id text,
  p_receipt_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_allowed_user() then raise exception 'Not authorized'; end if;
  if not exists (select 1 from public.receipts where id = p_receipt_id) then
    raise exception 'Receipt not found';
  end if;
  update public.receipt_import_files
  set status = 'saved', receipt_id = p_receipt_id, exception_kind = null,
      error_message = null, processed_at = now()
  where id = p_file_id and status = 'needs_review';
  if not found then raise exception 'Import file cannot be resolved'; end if;
end;
$$;

create or replace function public.discard_receipt_import_file(p_file_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_allowed_user() then raise exception 'Not authorized'; end if;
  update public.receipt_import_files
  set status = 'discarded', processed_at = now()
  where id = p_file_id and status in ('needs_review', 'upload_failed', 'duplicate');
  if not found then raise exception 'Import file cannot be discarded'; end if;
end;
$$;

revoke execute on function public.create_receipt_import_batch(text, text, jsonb) from public, anon;
revoke execute on function public.queue_receipt_import_file(text) from public, anon;
revoke execute on function public.mark_receipt_import_upload_failed(text, text) from public, anon;
revoke execute on function public.requeue_receipt_import_file(text, boolean, boolean) from public, anon;
revoke execute on function public.resolve_receipt_import_file(text, text) from public, anon;
revoke execute on function public.discard_receipt_import_file(text) from public, anon;
grant execute on function public.create_receipt_import_batch(text, text, jsonb) to authenticated;
grant execute on function public.queue_receipt_import_file(text) to authenticated;
grant execute on function public.mark_receipt_import_upload_failed(text, text) to authenticated;
grant execute on function public.requeue_receipt_import_file(text, boolean, boolean) to authenticated;
grant execute on function public.resolve_receipt_import_file(text, text) to authenticated;
grant execute on function public.discard_receipt_import_file(text) to authenticated;

-- Worker-only RPCs. They are reachable through PostgREST only with the
-- service_role key used inside the scheduled Edge Function.
create or replace function public.expire_stale_receipt_import_uploads()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.receipt_import_files
  set status = 'upload_failed',
      error_message = 'Завантаження не завершилося протягом двох годин. Вибери файл знову.'
  where status = 'uploading' and updated_at < now() - interval '2 hours';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.claim_receipt_import_jobs(p_limit integer default 2)
returns table (msg_id bigint, read_count integer, import_file_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_file_id text;
begin
  for v_job in
    select * from pgmq.read('receipt_imports', 300, greatest(1, least(p_limit, 2)))
  loop
    v_file_id := v_job.message ->> 'import_file_id';
    update public.receipt_import_files
    set status = 'processing', attempts = greatest(attempts, v_job.read_ct)
    where id = v_file_id and status in ('queued', 'processing');
    if found then
      msg_id := v_job.msg_id;
      read_count := v_job.read_ct;
      import_file_id := v_file_id;
      return next;
    else
      perform pgmq.archive('receipt_imports', v_job.msg_id);
    end if;
  end loop;
end;
$$;

create or replace function public.complete_receipt_import_exception(
  p_file_id text,
  p_msg_id bigint,
  p_document_kind text,
  p_exception_kind text,
  p_parsed_json jsonb,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.receipt_import_files
  set status = 'needs_review', document_kind = p_document_kind,
      exception_kind = p_exception_kind, parsed_json = p_parsed_json,
      error_message = left(p_error_message, 4000), processed_at = now()
  where id = p_file_id and status = 'processing';
  perform pgmq.archive('receipt_imports', p_msg_id);
end;
$$;

create or replace function public.record_receipt_import_failure(
  p_file_id text,
  p_msg_id bigint,
  p_read_count integer,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_read_count >= 3 then
    update public.receipt_import_files
    set status = 'needs_review', exception_kind = 'parse_failed',
        error_message = left(p_error_message, 4000), processed_at = now()
    where id = p_file_id and status = 'processing';
    perform pgmq.archive('receipt_imports', p_msg_id);
  else
    update public.receipt_import_files
    set status = 'queued', error_message = left(p_error_message, 4000)
    where id = p_file_id and status = 'processing';
  end if;
end;
$$;

create or replace function public.finalize_receipt_import(
  p_file_id text,
  p_msg_id bigint,
  p_receipt jsonb,
  p_items jsonb,
  p_parsed_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.receipt_import_files%rowtype;
  v_paid_by text;
  v_receipt_id text := p_receipt ->> 'id';
  v_duplicate_id text;
  v_item jsonb;
  v_product_id text;
  v_code text;
  v_candidate_product_id text;
begin
  select f.* into v_file
  from public.receipt_import_files f
  where f.id = p_file_id
  for update of f;

  if not found then raise exception 'Import file not found'; end if;
  select b.paid_by into v_paid_by
  from public.receipt_import_batches b
  where b.id = v_file.batch_id;
  if v_file.receipt_id is not null then
    perform pgmq.archive('receipt_imports', p_msg_id);
    return jsonb_build_object('status', 'saved', 'receipt_id', v_file.receipt_id);
  end if;
  if v_file.status <> 'processing' then raise exception 'Import file is not processing'; end if;

  if not v_file.skip_duplicate_check then
    select r.id into v_duplicate_id
    from public.receipts r
    where lower(trim(r.store)) = lower(trim(p_receipt ->> 'store'))
      and r.date = (p_receipt ->> 'date')::date
      and r.currency = p_receipt ->> 'currency'
      and abs(r.total_orig - (p_receipt ->> 'total_orig')::numeric) <= 0.01
      and (
        r.time is null or nullif(p_receipt ->> 'time', '') is null
        or abs(extract(epoch from (r.time - (p_receipt ->> 'time')::time))) <= 600
      )
    order by r.created_at desc
    limit 1;
  end if;

  if v_duplicate_id is not null then
    update public.receipt_import_files
    set status = 'needs_review', document_kind = 'receipt',
        exception_kind = 'possible_duplicate', parsed_json = p_parsed_json,
        duplicate_receipt_id = v_duplicate_id, processed_at = now()
    where id = p_file_id;
    perform pgmq.archive('receipt_imports', p_msg_id);
    return jsonb_build_object('status', 'needs_review', 'duplicate_receipt_id', v_duplicate_id);
  end if;

  insert into public.receipts (
    id, date, time, store, store_address, currency, total_orig, fx_rate_eur,
    total_eur, paid_by, photo_url, photo_path, source, raw_ocr_json, note
  ) values (
    v_receipt_id, (p_receipt ->> 'date')::date,
    nullif(p_receipt ->> 'time', '')::time, p_receipt ->> 'store',
    nullif(p_receipt ->> 'store_address', ''), p_receipt ->> 'currency',
    (p_receipt ->> 'total_orig')::numeric, (p_receipt ->> 'fx_rate_eur')::numeric,
    (p_receipt ->> 'total_eur')::numeric, v_paid_by,
    nullif(p_receipt ->> 'photo_url', ''), v_file.storage_path,
    'photo', nullif(p_receipt ->> 'raw_ocr_json', ''), null
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_code := nullif(trim(v_item ->> 'store_product_code'), '');
    v_candidate_product_id := v_item ->> 'product_candidate_id';
    v_product_id := null;

    -- Two worker slots can encounter the same new product concurrently. Keep
    -- the store/product resolution section serialized without holding a broad
    -- table lock or leaking a uniqueness error into the retry queue.
    perform pg_advisory_xact_lock(
      hashtextextended(
        (p_receipt ->> 'store') || '|' || coalesce(v_code, v_item ->> 'product_name'),
        0
      )
    );

    if v_code is not null then
      select p.id into v_product_id from public.products p
      where p.store = p_receipt ->> 'store' and p.store_product_code = v_code limit 1;
      if v_product_id is null then
        select p.id into v_product_id from public.products p
        where p.store = p_receipt ->> 'store'
          and p.name = v_item ->> 'product_name'
          and p.store_product_code is null
        limit 1 for update;
        if v_product_id is not null then
          begin
            update public.products set store_product_code = v_code where id = v_product_id;
          exception when unique_violation then
            select p.id into v_product_id from public.products p
            where p.store = p_receipt ->> 'store' and p.store_product_code = v_code limit 1;
          end;
        end if;
      end if;
      if v_product_id is null then
        insert into public.products (id, name, category, store, store_product_code)
        values (
          v_candidate_product_id, v_item ->> 'product_name', v_item ->> 'category',
          p_receipt ->> 'store', v_code
        )
        on conflict (store, store_product_code) where store_product_code is not null do nothing;
        select p.id into v_product_id from public.products p
        where p.store = p_receipt ->> 'store' and p.store_product_code = v_code limit 1;
      end if;
    else
      select p.id into v_product_id from public.products p
      where p.store = p_receipt ->> 'store'
        and p.name = v_item ->> 'product_name'
        and p.store_product_code is null
      limit 1;
      if v_product_id is null then
        insert into public.products (id, name, category, store, store_product_code)
        values (
          v_candidate_product_id, v_item ->> 'product_name', v_item ->> 'category',
          p_receipt ->> 'store', null
        )
        on conflict (store, name) where store_product_code is null do nothing;
        select p.id into v_product_id from public.products p
        where p.store = p_receipt ->> 'store'
          and p.name = v_item ->> 'product_name'
          and p.store_product_code is null
        limit 1;
      end if;
    end if;

    insert into public.items (
      id, receipt_id, product_id, product_name, store_product_code, category,
      qty, unit_price_orig, total_orig, total_eur, consumed_by, note,
      wasted_qty, discount_orig
    ) values (
      v_item ->> 'id', v_receipt_id, v_product_id, v_item ->> 'product_name',
      v_code, v_item ->> 'category', (v_item ->> 'qty')::numeric,
      (v_item ->> 'unit_price_orig')::numeric, (v_item ->> 'total_orig')::numeric,
      (v_item ->> 'total_eur')::numeric, 'shared', nullif(v_item ->> 'note', ''),
      0, (v_item ->> 'discount_orig')::numeric
    );

    insert into public.product_prices (
      id, product_id, receipt_id, price_orig, price_net, currency, date
    ) values (
      v_item ->> 'price_id', v_product_id, v_receipt_id,
      (v_item ->> 'unit_price_orig')::numeric,
      (v_item ->> 'price_net')::numeric,
      p_receipt ->> 'currency', (p_receipt ->> 'date')::date
    );
  end loop;

  update public.receipt_import_files
  set status = 'saved', document_kind = 'receipt', parsed_json = p_parsed_json,
      receipt_id = v_receipt_id, exception_kind = null, error_message = null,
      processed_at = now()
  where id = p_file_id;
  perform pgmq.archive('receipt_imports', p_msg_id);
  return jsonb_build_object('status', 'saved', 'receipt_id', v_receipt_id);
end;
$$;

revoke execute on function public.claim_receipt_import_jobs(integer) from public, anon, authenticated;
revoke execute on function public.expire_stale_receipt_import_uploads() from public, anon, authenticated;
revoke execute on function public.complete_receipt_import_exception(text, bigint, text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.record_receipt_import_failure(text, bigint, integer, text) from public, anon, authenticated;
revoke execute on function public.finalize_receipt_import(text, bigint, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.claim_receipt_import_jobs(integer) to service_role;
grant execute on function public.expire_stale_receipt_import_uploads() to service_role;
grant execute on function public.complete_receipt_import_exception(text, bigint, text, text, jsonb, text) to service_role;
grant execute on function public.record_receipt_import_failure(text, bigint, integer, text) to service_role;
grant execute on function public.finalize_receipt_import(text, bigint, jsonb, jsonb, jsonb) to service_role;

-- The scheduled request becomes active after two Vault secrets are configured:
--   project_url                       = https://<project-ref>.supabase.co
--   receipt_import_service_role_key   = the project's service_role key
-- The function also compares the Bearer token with its auto-injected
-- SUPABASE_SERVICE_ROLE_KEY before doing any work.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'process-receipt-imports') then
    perform cron.schedule(
      'process-receipt-imports',
      '30 seconds',
      $job$
        with secrets as (
          select
            max(decrypted_secret) filter (where name = 'project_url') as project_url,
            max(decrypted_secret) filter (
              where name = 'receipt_import_service_role_key'
            ) as service_role_key
          from vault.decrypted_secrets
        )
        select net.http_post(
          url := secrets.project_url || '/functions/v1/process-receipt-imports',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || secrets.service_role_key
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 140000
        )
        from secrets
        where secrets.project_url is not null and secrets.service_role_key is not null;
      $job$
    );
  end if;
end;
$$;

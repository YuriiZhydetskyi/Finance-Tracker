-- A pasted JSON batch has no uploaded binary, but it follows the same durable
-- queue, validation and review lifecycle as a file-backed batch.
create extension if not exists pgcrypto with schema extensions;

alter table public.receipt_import_files
  drop constraint receipt_import_files_mime_type_check;

alter table public.receipt_import_files
  add constraint receipt_import_files_mime_type_check check (
    mime_type in (
      'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/json'
    )
  );

create or replace function public.create_manual_receipt_import_batch(
  p_batch_id text,
  p_paid_by text,
  p_receipts jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := auth.jwt() ->> 'email';
  v_receipt jsonb;
  v_file_id text;
  v_existing_id text;
  v_hash text;
  v_index integer := 0;
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
  if jsonb_typeof(p_receipts) <> 'array' or jsonb_array_length(p_receipts) < 1
     or jsonb_array_length(p_receipts) > 200 then
    raise exception 'A batch must contain between 1 and 200 JSON receipts';
  end if;
  if octet_length(p_receipts::text) > 10485760 then
    raise exception 'A JSON batch must not exceed 10 MiB';
  end if;

  insert into public.receipt_import_batches (id, uploaded_by, paid_by)
  values (p_batch_id, v_email, p_paid_by);

  for v_receipt in select value from jsonb_array_elements(p_receipts)
  loop
    v_index := v_index + 1;
    if jsonb_typeof(v_receipt) <> 'object'
       or octet_length(v_receipt::text) > 1048576
       or jsonb_typeof(v_receipt -> 'items') <> 'array'
       or jsonb_array_length(v_receipt -> 'items') < 1
       or jsonb_array_length(v_receipt -> 'items') > 500 then
      raise exception 'Each JSON receipt must be an object with 1 to 500 items and be at most 1 MiB';
    end if;

    -- Import-file ids only need be unique text keys. Deriving them from the
    -- already validated batch id makes the queue audit deterministic without
    -- accepting arbitrary file ids from the client.
    v_file_id := p_batch_id || '-' || lpad(v_index::text, 3, '0');
    v_hash := encode(extensions.digest(convert_to(v_receipt::text, 'UTF8'), 'sha256'), 'hex');

    select f.id into v_existing_id
    from public.receipt_import_files f
    where f.content_sha256 = v_hash
      and f.duplicate_of_file_id is null
      and f.status not in ('discarded', 'upload_failed')
    limit 1;

    if v_existing_id is not null then
      insert into public.receipt_import_files (
        id, batch_id, original_filename, mime_type, original_size_bytes,
        content_sha256, storage_path, status, duplicate_of_file_id, manual_json
      ) values (
        v_file_id, p_batch_id, 'Вставлений JSON #' || v_index::text,
        'application/json', octet_length(v_receipt::text),
        v_hash, null, 'duplicate', v_existing_id, v_receipt
      );
    else
      insert into public.receipt_import_files (
        id, batch_id, original_filename, mime_type, original_size_bytes,
        content_sha256, storage_path, status, manual_json
      ) values (
        v_file_id, p_batch_id, 'Вставлений JSON #' || v_index::text,
        'application/json', octet_length(v_receipt::text),
        v_hash, null, 'queued', v_receipt
      );
      perform pgmq.send('receipt_imports', jsonb_build_object('import_file_id', v_file_id));
    end if;
  end loop;
end;
$$;

-- This specialized finalizer is deliberately separate from the photo one:
-- pasted JSON has neither Storage evidence nor a photo path, and must retain
-- Amazon's order/product metadata while being labelled as manual-json.
create or replace function public.finalize_pasted_json_import(
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

  if not found or v_file.storage_path is not null or v_file.manual_json is null then
    raise exception 'Pasted JSON import metadata unavailable';
  end if;
  select b.paid_by into v_paid_by
  from public.receipt_import_batches b
  where b.id = v_file.batch_id;
  if v_file.receipt_id is not null then
    perform pgmq.archive('receipt_imports', p_msg_id);
    return jsonb_build_object('status', 'saved', 'receipt_id', v_file.receipt_id);
  end if;
  if v_file.status <> 'processing' then raise exception 'Import file is not processing'; end if;

  if not v_file.skip_duplicate_check then
    if nullif(p_receipt ->> 'merchant_order_id', '') is not null then
      -- The Amazon order index is the final dedupe guard. Serialize its
      -- lookup-and-insert path too, so concurrent queue deliveries turn into
      -- reviewable duplicates instead of a transient uniqueness failure.
      perform pg_advisory_xact_lock(
        hashtextextended(
          (p_receipt ->> 'store') || '|' || (p_receipt ->> 'merchant_order_id'),
          0
        )
      );
      select r.id into v_duplicate_id
      from public.receipts r
      where lower(trim(r.store)) = lower(trim(p_receipt ->> 'store'))
        and r.merchant_order_id = p_receipt ->> 'merchant_order_id'
      limit 1;
    else
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
    total_eur, paid_by, photo_url, photo_path, merchant_order_id, source, raw_ocr_json, note
  ) values (
    v_receipt_id, (p_receipt ->> 'date')::date,
    nullif(p_receipt ->> 'time', '')::time, p_receipt ->> 'store',
    nullif(p_receipt ->> 'store_address', ''), p_receipt ->> 'currency',
    (p_receipt ->> 'total_orig')::numeric, (p_receipt ->> 'fx_rate_eur')::numeric,
    (p_receipt ->> 'total_eur')::numeric, v_paid_by,
    null, null, nullif(p_receipt ->> 'merchant_order_id', ''),
    'manual-json', nullif(p_receipt ->> 'raw_ocr_json', ''), null
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_code := nullif(trim(v_item ->> 'store_product_code'), '');
    v_candidate_product_id := v_item ->> 'product_candidate_id';
    v_product_id := null;
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
      id, receipt_id, product_id, product_name, store_product_code, product_url,
      product_image_url, category, qty, unit_price_orig, total_orig, total_eur,
      consumed_by, note, wasted_qty, discount_orig
    ) values (
      v_item ->> 'id', v_receipt_id, v_product_id, v_item ->> 'product_name',
      v_code, nullif(v_item ->> 'product_url', ''), nullif(v_item ->> 'product_image_url', ''),
      v_item ->> 'category', (v_item ->> 'qty')::numeric,
      (v_item ->> 'unit_price_orig')::numeric, (v_item ->> 'total_orig')::numeric,
      (v_item ->> 'total_eur')::numeric, 'shared', nullif(v_item ->> 'note', ''),
      0, (v_item ->> 'discount_orig')::numeric
    );

    insert into public.product_prices (
      id, product_id, receipt_id, price_orig, price_net, currency, date
    ) values (
      v_item ->> 'price_id', v_product_id, v_receipt_id,
      (v_item ->> 'unit_price_orig')::numeric, (v_item ->> 'price_net')::numeric,
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

revoke execute on function public.create_manual_receipt_import_batch(text, text, jsonb)
  from public, anon;
revoke execute on function public.finalize_pasted_json_import(text, bigint, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_manual_receipt_import_batch(text, text, jsonb)
  to authenticated;
grant execute on function public.finalize_pasted_json_import(text, bigint, jsonb, jsonb, jsonb)
  to service_role;

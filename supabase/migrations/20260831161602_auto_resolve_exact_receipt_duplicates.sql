-- Exact date/time/currency/total matches are deterministic enough to resolve
-- automatically. The broader store/date/amount/nearby-time heuristic remains
-- a manual-review signal.

create index if not exists idx_receipts_exact_purchase
  on public.receipts (date, time, currency, total_orig)
  where time is not null;

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
  v_receipt_date date := (p_receipt ->> 'date')::date;
  v_receipt_time time := nullif(p_receipt ->> 'time', '')::time;
  v_receipt_currency text := p_receipt ->> 'currency';
  v_receipt_total numeric := (p_receipt ->> 'total_orig')::numeric;
  v_exact_duplicate_id text;
  v_possible_duplicate_id text;
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
    if v_receipt_time is not null then
      -- Serialize identical fingerprints so two workers cannot both pass the
      -- lookup before either transaction inserts its receipt.
      perform pg_advisory_xact_lock(
        hashtextextended(
          v_receipt_date::text || '|' || v_receipt_time::text || '|' ||
          v_receipt_currency || '|' || v_receipt_total::text,
          0
        )
      );

      select r.id into v_exact_duplicate_id
      from public.receipts r
      where r.date = v_receipt_date
        and r.time = v_receipt_time
        and r.currency = v_receipt_currency
        and r.total_orig = v_receipt_total
      order by r.created_at desc
      limit 1;
    end if;

    if v_exact_duplicate_id is null then
      select r.id into v_possible_duplicate_id
      from public.receipts r
      where lower(trim(r.store)) = lower(trim(p_receipt ->> 'store'))
        and r.date = v_receipt_date
        and r.currency = v_receipt_currency
        and abs(r.total_orig - v_receipt_total) <= 0.01
        and (
          r.time is null or v_receipt_time is null
          or abs(extract(epoch from (r.time - v_receipt_time))) <= 600
        )
      order by r.created_at desc
      limit 1;
    end if;
  end if;

  if v_exact_duplicate_id is not null then
    update public.receipt_import_files
    set status = 'saved', document_kind = 'receipt', parsed_json = p_parsed_json,
        receipt_id = v_exact_duplicate_id, duplicate_receipt_id = v_exact_duplicate_id,
        exception_kind = null, error_message = null, processed_at = now()
    where id = p_file_id;
    perform pgmq.archive('receipt_imports', p_msg_id);
    return jsonb_build_object(
      'status', 'saved',
      'receipt_id', v_exact_duplicate_id,
      'auto_duplicate', true
    );
  end if;

  if v_possible_duplicate_id is not null then
    update public.receipt_import_files
    set status = 'needs_review', document_kind = 'receipt',
        exception_kind = 'possible_duplicate', parsed_json = p_parsed_json,
        duplicate_receipt_id = v_possible_duplicate_id, processed_at = now()
    where id = p_file_id;
    perform pgmq.archive('receipt_imports', p_msg_id);
    return jsonb_build_object(
      'status', 'needs_review',
      'duplicate_receipt_id', v_possible_duplicate_id
    );
  end if;

  insert into public.receipts (
    id, date, time, store, store_address, currency, total_orig, fx_rate_eur,
    total_eur, paid_by, photo_url, photo_path, source, raw_ocr_json, note
  ) values (
    v_receipt_id, v_receipt_date,
    v_receipt_time, p_receipt ->> 'store',
    nullif(p_receipt ->> 'store_address', ''), v_receipt_currency,
    v_receipt_total, (p_receipt ->> 'fx_rate_eur')::numeric,
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
      v_receipt_currency, v_receipt_date
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

revoke execute on function public.finalize_receipt_import(text, bigint, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_receipt_import(text, bigint, jsonb, jsonb, jsonb)
  to service_role;

-- Apply the same deterministic rule to imports that reached manual review
-- before this migration. Keeping duplicate_receipt_id preserves the audit link.
update public.receipt_import_files f
set status = 'saved',
    receipt_id = f.duplicate_receipt_id,
    exception_kind = null,
    error_message = null,
    processed_at = now()
from public.receipts r
where f.status = 'needs_review'
  and f.exception_kind = 'possible_duplicate'
  and f.duplicate_receipt_id = r.id
  and r.time is not null
  and nullif(f.parsed_json ->> 'time', '') is not null
  and r.date = (f.parsed_json ->> 'date')::date
  and r.time = nullif(f.parsed_json ->> 'time', '')::time
  and r.currency = f.parsed_json ->> 'currency'
  and r.total_orig = (f.parsed_json ->> 'total_orig')::numeric;

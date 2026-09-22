-- Atomic receipt save/replace for the manual, photo and edit flows.
--
-- The browser used to issue 5-7 sequential PostgREST writes (products,
-- backfills, enrichments, receipt, items, price snapshots) with a best-effort
-- manual rollback on save and none at all on edit. This function performs the
-- same writes inside one transaction. Product resolution stays client-side
-- (web/src/features/receipts/api/resolve-products.ts); this function only
-- writes what it is given. security invoker keeps the caller's RLS in force.

create or replace function public.save_receipt_bundle(
  p_receipt jsonb,
  p_items jsonb,
  p_new_products jsonb default '[]'::jsonb,
  p_product_backfills jsonb default '[]'::jsonb,
  p_product_enrichments jsonb default '[]'::jsonb,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_receipt_id text := p_receipt ->> 'id';
  v_currency text := p_receipt ->> 'currency';
  v_date date := (p_receipt ->> 'date')::date;
  v_enrichment jsonb;
  v_items_count integer;
begin
  if v_receipt_id is null then
    raise exception 'save_receipt_bundle: receipt id is required';
  end if;

  -- 1. Products first: items reference them by id.
  insert into public.products (
    id, name, store, store_product_code, category, unit, unit_size, notes,
    product_family_id, product_variant_id, brand, is_organic, created_at, updated_at
  )
  select p.id, p.name, p.store, p.store_product_code, p.category,
         p.unit::public.product_unit, p.unit_size, p.notes,
         p.product_family_id, p.product_variant_id, p.brand, p.is_organic,
         coalesce(p.created_at, now()), coalesce(p.updated_at, now())
    from jsonb_to_recordset(coalesce(p_new_products, '[]'::jsonb)) as p(
      id text, name text, store text, store_product_code text, category text,
      unit text, unit_size numeric, notes text, product_family_id text,
      product_variant_id text, brand text, is_organic boolean,
      created_at timestamptz, updated_at timestamptz
    );

  update public.products p
     set store_product_code = b.store_product_code
    from jsonb_to_recordset(coalesce(p_product_backfills, '[]'::jsonb))
           as b(id text, store_product_code text)
   where p.id = b.id;

  -- A key present with a null value means "set null"; an absent key means "keep".
  for v_enrichment in
    select value from jsonb_array_elements(coalesce(p_product_enrichments, '[]'::jsonb))
  loop
    update public.products
       set product_family_id = case when v_enrichment ? 'product_family_id'
             then v_enrichment ->> 'product_family_id' else product_family_id end,
           product_variant_id = case when v_enrichment ? 'product_variant_id'
             then v_enrichment ->> 'product_variant_id' else product_variant_id end,
           brand = case when v_enrichment ? 'brand'
             then v_enrichment ->> 'brand' else brand end,
           is_organic = case when v_enrichment ? 'is_organic'
             then (v_enrichment ->> 'is_organic')::boolean else is_organic end
     where id = v_enrichment ->> 'id';
  end loop;

  -- 2. Receipt row. Replace mode must update the receipt BEFORE items are
  --    inserted: trigger apply_product_match_rule() reads receipts.source and
  --    skips rules for 'edit' receipts.
  if p_replace then
    update public.receipts set
      date = v_date,
      time = nullif(p_receipt ->> 'time', '')::time,
      store = p_receipt ->> 'store',
      store_address = p_receipt ->> 'store_address',
      currency = v_currency,
      total_orig = (p_receipt ->> 'total_orig')::numeric,
      fx_rate_eur = (p_receipt ->> 'fx_rate_eur')::numeric,
      total_eur = (p_receipt ->> 'total_eur')::numeric,
      paid_by = p_receipt ->> 'paid_by',
      photo_url = p_receipt ->> 'photo_url',
      photo_path = p_receipt ->> 'photo_path',
      merchant_order_id = p_receipt ->> 'merchant_order_id',
      source = (p_receipt ->> 'source')::public.receipt_source,
      raw_ocr_json = p_receipt ->> 'raw_ocr_json',
      note = p_receipt ->> 'note',
      updated_at = coalesce((p_receipt ->> 'updated_at')::timestamptz, now())
    where id = v_receipt_id;
    if not found then
      raise exception 'save_receipt_bundle: receipt % not found', v_receipt_id
        using errcode = 'P0002';
    end if;
    -- product_prices only cascades on receipt delete, so scrub it explicitly.
    delete from public.product_prices where receipt_id = v_receipt_id;
    delete from public.items where receipt_id = v_receipt_id;
  else
    insert into public.receipts (
      id, date, time, store, store_address, currency, total_orig, fx_rate_eur,
      total_eur, paid_by, photo_url, photo_path, merchant_order_id, source,
      raw_ocr_json, note, created_at, updated_at
    ) values (
      v_receipt_id, v_date, nullif(p_receipt ->> 'time', '')::time,
      p_receipt ->> 'store', p_receipt ->> 'store_address', v_currency,
      (p_receipt ->> 'total_orig')::numeric, (p_receipt ->> 'fx_rate_eur')::numeric,
      (p_receipt ->> 'total_eur')::numeric, p_receipt ->> 'paid_by',
      p_receipt ->> 'photo_url', p_receipt ->> 'photo_path',
      p_receipt ->> 'merchant_order_id',
      (p_receipt ->> 'source')::public.receipt_source,
      p_receipt ->> 'raw_ocr_json', p_receipt ->> 'note',
      coalesce((p_receipt ->> 'created_at')::timestamptz, now()),
      coalesce((p_receipt ->> 'updated_at')::timestamptz, now())
    );
  end if;

  -- 3. Items, then price snapshots from the rows as actually inserted
  --    (BEFORE triggers may rewrite product_id via product_match_rules).
  with inserted as (
    insert into public.items (
      id, receipt_id, product_id, product_name, raw_product_name, store_product_code,
      product_url, product_image_url, product_family_id, product_variant_id, category,
      qty, unit_price_orig, discount_orig, total_orig, total_eur, consumed_by, note,
      wasted_qty, wasted_at, created_at, updated_at
    )
    select i.id, v_receipt_id, i.product_id, i.product_name, i.raw_product_name,
           i.store_product_code, i.product_url, i.product_image_url,
           i.product_family_id, i.product_variant_id, i.category,
           i.qty, i.unit_price_orig, coalesce(i.discount_orig, 0), i.total_orig, i.total_eur,
           i.consumed_by, i.note, coalesce(i.wasted_qty, 0), i.wasted_at,
           coalesce(i.created_at, now()), coalesce(i.updated_at, now())
      from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as i(
        id text, product_id text, product_name text, raw_product_name text,
        store_product_code text, product_url text, product_image_url text,
        product_family_id text, product_variant_id text, category text,
        qty numeric, unit_price_orig numeric, discount_orig numeric,
        total_orig numeric, total_eur numeric, consumed_by text, note text,
        wasted_qty numeric, wasted_at timestamptz,
        created_at timestamptz, updated_at timestamptz
      )
    returning id, product_id, unit_price_orig, discount_orig
  )
  insert into public.product_prices (
    id, product_id, receipt_id, price_orig, price_net, currency, date
  )
  select src.price_id, ins.product_id, v_receipt_id, ins.unit_price_orig,
         round(ins.unit_price_orig - ins.discount_orig, 2), v_currency, v_date
    from inserted ins
    join jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as src(id text, price_id text)
      on src.id = ins.id
   where ins.product_id is not null and src.price_id is not null;

  select count(*) into v_items_count from public.items where receipt_id = v_receipt_id;
  return jsonb_build_object('receipt_id', v_receipt_id, 'items_count', v_items_count);
end;
$$;

revoke execute on function public.save_receipt_bundle(jsonb, jsonb, jsonb, jsonb, jsonb, boolean)
  from public, anon;
grant execute on function public.save_receipt_bundle(jsonb, jsonb, jsonb, jsonb, jsonb, boolean)
  to authenticated, service_role;

comment on function public.save_receipt_bundle(jsonb, jsonb, jsonb, jsonb, jsonb, boolean) is
  'Atomic insert (p_replace=false) or full replace (p_replace=true) of a receipt with its items, product side-effects and price snapshots. Product resolution happens client-side (resolve-products.ts); this function only writes.';

-- Data fix for ADR-0033: merge the duplicate store rows by rule, then write every
-- store in its canonical spelling.
--
-- What this does NOT do: delete or merge a receipt; merge a pair whose code,
-- name or classification the rule cannot vouch for (only tier 1 and tier 2 of
-- merge_duplicate_products are touched); decide a conflict. Every pair it skips
-- is listed below as a NOTICE and stays exactly as it was.
--
-- To read this migration's output without keeping its changes, run it in
-- Studio inside begin; ... rollback;. Every NOTICE line names the rows.

do $$
declare
  r record;
  v_products integer;
  v_items integer;
  v_items_unlinked integer;
  v_prices integer;
  v_rules integer;
  v_receipts integer;
  v_merged integer := 0;
  v_items_moved integer := 0;
  v_skipped integer := 0;
  v_products_restored integer;
  v_products_left integer;
  v_receipts_restored integer;
  v_receipts_left integer;
  v_rules_rekeyed integer := 0;
  v_rules_deduplicated integer := 0;
  v_rules_left integer := 0;
begin
  select count(*) into v_products from public.products;
  select count(*) into v_items from public.items;
  select count(*) into v_items_unlinked from public.items where product_id is null;
  select count(*) into v_prices from public.product_prices;
  select count(*) into v_rules from public.product_match_rules;
  select count(*) into v_receipts from public.receipts;

  -- ── 1. Merge duplicate store rows (tier 1: same code, tier 2: same name, no code) ──
  for r in select * from public.merge_duplicate_products(false) loop
    if r.status = 'merged' then
      v_merged := v_merged + 1;
      v_items_moved := v_items_moved + coalesce((r.detail ->> 'items')::integer, 0);
      raise notice 'MERGED  tier % [%] kept % <- dropped % (% item(s) re-pointed)',
        r.tier, r.identity_key, r.keep_id, r.drop_id, coalesce(r.detail ->> 'items', '0');
    else
      v_skipped := v_skipped + 1;
      raise notice 'SKIPPED tier % [%] keep % / drop %: % %',
        r.tier, r.identity_key, r.keep_id, r.drop_id, r.status, r.detail::text;
    end if;
  end loop;

  -- ── 2. products.store -> canonical spelling ──
  -- A row whose canonical spelling would collide with another row on the
  -- (store, code) / (store, name) unique indexes keeps its own spelling: that
  -- is a pair the owner still has to decide (a skipped conflict above).
  with target as (
    select p.id, p.store, public.canonical_store_name(p.store) as canon,
           case when p.store_product_code is not null then 'c:' || p.store_product_code
                else 'n:' || p.name end as identity
      from public.products p
  ),
  sized as (
    select t.*, count(*) over (partition by t.canon, t.identity) as same_identity
      from target t
  ),
  restored as (
    update public.products p
       set store = s.canon
      from sized s
     where s.id = p.id and s.store <> s.canon and s.same_identity = 1
    returning p.id
  )
  select count(*) into v_products_restored from restored;

  select count(*) into v_products_left
    from public.products p where p.store <> public.canonical_store_name(p.store);
  for r in
    select p.id, p.store, p.store_product_code, p.name, public.canonical_store_name(p.store) as canon
      from public.products p where p.store <> public.canonical_store_name(p.store)
     order by p.store, p.name
  loop
    raise notice 'STAYS   product % "%" (code %) is stored as "%", canonical is "%": a twin holds that name',
      r.id, r.name, coalesce(r.store_product_code, '-'), r.store, r.canon;
  end loop;

  -- ── 3. receipts.store -> canonical spelling, the printed one kept aside ──
  alter table public.receipts disable trigger trg_receipts_updated_at;
  with target as (
    select t.id, t.store, public.canonical_store_name(t.store) as canon, t.merchant_order_id
      from public.receipts t
  ),
  sized as (
    select t.*, count(*) over (partition by t.canon, t.merchant_order_id) as same_order
      from target t
  ),
  restored as (
    update public.receipts rc
       set store_printed = coalesce(rc.store_printed, rc.store),
           store = s.canon
      from sized s
     where s.id = rc.id and s.store <> s.canon
       and (s.merchant_order_id is null or s.same_order = 1)
    returning rc.id
  )
  select count(*) into v_receipts_restored from restored;
  alter table public.receipts enable trigger trg_receipts_updated_at;

  select count(*) into v_receipts_left
    from public.receipts rc where rc.store <> public.canonical_store_name(rc.store);
  for r in
    select rc.id, rc.store, public.canonical_store_name(rc.store) as canon, rc.merchant_order_id
      from public.receipts rc where rc.store <> public.canonical_store_name(rc.store)
     order by rc.store, rc.id
  loop
    raise notice 'STAYS   receipt % is stored as "%", canonical is "%": another receipt already carries order id %',
      r.id, r.store, r.canon, r.merchant_order_id;
  end loop;

  -- ── 4. Learned rules are keyed by the lower-cased store; follow the rename ──
  for r in
    select m.store_key, m.raw_product_name_key, m.product_id,
           public.normalize_product_match_key(public.canonical_store_name(m.store_key)) as new_key
      from public.product_match_rules m
     where m.store_key <> public.normalize_product_match_key(public.canonical_store_name(m.store_key))
     order by m.created_at, m.store_key, m.raw_product_name_key
  loop
    begin
      update public.product_match_rules
         set store_key = r.new_key
       where store_key = r.store_key and raw_product_name_key = r.raw_product_name_key;
      v_rules_rekeyed := v_rules_rekeyed + 1;
    exception when unique_violation then
      if exists (
        select 1 from public.product_match_rules t
         where t.store_key = r.new_key and t.raw_product_name_key = r.raw_product_name_key
           and t.product_id = r.product_id
      ) then
        delete from public.product_match_rules
         where store_key = r.store_key and raw_product_name_key = r.raw_product_name_key;
        v_rules_deduplicated := v_rules_deduplicated + 1;
      else
        v_rules_left := v_rules_left + 1;
        raise notice 'STAYS   rule "%" / "%": the canonical key already maps this label to another product',
          r.store_key, r.raw_product_name_key;
      end if;
    end;
  end loop;

  -- ── 5. Nothing may have been lost ──
  if (select count(*) from public.products) <> v_products - v_merged then
    raise exception 'canonical stores: products % -> %, expected % after % merge(s)',
      v_products, (select count(*) from public.products), v_products - v_merged, v_merged;
  end if;
  if (select count(*) from public.items) <> v_items
     or (select count(*) from public.items where product_id is null) <> v_items_unlinked
     or (select count(*) from public.product_prices) <> v_prices
     or (select count(*) from public.receipts) <> v_receipts then
    raise exception 'canonical stores: an item, price or receipt row was lost or orphaned';
  end if;
  if (select count(*) from public.product_match_rules) <> v_rules - v_rules_deduplicated then
    raise exception 'canonical stores: product_match_rules % -> %, expected %',
      v_rules, (select count(*) from public.product_match_rules), v_rules - v_rules_deduplicated;
  end if;

  raise notice 'canonical stores: products % -> % (% pair(s) merged, % item(s) re-pointed, % pair(s) skipped for the owner)',
    v_products, v_products - v_merged, v_merged, v_items_moved, v_skipped;
  raise notice 'canonical stores: products re-stored %, left on their own spelling %; receipts re-stored % (printed spelling kept), left %; rules re-keyed %, deduplicated %, left %',
    v_products_restored, v_products_left, v_receipts_restored, v_receipts_left,
    v_rules_rekeyed, v_rules_deduplicated, v_rules_left;
  raise notice 'canonical stores: items %, items without a product %, product_prices %, receipts % (all unchanged)',
    v_items, v_items_unlinked, v_prices, v_receipts;
end;
$$;

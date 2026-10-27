-- Merging two store rows of one product (ADR-0033).
--
-- A merge deletes a products row, and three tables point at products.id with
-- three different ON DELETE actions: items SET NULL (a delete before re-pointing
-- silently orphans purchases), product_prices RESTRICT, product_match_rules
-- CASCADE (a delete silently throws the owner's learned rules away). Everything
-- here is built so that none of those can happen, and so that a merge can be
-- undone from a log.

-- ── Audit log ───────────────────────────────────────────────────────────────
create table public.product_merge_log (
  id            bigint generated always as identity primary key,
  merged_at     timestamptz not null default now(),
  merged_by     text default coalesce(auth.jwt() ->> 'email', current_user),
  keep_id       text not null,
  drop_id       text not null,
  keep_before   jsonb not null,
  drop_row      jsonb not null,
  item_ids      text[] not null default '{}',
  item_taxonomy jsonb  not null default '[]'::jsonb,
  price_ids     text[] not null default '{}',
  rule_keys     jsonb  not null default '[]'::jsonb,
  resolution    jsonb  not null default '{}'::jsonb,
  reverted_at   timestamptz
);

comment on table public.product_merge_log is
  'One row per merge_products() call that changed data. keep_before/drop_row are the two products rows before the merge; item_ids/price_ids/rule_keys are exactly what was re-pointed; item_taxonomy is each item''s family/variant snapshot. unmerge_product() reads it.';

-- A row can be dropped once; after an unmerge it may be dropped again.
create unique index product_merge_log_drop_active_uniq
  on public.product_merge_log (drop_id) where reverted_at is null;
create index idx_product_merge_log_keep on public.product_merge_log (keep_id);

alter table public.product_merge_log enable row level security;
revoke all on public.product_merge_log from public, anon, authenticated;
-- No delete: the log is append-only for the app roles.
grant select, insert, update on public.product_merge_log to authenticated;
grant all on public.product_merge_log to service_role;

create policy allowlist_all_product_merge_log on public.product_merge_log
  for all to authenticated
  using ((select public.is_allowed_user()))
  with check ((select public.is_allowed_user()));

-- ── merge_products ──────────────────────────────────────────────────────────
-- p_dry_run defaults to TRUE: applying needs an explicit false. A dry run takes
-- no locks and writes nothing; it returns the counts, the resulting values and
-- every conflict.
--
-- p_resolution settles conflicts that are never chosen silently:
--   {"prefer": "keep"|"drop"}                          every blocking field
--   {"packaged_product_id" | "taxonomy" | "is_organic" | "unit": "keep"|"drop"}
--   {"category": "drop"}                               category is otherwise the survivor's
--
-- Order of work, and why:
--   1. rules, prices, items re-pointed to the survivor BEFORE the delete;
--   2. the delete, only after proving nothing still references the row;
--   3. only then the survivor absorbs the dropped row's code, otherwise it would
--      collide with the row that still holds it on (store, store_product_code).
create function public.merge_products(
  p_keep_id    text,
  p_drop_id    text,
  p_dry_run    boolean default true,
  p_resolution jsonb   default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_keep public.products%rowtype;
  v_drop public.products%rowtype;
  v_log  public.product_merge_log%rowtype;
  v_conflicts jsonb := '[]'::jsonb;
  v_pref text := p_resolution ->> 'prefer';
  v_choice text;
  v_store text;
  v_pp text;
  v_na boolean;
  v_na_reason text;
  v_family text;
  v_variant text;
  v_category text;
  v_organic boolean;
  v_unit public.product_unit;
  v_unit_size numeric;
  v_notes text;
  v_code text;
  v_item_ids text[];
  v_item_taxonomy jsonb;
  v_price_ids text[];
  v_rule_keys jsonb;
  v_n_items integer;
  v_n_prices integer;
  v_n_rules integer;
  v_rows integer;
  v_plan jsonb;
begin
  if p_keep_id is null or p_drop_id is null or p_keep_id = p_drop_id then
    raise exception 'merge_products: keep and drop must be two different ids' using errcode = '22023';
  end if;
  if jsonb_typeof(p_resolution) is distinct from 'object' then
    raise exception 'merge_products: p_resolution must be a JSON object' using errcode = '22023';
  end if;

  -- Lock both rows in id order: two merges cannot deadlock, and the importers'
  -- FOR UPDATE on a products row waits for the merge. Only then read the log, so
  -- a concurrent identical call that lost the race sees the winner's log row.
  if not p_dry_run then
    perform 1 from public.products where id in (p_keep_id, p_drop_id) order by id for update;
  end if;

  select * into v_log from public.product_merge_log
   where drop_id = p_drop_id and reverted_at is null;
  if found then
    if v_log.keep_id = p_keep_id then
      return jsonb_build_object('status', 'already_merged', 'log_id', v_log.id);
    end if;
    raise exception 'merge_products: % was already merged into %', p_drop_id, v_log.keep_id
      using errcode = '23505';
  end if;

  select * into v_keep from public.products where id = p_keep_id;
  if not found then
    raise exception 'merge_products: keep product % not found', p_keep_id using errcode = 'P0002';
  end if;
  select * into v_drop from public.products where id = p_drop_id;
  if not found then
    raise exception 'merge_products: drop product % not found', p_drop_id using errcode = 'P0002';
  end if;

  -- ── identity: a merge never changes what the row is ───────────────────────
  v_store := public.canonical_store_name(v_keep.store);
  if v_store is distinct from public.canonical_store_name(v_drop.store) then
    raise exception 'merge_products: different stores (% vs %)', v_keep.store, v_drop.store
      using errcode = '22023';
  end if;
  if v_keep.store_product_code is not null and v_drop.store_product_code is not null
     and v_keep.store_product_code <> v_drop.store_product_code then
    raise exception 'merge_products: different store_product_code (% vs %)',
      v_keep.store_product_code, v_drop.store_product_code using errcode = '22023';
  end if;

  -- ── field resolution: blocking conflicts are listed, never silently chosen ──
  -- Packaging state: linked to a card / "no packaging" / still open. Two decided
  -- states that differ are a human decision.
  if (v_keep.packaged_product_id is not null or v_keep.packaging_not_applicable)
     and (v_drop.packaged_product_id is not null or v_drop.packaging_not_applicable)
     and v_keep.packaged_product_id is distinct from v_drop.packaged_product_id then
    v_choice := coalesce(p_resolution ->> 'packaged_product_id', v_pref);
    if v_choice = 'drop' then
      v_pp := v_drop.packaged_product_id;
      v_na := v_drop.packaging_not_applicable and v_drop.packaged_product_id is null;
      v_na_reason := case when v_na then v_drop.packaging_not_applicable_reason end;
    else
      v_pp := v_keep.packaged_product_id;
      v_na := v_keep.packaging_not_applicable and v_keep.packaged_product_id is null;
      v_na_reason := case when v_na then v_keep.packaging_not_applicable_reason end;
      if v_choice is distinct from 'keep' then
        v_conflicts := v_conflicts || jsonb_build_object('field', 'packaged_product_id', 'blocking', true,
          'keep', jsonb_build_array(v_keep.packaged_product_id, v_keep.packaging_not_applicable),
          'drop', jsonb_build_array(v_drop.packaged_product_id, v_drop.packaging_not_applicable));
      end if;
    end if;
  elsif v_keep.packaged_product_id is not null or v_drop.packaged_product_id is not null then
    v_pp := coalesce(v_keep.packaged_product_id, v_drop.packaged_product_id);
    v_na := false;
    v_na_reason := null;
  else
    v_pp := null;
    v_na := v_keep.packaging_not_applicable or v_drop.packaging_not_applicable;
    v_na_reason := case
      when v_keep.packaging_not_applicable then v_keep.packaging_not_applicable_reason
      when v_drop.packaging_not_applicable then v_drop.packaging_not_applicable_reason
    end;
  end if;

  -- Taxonomy: (family, variant) travels as a pair; a family-only side is a
  -- refinement target, not a conflict.
  if v_drop.product_family_id is null then
    v_family := v_keep.product_family_id; v_variant := v_keep.product_variant_id;
  elsif v_keep.product_family_id is null then
    v_family := v_drop.product_family_id; v_variant := v_drop.product_variant_id;
  elsif v_keep.product_family_id = v_drop.product_family_id
        and (v_keep.product_variant_id is null or v_drop.product_variant_id is null
             or v_keep.product_variant_id = v_drop.product_variant_id) then
    v_family := v_keep.product_family_id;
    v_variant := coalesce(v_keep.product_variant_id, v_drop.product_variant_id);
  else
    v_choice := coalesce(p_resolution ->> 'taxonomy', v_pref);
    if v_choice = 'drop' then
      v_family := v_drop.product_family_id; v_variant := v_drop.product_variant_id;
    else
      v_family := v_keep.product_family_id; v_variant := v_keep.product_variant_id;
      if v_choice is distinct from 'keep' then
        v_conflicts := v_conflicts || jsonb_build_object('field', 'taxonomy', 'blocking', true,
          'keep', jsonb_build_array(v_keep.product_family_id, v_keep.product_variant_id),
          'drop', jsonb_build_array(v_drop.product_family_id, v_drop.product_variant_id));
      end if;
    end if;
  end if;

  -- Organic flag and unit/size: a mismatch means two different SKUs.
  v_organic := coalesce(v_keep.is_organic, v_drop.is_organic);
  if v_keep.is_organic is not null and v_drop.is_organic is not null
     and v_keep.is_organic <> v_drop.is_organic then
    v_choice := coalesce(p_resolution ->> 'is_organic', v_pref);
    if v_choice = 'drop' then
      v_organic := v_drop.is_organic;
    elsif v_choice is distinct from 'keep' then
      v_conflicts := v_conflicts || jsonb_build_object('field', 'is_organic', 'blocking', true,
        'keep', v_keep.is_organic, 'drop', v_drop.is_organic);
    end if;
  end if;
  v_unit := coalesce(v_keep.unit, v_drop.unit);
  v_unit_size := coalesce(v_keep.unit_size, v_drop.unit_size);
  if (v_keep.unit is not null and v_drop.unit is not null and v_keep.unit <> v_drop.unit)
     or (v_keep.unit_size is not null and v_drop.unit_size is not null
         and v_keep.unit_size <> v_drop.unit_size) then
    v_choice := coalesce(p_resolution ->> 'unit', v_pref);
    if v_choice = 'drop' then
      v_unit := v_drop.unit; v_unit_size := v_drop.unit_size;
    elsif v_choice is distinct from 'keep' then
      v_conflicts := v_conflicts || jsonb_build_object('field', 'unit', 'blocking', true,
        'keep', jsonb_build_array(v_keep.unit, v_keep.unit_size),
        'drop', jsonb_build_array(v_drop.unit, v_drop.unit_size));
    end if;
  end if;

  -- Category and brand are informational: the survivor wins unless told otherwise.
  v_category := v_keep.category;
  if v_keep.category <> v_drop.category then
    if coalesce(p_resolution ->> 'category', v_pref) = 'drop' then v_category := v_drop.category; end if;
    v_conflicts := v_conflicts || jsonb_build_object('field', 'category', 'blocking', false,
      'keep', v_keep.category, 'drop', v_drop.category, 'chosen', v_category);
  end if;
  if v_keep.brand is not null and v_drop.brand is not null
     and lower(v_keep.brand) <> lower(v_drop.brand) then
    v_conflicts := v_conflicts || jsonb_build_object('field', 'brand', 'blocking', false,
      'keep', v_keep.brand, 'drop', v_drop.brand, 'chosen', v_keep.brand);
  end if;
  v_notes := case
    when v_keep.notes is null then v_drop.notes
    when v_drop.notes is null or v_drop.notes = v_keep.notes then v_keep.notes
    else v_keep.notes || E'\n' || v_drop.notes
  end;
  v_code := coalesce(v_keep.store_product_code, v_drop.store_product_code);

  select count(*) into v_n_items  from public.items where product_id = p_drop_id;
  select count(*) into v_n_prices from public.product_prices where product_id = p_drop_id;
  select count(*) into v_n_rules  from public.product_match_rules where product_id = p_drop_id;

  v_plan := jsonb_build_object(
    'keep_id', p_keep_id, 'drop_id', p_drop_id,
    'will_move', jsonb_build_object(
      'items', v_n_items, 'product_prices', v_n_prices, 'product_match_rules', v_n_rules),
    'result', jsonb_build_object(
      'store', v_store, 'store_product_code', v_code, 'category', v_category,
      'product_family_id', v_family, 'product_variant_id', v_variant,
      'packaged_product_id', v_pp, 'packaging_not_applicable', v_na, 'is_organic', v_organic),
    'conflicts', v_conflicts);

  if p_dry_run then
    return v_plan || jsonb_build_object('status', 'dry_run');
  end if;
  if exists (select 1 from jsonb_array_elements(v_conflicts) c where (c ->> 'blocking')::boolean) then
    raise exception 'merge_products: unresolved blocking conflicts'
      using errcode = '23514', detail = v_conflicts::text;
  end if;

  -- ── apply (one transaction: the function body) ────────────────────────────
  select coalesce(array_agg(id order by id), '{}'),
         coalesce(jsonb_agg(jsonb_build_object('id', id, 'f', product_family_id, 'v', product_variant_id)
                            order by id), '[]'::jsonb)
    into v_item_ids, v_item_taxonomy
    from public.items where product_id = p_drop_id;
  select coalesce(array_agg(id order by id), '{}') into v_price_ids
    from public.product_prices where product_id = p_drop_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'store_key', store_key, 'raw_product_name_key', raw_product_name_key)), '[]'::jsonb)
    into v_rule_keys from public.product_match_rules where product_id = p_drop_id;

  -- 1. Rules first: their FK is ON DELETE CASCADE.
  update public.product_match_rules set product_id = p_keep_id where product_id = p_drop_id;
  -- 2. Prices: ON DELETE RESTRICT.
  update public.product_prices set product_id = p_keep_id where product_id = p_drop_id;
  -- 3. Items: ON DELETE SET NULL. trg_items_inherit_product_taxonomy fires on
  --    "update of product_id" and, for an unchanged snapshot, clears it and
  --    inherits the new product's family/variant, which rewrites history. A
  --    second statement that does not touch product_id puts the exact
  --    pre-merge snapshot back (the same two steps as correct_purchase_classification).
  update public.items set product_id = p_keep_id where product_id = p_drop_id;
  update public.items i
     set product_family_id = s.f, product_variant_id = s.v
    from jsonb_to_recordset(v_item_taxonomy) as s(id text, f text, v text)
   where i.id = s.id;

  -- FK actions bypass RLS, so prove nothing is left before deleting.
  if exists (select 1 from public.items where product_id = p_drop_id)
     or exists (select 1 from public.product_prices where product_id = p_drop_id)
     or exists (select 1 from public.product_match_rules where product_id = p_drop_id) then
    raise exception 'merge_products: references to % remain after re-pointing', p_drop_id;
  end if;

  delete from public.products where id = p_drop_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'merge_products: could not delete % (row-level security?)', p_drop_id
      using errcode = '42501';
  end if;

  -- The survivor takes the canonical spelling unless another row (a pair someone
  -- left unresolved) already holds that exact (store, code) / (store, name): then
  -- it keeps its own spelling rather than break the unique indexes.
  update public.products set
    store = case when exists (
        select 1 from public.products other
         where other.id <> p_keep_id
           and other.store = v_store
           and ((v_code is not null and other.store_product_code = v_code)
                or (v_code is null and other.store_product_code is null and other.name = v_keep.name))
      ) then store else v_store end,
    store_product_code = v_code,
    category = v_category,
    product_family_id = v_family,
    product_variant_id = v_variant,
    brand = coalesce(brand, v_drop.brand),
    is_organic = v_organic,
    unit = v_unit,
    unit_size = v_unit_size,
    notes = v_notes,
    packaged_product_id = v_pp,
    packaging_not_applicable = v_na,
    packaging_not_applicable_reason = v_na_reason,
    created_at = least(created_at, v_drop.created_at)
  where id = p_keep_id;

  insert into public.product_merge_log (
    keep_id, drop_id, keep_before, drop_row, item_ids, item_taxonomy, price_ids, rule_keys, resolution
  ) values (
    p_keep_id, p_drop_id, to_jsonb(v_keep), to_jsonb(v_drop), v_item_ids, v_item_taxonomy,
    v_price_ids, v_rule_keys, p_resolution
  )
  returning * into v_log;

  return v_plan || jsonb_build_object('status', 'merged', 'log_id', v_log.id);
end;
$$;

revoke execute on function public.merge_products(text, text, boolean, jsonb) from public, anon;
grant execute on function public.merge_products(text, text, boolean, jsonb) to authenticated, service_role;

comment on function public.merge_products(text, text, boolean, jsonb) is
  'Folds product p_drop_id into p_keep_id (same store, no conflicting code): re-points rules, prices and items, keeps item taxonomy snapshots, deletes the row, logs it. p_dry_run (default true) writes nothing and lists conflicts; p_resolution settles them. Undo with unmerge_product(log_id).';

-- ── unmerge_product ─────────────────────────────────────────────────────────
-- Logical rollback of one merge: the survivor gets back the fields the merge
-- touched, the dropped row is re-created, and exactly the logged items, prices
-- and rules move back. Rows the survivor received after the merge stay with it.
create function public.unmerge_product(p_log_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_log public.product_merge_log%rowtype;
  k public.products%rowtype;
  d public.products%rowtype;
begin
  select * into v_log from public.product_merge_log where id = p_log_id for update;
  if not found then
    raise exception 'unmerge_product: log row % not found', p_log_id using errcode = 'P0002';
  end if;
  if v_log.reverted_at is not null then
    return jsonb_build_object('status', 'already_reverted', 'log_id', p_log_id);
  end if;
  k := jsonb_populate_record(null::public.products, v_log.keep_before);
  d := jsonb_populate_record(null::public.products, v_log.drop_row);

  -- 1. Give the survivor its old identity back first: that frees the code the
  --    merge absorbed, which the re-created row is about to need.
  update public.products set
    store = k.store,
    store_product_code = k.store_product_code,
    category = k.category,
    product_family_id = k.product_family_id,
    product_variant_id = k.product_variant_id,
    brand = k.brand,
    is_organic = k.is_organic,
    unit = k.unit,
    unit_size = k.unit_size,
    notes = k.notes,
    packaged_product_id = k.packaged_product_id,
    packaging_not_applicable = k.packaging_not_applicable,
    packaging_not_applicable_reason = k.packaging_not_applicable_reason,
    created_at = k.created_at
  where id = v_log.keep_id;
  if not found then
    raise exception 'unmerge_product: survivor % no longer exists', v_log.keep_id using errcode = 'P0002';
  end if;

  -- 2. Re-create the dropped row.
  insert into public.products select d.*;

  -- 3. Move back only what the merge moved.
  update public.product_match_rules r set product_id = v_log.drop_id
    from jsonb_to_recordset(v_log.rule_keys) as q(store_key text, raw_product_name_key text)
   where r.store_key = q.store_key and r.raw_product_name_key = q.raw_product_name_key
     and r.product_id = v_log.keep_id;
  update public.product_prices set product_id = v_log.drop_id
   where id = any (v_log.price_ids) and product_id = v_log.keep_id;
  update public.items set product_id = v_log.drop_id
   where id = any (v_log.item_ids) and product_id = v_log.keep_id;
  update public.items i set product_family_id = s.f, product_variant_id = s.v
    from jsonb_to_recordset(v_log.item_taxonomy) as s(id text, f text, v text)
   where i.id = s.id and i.product_id = v_log.drop_id;

  update public.product_merge_log set reverted_at = now() where id = p_log_id;
  return jsonb_build_object('status', 'reverted', 'log_id', p_log_id);
end;
$$;

revoke execute on function public.unmerge_product(bigint) from public, anon;
grant execute on function public.unmerge_product(bigint) to authenticated, service_role;

comment on function public.unmerge_product(bigint) is
  'Reverts one product_merge_log row: re-creates the dropped products row and moves back the items, prices and rules that merge_products moved. Run it before anything else edits the survivor''s identity.';

-- ── merge_duplicate_products: the rule, as a batch ──────────────────────────
-- Tier 1: same canonical store and the same store_product_code.
-- Tier 2: same canonical store and the same normalised name, neither row with a
--         code (lower case and whitespace only: "EIFEL Eier FLH" = "EIFEL Eier FlH").
-- Anything weaker (similar names, one code differing, a code on one row only) is
-- not touched: that is a judgement, not a rule.
--
-- The survivor of a group is the row that is linked to a packaged card, then the
-- most bought, the best classified, already written in the canonical spelling,
-- the oldest. A pair with a conflicting packaging state, family/variant or
-- category is SKIPPED, not merged and not an error: the owner decides it with
-- merge_products(keep, drop, false, '{"prefer": ...}').
create function public.merge_duplicate_products(p_dry_run boolean default true)
returns table (
  tier         smallint,
  keep_id      text,
  drop_id      text,
  store_name   text,
  identity_key text,
  status       text,
  detail       jsonb
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r record;
  v_plan jsonb;
  v_blocked jsonb;
begin
  for r in
    with base as (
      select p.id, p.store, p.store_product_code as code,
             public.canonical_store_name(p.store) as cstore,
             public.normalize_product_match_key(p.name) as name_key,
             p.packaged_product_id is not null as linked,
             p.product_family_id is not null as has_family,
             p.product_variant_id is not null as has_variant,
             p.created_at,
             (select count(*) from public.items i where i.product_id = p.id) as item_count
        from public.products p
    ),
    keyed as (
      select b.*,
             case when b.code is not null then 1 else 2 end as tier,
             case when b.code is not null then 'code ' || b.code
                  else 'name ' || b.name_key end as identity_key
        from base b
    ),
    ranked as (
      select k.*,
             count(*) over w as group_size,
             row_number() over (w order by k.linked desc, k.item_count desc, k.has_family desc,
                                k.has_variant desc, (k.store = k.cstore) desc, k.created_at, k.id) as rank
        from keyed k
      window w as (partition by k.tier, k.cstore, k.identity_key)
    )
    select l.tier, l.cstore, l.identity_key, w.id as keep_id, l.id as drop_id
      from ranked l
      join ranked w on w.tier = l.tier and w.cstore = l.cstore
                   and w.identity_key = l.identity_key and w.rank = 1
     where l.group_size > 1 and l.rank > 1
     order by l.tier, l.cstore, l.identity_key, l.rank
  loop
    tier := r.tier;
    keep_id := r.keep_id;
    drop_id := r.drop_id;
    store_name := r.cstore;
    identity_key := r.identity_key;

    v_plan := public.merge_products(r.keep_id, r.drop_id, true, '{}'::jsonb);
    select jsonb_agg(c) into v_blocked
      from jsonb_array_elements(v_plan -> 'conflicts') c
     where (c ->> 'blocking')::boolean or c ->> 'field' = 'category';

    if v_blocked is not null then
      status := 'skipped_conflict';
      detail := jsonb_build_object('conflicts', v_blocked);
    elsif p_dry_run then
      status := 'would_merge';
      detail := v_plan -> 'will_move';
    else
      status := public.merge_products(r.keep_id, r.drop_id, false, '{}'::jsonb) ->> 'status';
      detail := v_plan -> 'will_move';
    end if;
    return next;
  end loop;
end;
$$;

revoke execute on function public.merge_duplicate_products(boolean) from public, anon;
grant execute on function public.merge_duplicate_products(boolean) to authenticated, service_role;

comment on function public.merge_duplicate_products(boolean) is
  'Rule-based batch over merge_products: tier 1 = same canonical store + same store_product_code, tier 2 = same canonical store + same normalised name with no code on either row. p_dry_run (default true) only reports; pairs with conflicting card, family/variant or category are skipped_conflict.';

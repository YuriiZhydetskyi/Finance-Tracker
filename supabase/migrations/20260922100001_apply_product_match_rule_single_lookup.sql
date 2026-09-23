create or replace function public.apply_product_match_rule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_store_key text;
  v_receipt_source public.receipt_source;
  v_rule public.product_match_rules%rowtype;
begin
  -- This is intentionally set before matching, so the original printed label
  -- survives even when a rule replaces the visible snapshot on insert.
  new.raw_product_name := coalesce(new.raw_product_name, new.product_name);

  select public.normalize_product_match_key(r.store), r.source
    into v_store_key, v_receipt_source
    from public.receipts r
   where r.id = new.receipt_id;

  -- Full receipt editing deliberately supplies an explicit classification for
  -- every replacement row. Never overwrite that human decision with a rule.
  if v_receipt_source = 'edit' then
    return new;
  end if;

  -- The join keeps a rule whose product row is missing or not visible from
  -- matching.
  select rule.* into v_rule
    from public.product_match_rules rule
    join public.products p on p.id = rule.product_id
   where rule.store_key = v_store_key
     and rule.raw_product_name_key = public.normalize_product_match_key(new.raw_product_name);

  if found then
    new.product_id := v_rule.product_id;
    new.product_name := v_rule.product_name;
    new.category := v_rule.category;
    new.product_family_id := v_rule.product_family_id;
    new.product_variant_id := v_rule.product_variant_id;
  end if;

  return new;
end;
$$;
revoke all on function public.apply_product_match_rule() from public, anon, authenticated;

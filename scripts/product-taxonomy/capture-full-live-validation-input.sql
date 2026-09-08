select jsonb_build_object(
  'categories', coalesce((
    select jsonb_agg(to_jsonb(c) order by c.name)
    from (
      select name, group_name, name_en, name_de, aliases
      from public.categories
    ) c
  ), '[]'::jsonb),
  'families', coalesce((
    select jsonb_agg(to_jsonb(f) order by f.id)
    from (
      select id, name_uk, name_en, name_de, aliases
      from public.product_families
    ) f
  ), '[]'::jsonb),
  'variants', coalesce((
    select jsonb_agg(to_jsonb(v) order by v.family_id, v.id)
    from (
      select id, family_id, name_uk, name_en, name_de, aliases
      from public.product_variants
    ) v
  ), '[]'::jsonb),
  'products', coalesce((
    select jsonb_agg(to_jsonb(p) order by p.id)
    from (
      select id::text, name, category, store, store_product_code,
        product_family_id, product_variant_id, brand, is_organic
      from public.products
    ) p
  ), '[]'::jsonb),
  'receipts', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.id)
    from (
      select distinct id::text
      from public.receipts
      where id in (select distinct receipt_id from public.items)
    ) r
  ), '[]'::jsonb),
  'items', coalesce((
    select jsonb_agg(to_jsonb(i) order by i.id)
    from (
      select id::text, receipt_id::text, product_id::text, product_name, category,
        qty, unit_price_orig, discount_orig, total_orig, total_eur,
        product_family_id, product_variant_id
      from public.items
    ) i
  ), '[]'::jsonb)
) as snapshot;

-- «Інше»: free-form label facts that have no column of their own (apple variety and
-- calibre, class, origin, producer, storage hints, certifications). One flat
-- key -> text object per card, edited by hand and filled by the JSON import.
-- See ADR-0035.
--
-- jsonb does not keep key order (it sorts by key length, then bytes), so the UI
-- orders the pairs itself and nothing may depend on the order stored here.

-- CHECK cannot contain a subquery, so the per-pair rules live in a pure immutable
-- function. Limits mirror ATTRIBUTE_KEY_MAX_LENGTH / ATTRIBUTE_VALUE_MAX_LENGTH /
-- CARD_ATTRIBUTES_MAX in packages/domain/src/product-attributes.ts. The card limit
-- (30) is deliberately above the per-import limit (15): merging repeated imports
-- into a reused card must never have to drop a pair.
--
-- CASE, not AND: SQL does not promise left-to-right evaluation of AND, and
-- jsonb_object_keys / jsonb_each raise on anything that is not an object.
create function public.is_valid_packaged_product_attributes(p_attributes jsonb)
returns boolean
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select case
    when p_attributes is null or jsonb_typeof(p_attributes) <> 'object' then false
    else (select count(*) from jsonb_object_keys(p_attributes)) <= 30
     and not exists (
       select 1
         from jsonb_each(p_attributes) as pair(key, value)
        where pair.key <> btrim(pair.key)
           or char_length(pair.key) not between 1 and 60
           or jsonb_typeof(pair.value) <> 'string'
           or (pair.value #>> '{}') <> btrim(pair.value #>> '{}')
           or char_length(pair.value #>> '{}') not between 1 and 300
     )
  end
$$;
revoke all on function public.is_valid_packaged_product_attributes(jsonb) from public, anon, authenticated;
grant execute on function public.is_valid_packaged_product_attributes(jsonb) to authenticated, service_role;

comment on function public.is_valid_packaged_product_attributes(jsonb) is
  'Attributes rule: a JSON object of at most 30 pairs; each key trimmed and 1..60 characters, each value a trimmed string of 1..300 characters. Used by a CHECK on packaged_products.';

alter table public.packaged_products
  add column attributes jsonb not null default '{}'::jsonb,
  add constraint packaged_products_attributes_valid
    check (public.is_valid_packaged_product_attributes(attributes));

comment on column public.packaged_products.attributes is
  'Label facts without a dedicated column («Інше»): key -> text, keys in Ukrainian, values as printed. Empty object = nothing recorded. Import adds new keys to a reused card and never overwrites a value already on it. Key order is not preserved by jsonb.';

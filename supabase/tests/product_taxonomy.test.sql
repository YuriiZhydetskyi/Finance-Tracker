-- Run with psql -v ON_ERROR_STOP=1 against a disposable local database after migrations.
-- Fixtures and assertion helpers are rolled back, including the allowlist entry.
begin;

create function pg_temp.assert_true(p_value boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_value is distinct from true then
    raise exception 'Taxonomy assertion failed: %', p_message;
  end if;
end;
$$;

insert into public.app_users (email) values ('taxonomy-test@example.invalid');
insert into public.categories (name, group_name, name_en, name_de, aliases)
values ('Тестова їжа', 'Test', 'Test food', 'Test Lebensmittel', array['харчі']);
insert into public.product_families (id, name_uk, name_en, name_de, aliases) values
  ('test_apple', 'Яблуко', 'Apple', 'Apfel', array['яблука', 'Äpfel']),
  ('test_tomato', 'Помідори', 'Tomato', 'Tomaten', array['помідор', 'tomatoes']);
insert into public.product_variants (id, family_id, name_uk, name_en, name_de, aliases) values
  ('test_apple_green', 'test_apple', 'Зелене', 'Green', 'Grün', array['зелені']),
  ('test_tomato_cherry', 'test_tomato', 'Чері', 'Cherry', 'Kirschtomaten', '{}');
insert into public.products (
  id, name, category, store, store_product_code, product_family_id, product_variant_id, brand, is_organic
) values
  ('taxonomy-product-apple', 'Test Obst', 'Тестова їжа', 'Test Aldi', 'test-sku-123',
    'test_apple', 'test_apple_green', 'Test Brand', true),
  ('taxonomy-product-tomato', 'Test Gemüse', 'Тестова їжа', 'Test Edeka', null,
    'test_tomato', 'test_tomato_cherry', null, false);
insert into public.receipts (id, date, store, currency, total_orig, fx_rate_eur, total_eur, paid_by, source)
values ('taxonomy-receipt', '2026-09-07', 'Test Aldi', 'EUR', 10, 1, 10, 'taxonomy-test@example.invalid', 'manual');
insert into public.items (
  id, receipt_id, product_id, product_name, category, qty, unit_price_orig, total_orig, total_eur, consumed_by
) values
  ('taxonomy-item-inherited', 'taxonomy-receipt', 'taxonomy-product-apple', 'Original receipt name', 'Тестова їжа', 1, 1, 1, 1, 'shared'),
  ('taxonomy-item-negative', 'taxonomy-receipt', null, 'Discount-only', 'Тестова їжа', 1, -1, -1, -1, 'shared'),
  ('taxonomy-item-literal', 'taxonomy-receipt', null, 'Literal 20%_sale café Straße', 'Тестова їжа', 1, 1, 1, 1, 'shared');
insert into public.items (
  id, receipt_id, product_id, product_name, category, qty, unit_price_orig, total_orig, total_eur,
  consumed_by, product_family_id, product_variant_id
) values
  ('taxonomy-item-snapshot', 'taxonomy-receipt', 'taxonomy-product-apple', 'Historical snapshot', 'Тестова їжа', 1, 1, 1, 1, 'shared', 'test_tomato', 'test_tomato_cherry'),
  ('taxonomy-item-family-only', 'taxonomy-receipt', 'taxonomy-product-apple', 'Family only', 'Тестова їжа', 1, 1, 1, 1, 'shared', 'test_apple', null),
  ('taxonomy-item-orphan', 'taxonomy-receipt', null, 'Unlinked history', 'Тестова їжа', 1, 1, 1, 1, 'shared', 'test_apple', 'test_apple_green');

select pg_temp.assert_true((select product_variant_id = 'test_apple_green' from public.items where id = 'taxonomy-item-inherited'), 'insert inherits catalogue classification');
select pg_temp.assert_true((select product_variant_id is null from public.items where id = 'taxonomy-item-family-only'), 'explicit family-only snapshot is preserved');
select pg_temp.assert_true((select product_family_id is null from public.items where id = 'taxonomy-item-negative'), 'unlinked financial rows remain unclassified');

do $$
begin
  begin
    update public.products set product_variant_id = 'test_tomato_cherry' where id = 'taxonomy-product-apple';
    raise exception 'Cross-family product variant was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.items set product_variant_id = 'test_tomato_cherry' where id = 'taxonomy-item-inherited';
    raise exception 'Cross-family item variant was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.items set product_family_id = null where id = 'taxonomy-item-inherited';
    raise exception 'Variant without family was accepted';
  exception when check_violation then null;
  end;
end;
$$;

set local role authenticated;
set local request.jwt.claims = '{"email":"taxonomy-test@example.invalid","role":"authenticated"}';
select pg_temp.assert_true((select count(*) = 2 from public.product_families where id in ('test_apple', 'test_tomato')), 'allowlisted taxonomy read');
insert into public.product_families (id, name_uk, name_en, name_de) values ('test_write', 'Тест', 'Test', 'Test');
update public.product_families set name_en = 'Updated' where id = 'test_write';
select pg_temp.assert_true((select name_en = 'Updated' from public.product_families where id = 'test_write'), 'allowlisted taxonomy update');
delete from public.product_families where id = 'test_write';

do $$
declare term text;
begin
  foreach term in array array['Apple', 'Apfel', 'яблуко', 'яблука', 'ÄPFEL', 'Aepfel', 'Grün', 'Gruen', 'test brand', 'test sku 123', 'Original receipt name', 'organic', 'біо', 'Lebensmittel', 'харчі'] loop
    perform pg_temp.assert_true(exists(select from public.search_waste_items(term) where id = 'taxonomy-item-inherited'), 'match ' || term);
  end loop;
  foreach term in array array['Помідори', 'Tomaten', 'tomatoes', 'cherry'] loop
    perform pg_temp.assert_true(exists(select from public.search_waste_items(term) where id = 'taxonomy-item-snapshot'), 'snapshot match ' || term);
  end loop;
end;
$$;

select pg_temp.assert_true(not exists(select from public.search_waste_items('apple') where id = 'taxonomy-item-snapshot'), 'snapshot does not mix catalogue family');
select pg_temp.assert_true(not exists(select from public.search_waste_items('green') where id = 'taxonomy-item-family-only'), 'family-only snapshot does not mix catalogue variant');
select pg_temp.assert_true(exists(select from public.search_waste_items('яблуко green') where id = 'taxonomy-item-orphan'), 'unlinked classified history is searchable');
select pg_temp.assert_true(not exists(select from public.search_waste_items('') where id = 'taxonomy-item-negative'), 'negative financial rows excluded');
select pg_temp.assert_true(exists(select from public.search_waste_items('  APPLE, test-brand  ') where id = 'taxonomy-item-inherited'), 'all tokens can span taxonomy and brand');
select pg_temp.assert_true(not exists(select from public.search_waste_items('apple unknown-token') where id = 'taxonomy-item-inherited'), 'every token required');
select pg_temp.assert_true((select count(*) = 1 from public.search_waste_items('%') where receipt_id = 'taxonomy-receipt'), 'percent is literal');
select pg_temp.assert_true((select count(*) = 1 from public.search_waste_items('_') where receipt_id = 'taxonomy-receipt'), 'underscore is literal');
select pg_temp.assert_true(exists(select from public.search_waste_items('cafe STRASSE') where id = 'taxonomy-item-literal'), 'accent and sharp-s folding');
select pg_temp.assert_true((select count(*) = 5 from public.search_waste_items(null) where receipt_id = 'taxonomy-receipt'), 'empty query returns all positive items');
select pg_temp.assert_true(not exists(select from public.search_waste_items('nonbio') where id = 'taxonomy-item-inherited'), 'organic product does not match nonbio');
select pg_temp.assert_true(not exists(select from public.search_waste_items('звичайне') where id = 'taxonomy-item-inherited'), 'organic product does not match ordinary');

-- Legacy history can lack snapshots; fallback resolves both levels from the catalogue.
update public.items set product_family_id = null, product_variant_id = null where id = 'taxonomy-item-inherited';
select pg_temp.assert_true(exists(select from public.search_waste_items('apple green') where id = 'taxonomy-item-inherited'), 'unclassified history falls back to catalogue');
update public.items set product_family_id = 'test_apple', product_variant_id = 'test_apple_green' where id = 'taxonomy-item-inherited';
update public.products set product_family_id = 'test_tomato', product_variant_id = 'test_tomato_cherry' where id = 'taxonomy-product-apple';
update public.items set wasted_qty = 0.5, product_id = product_id where id = 'taxonomy-item-inherited';
select pg_temp.assert_true((select product_family_id = 'test_apple' from public.items where id = 'taxonomy-item-inherited'), 'unrelated edits preserve snapshot after catalogue reclassification');
update public.items set product_id = 'taxonomy-product-tomato' where id = 'taxonomy-item-inherited';
select pg_temp.assert_true((select product_family_id = 'test_tomato' and product_variant_id = 'test_tomato_cherry' from public.items where id = 'taxonomy-item-inherited'), 'product reassignment replaces stale snapshot');
select pg_temp.assert_true(not exists(select from public.search_waste_items('organic') where id = 'taxonomy-item-inherited'), 'false organic attribute does not gain organic synonyms');
select pg_temp.assert_true(exists(select from public.search_waste_items('nonbio') where id = 'taxonomy-item-inherited'), 'ordinary product matches nonbio');
select pg_temp.assert_true(exists(select from public.search_waste_items('звичайне') where id = 'taxonomy-item-inherited'), 'ordinary product matches Ukrainian ordinary');
select pg_temp.assert_true(exists(select from public.search_waste_items('nonorganic') where id = 'taxonomy-item-inherited'), 'ordinary product matches nonorganic');
select pg_temp.assert_true(not exists(select from public.search_waste_items('bio') where id = 'taxonomy-item-inherited'), 'ordinary aliases do not introduce a bio substring');
update public.items set product_id = null where id = 'taxonomy-item-inherited';
select pg_temp.assert_true((select product_family_id = 'test_tomato' and product_variant_id = 'test_tomato_cherry' from public.items where id = 'taxonomy-item-inherited'), 'explicit unlink preserves purchase snapshot');
delete from public.products where id = 'taxonomy-product-apple';
select pg_temp.assert_true((select product_id is null and product_family_id = 'test_tomato' and product_variant_id = 'test_tomato_cherry' from public.items where id = 'taxonomy-item-snapshot'), 'catalogue deletion preserves purchase snapshot');

set local request.jwt.claims = '{"email":"taxonomy-denied@example.invalid","role":"authenticated"}';
select pg_temp.assert_true(not exists(select from public.product_families), 'non-allowlisted family read denied');
select pg_temp.assert_true(not exists(select from public.product_variants), 'non-allowlisted variant read denied');
select pg_temp.assert_true(not exists(select from public.search_waste_items('')), 'RPC respects item RLS');
do $$
declare affected integer;
begin
  begin
    insert into public.product_families (id, name_uk, name_en, name_de) values ('test_denied', 'Тест', 'Test', 'Test');
    raise exception 'Non-allowlisted insert was accepted';
  exception when insufficient_privilege then null;
  end;
  update public.product_families set name_en = 'Denied' where id = 'test_apple';
  get diagnostics affected = row_count;
  perform pg_temp.assert_true(affected = 0, 'non-allowlisted update denied');
  delete from public.product_variants where id = 'test_tomato_cherry';
  get diagnostics affected = row_count;
  perform pg_temp.assert_true(affected = 0, 'non-allowlisted delete denied');
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin
    perform * from public.product_families;
    raise exception 'Anonymous family read was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.search_waste_items('');
    raise exception 'Anonymous RPC was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;

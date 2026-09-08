import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = process.cwd();
const outputDirectory = resolve(root, 'output/taxonomy-audit-20260908');
const outputPath = resolve(outputDirectory, 'audit-a-reviewed-live-correction.sql');
const rollbackValidationPath = resolve(
  outputDirectory,
  'audit-a-reviewed-live-correction-rollback-validation.sql',
);
const snapshotPath = resolve(outputDirectory, 'audit-a-reviewed-live-correction-snapshot.json');

// Only families whose product meaning is certain from both independent audits.
// snack_chips is deliberately excluded pending receipt-photo verification.
const familyMoves = new Map([
  ['blue_cheese', { target: 'cheese', category: 'Молочка' }],
  ['brie_cheese', { target: 'cheese', category: 'Молочка' }],
  ['burrata', { target: 'cheese', category: 'Молочка' }],
  ['camembert', { target: 'cheese', category: 'Молочка' }],
  ['cheese_slices', { target: 'cheese', category: 'Молочка' }],
  ['cream_cheese', { target: 'cheese', category: 'Молочка' }],
  ['feta', { target: 'cheese', category: 'Молочка' }],
  ['feta_cheese', { target: 'cheese', category: 'Молочка' }],
  ['goat_cheese', { target: 'cheese', category: 'Молочка' }],
  ['gouda', { target: 'cheese', category: 'Молочка' }],
  ['grilling_cheese', { target: 'cheese', category: 'Молочка' }],
  ['mozzarella', { target: 'cheese', category: 'Молочка' }],
  ['sheep_cheese', { target: 'cheese', category: 'Молочка' }],
  ['soft_cheese', { target: 'cheese', category: 'Молочка' }],
  ['chicken_egg', { target: 'egg', category: 'Молочка' }],
  ['chicken_eggs', { target: 'egg', category: 'Молочка' }],
  ['potato_chips', { target: 'chips', category: 'Бакалія' }],
  ['potato_crisps', { target: 'chips', category: 'Бакалія' }],
  ['snack_chips', { target: 'chips', category: 'Бакалія' }],
  ['grape', { target: 'grapes', category: 'Овочі/фрукти' }],
  ['cow_milk', { target: 'milk', category: 'Молочка' }],
  ['champignon', { target: 'mushroom', category: 'Овочі/фрукти' }],
  ['champignon_mushroom', { target: 'mushroom', category: 'Овочі/фрукти' }],
  // Both families mean firelighter. The catalogue is used in Home and DIY and in Other,
  // so consolidation must retain each historical row's existing category.
  ['fire_lighting_supply', { target: 'firelighter', category: null }],
]);

const categoryOnly = new Map([
  ['quark', { category: 'Молочка' }],
  ['tomato', { category: 'Овочі/фрукти' }],
  ['fruit_juice', { category: 'Бакалія' }],
  // Only canned sweet corn is in scope; fresh corn belongs in produce if added later.
  ['sweet_corn', { category: 'Бакалія', variants: new Set(['canned']) }],
  ['cashew', { category: 'Бакалія' }],
  ['peanut', { category: 'Бакалія' }],
  ['potato', { category: 'Овочі/фрукти' }],
]);

// These are product-scoped because their family also contains legitimate restaurant purchases.
const productCategoryOverrides = new Map([
  ['01KTEH20SQ8YH38PDMJP2DF3HS', 'Бакалія'], // Coke Zero, EDEKA receipt
  ['01M1BVP7S0KDW0HMA1HGGWV0C3', 'Молочка'], // high-protein mousse
]);

function sql(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function rowsSql(rows) {
  return rows.map((row) => `(${row.map(sql).join(', ')})`).join(',\n');
}

function variantTarget(sourceFamily, variantId) {
  if (variantId === null) {
    if (sourceFamily === 'chicken_egg' || sourceFamily === 'chicken_eggs') return 'chicken_eggs';
    return `${familyMoves.get(sourceFamily).target}_${sourceFamily}`;
  }
  if (sourceFamily === 'chicken_egg' && variantId === 'free_range_eggs') {
    return 'free_range_chicken_eggs';
  }
  return `${familyMoves.get(sourceFamily).target}_${variantId}`;
}

const familyIds = [...new Set([...familyMoves.keys(), ...categoryOnly.keys()])].sort(
  (left, right) => left.localeCompare(right),
);
const overrideProductIds = [...productCategoryOverrides.keys()].sort((left, right) =>
  left.localeCompare(right),
);
const query = `
with selected_family(id) as (values ${familyIds.map((id) => `(${sql(id)})`).join(', ')}),
catalog_families as (
  select f.id, f.name_uk, f.name_en, f.name_de, f.aliases
  from public.product_families f join selected_family s on s.id = f.id
),
catalog_variants as (
  select v.id, v.family_id, v.name_uk, v.name_en, v.name_de, v.aliases
  from public.product_variants v join selected_family s on s.id = v.family_id
),
products as (
  select p.id::text as id, p.name, p.category, p.store, p.store_product_code,
    p.product_family_id, p.product_variant_id, p.brand, p.is_organic
  from public.products p left join selected_family s on s.id = p.product_family_id
  where s.id is not null or p.id::text = any(array[${overrideProductIds.map(sql).join(', ')}])
),
items as (
  select i.id::text as id, i.receipt_id::text as receipt_id, i.product_id::text as product_id,
    i.product_name, i.category, i.product_family_id, i.product_variant_id,
    i.total_orig, i.total_eur
  from public.items i left join selected_family s on s.id = i.product_family_id
  where s.id is not null or i.product_id::text = any(array[${overrideProductIds.map(sql).join(', ')}])
)
select jsonb_build_object(
  'families', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from catalog_families x), '[]'::jsonb),
  'variants', coalesce((select jsonb_agg(to_jsonb(x) order by x.family_id, x.id) from catalog_variants x), '[]'::jsonb),
  'products', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from products x), '[]'::jsonb),
  'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from items x), '[]'::jsonb)
) as snapshot;
`;

const executable =
  process.platform === 'win32' ? resolve(root, 'node_modules/supabase/bin/supabase.exe') : 'npx';
const args =
  process.platform === 'win32'
    ? ['db', 'query', '--linked', '--output', 'json', query]
    : ['supabase', 'db', 'query', '--linked', '--output', 'json', query];
const { stdout, stderr } = await execFile(executable, args, {
  cwd: root,
  env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '' },
  maxBuffer: 16 * 1024 * 1024,
});
if (stderr.trim()) process.stderr.write(stderr);
const response = JSON.parse(stdout);
assert.equal(response.rows.length, 1, 'Expected exactly one snapshot row');
const snapshot = response.rows[0].snapshot;

const familyById = new Map(snapshot.families.map((row) => [row.id, row]));
for (const id of familyMoves.keys()) assert(familyById.has(id), `Missing source family ${id}`);
for (const id of categoryOnly.keys()) assert(familyById.has(id), `Missing category family ${id}`);

const variantByFamily = new Map();
for (const variant of snapshot.variants) {
  const familyVariants = variantByFamily.get(variant.family_id) ?? [];
  familyVariants.push(variant);
  variantByFamily.set(variant.family_id, familyVariants);
}

const variantDefinitions = [];
for (const [source, move] of familyMoves) {
  const sourceFamily = familyById.get(source);
  for (const variant of variantByFamily.get(source) ?? []) {
    variantDefinitions.push({
      id: variantTarget(source, variant.id),
      family_id: move.target,
      // The family is no longer shown after consolidation, so its meaning must remain visible here.
      name_uk: `${sourceFamily.name_uk}: ${variant.name_uk}`,
      name_en: `${sourceFamily.name_en}: ${variant.name_en}`,
      name_de: `${sourceFamily.name_de}: ${variant.name_de}`,
      aliases: variant.aliases,
    });
  }
  if (source !== 'chicken_egg' && source !== 'chicken_eggs') {
    variantDefinitions.push({
      id: variantTarget(source, null),
      family_id: move.target,
      name_uk: sourceFamily.name_uk,
      name_en: sourceFamily.name_en,
      name_de: sourceFamily.name_de,
      aliases: sourceFamily.aliases,
    });
  }
}
variantDefinitions.push(
  {
    id: 'chicken_eggs',
    family_id: 'egg',
    name_uk: 'Курячі яйця',
    name_en: 'Chicken eggs',
    name_de: 'Hühnereier',
    aliases: ['chicken eggs', 'hühnereier', 'курячі яйця'],
  },
  {
    id: 'free_range_chicken_eggs',
    family_id: 'egg',
    name_uk: 'Курячі яйця вільного вигулу',
    name_en: 'Free-range chicken eggs',
    name_de: 'Freiland-Hühnereier',
    aliases: ['free range eggs', 'freilandeier', 'яйця вільного вигулу'],
  },
  {
    id: 'chicken_legs',
    family_id: 'chicken',
    name_uk: 'Курячі ніжки',
    name_en: 'Chicken legs',
    name_de: 'Hähnchenschenkel',
    aliases: ['chicken legs', 'hähnchenschenkel', 'курячі ніжки'],
  },
  {
    id: 'marinated_chicken_breast_fillet',
    family_id: 'chicken',
    name_uk: 'Мариноване куряче філе',
    name_en: 'Marinated chicken breast fillet',
    name_de: 'Mariniertes Hähnchenbrustfilet',
    aliases: [
      'marinated chicken breast fillet',
      'mariniertes hähnchenbrustfilet',
      'мариноване куряче філе',
    ],
  },
  {
    id: 'unmarinated_chicken_breast_fillet',
    family_id: 'chicken',
    name_uk: 'Немариноване куряче філе',
    name_en: 'Unmarinated chicken breast fillet',
    name_de: 'Unmariniertes Hähnchenbrustfilet',
    aliases: [
      'unmarinated chicken breast fillet',
      'unmariniertes hähnchenbrustfilet',
      'немариноване куряче філе',
    ],
  },
);
const uniqueVariants = [...new Map(variantDefinitions.map((row) => [row.id, row])).values()].sort(
  (a, b) => a.id.localeCompare(b.id),
);

function targetFor(row) {
  const productOverride =
    productCategoryOverrides.get(row.id) ?? productCategoryOverrides.get(row.product_id);
  if (productOverride) {
    return {
      category: productOverride,
      family_id: row.product_family_id,
      variant_id: row.product_variant_id,
    };
  }
  const move = familyMoves.get(row.product_family_id);
  if (move) {
    return {
      category: move.category ?? row.category,
      family_id: move.target,
      variant_id: variantTarget(row.product_family_id, row.product_variant_id),
    };
  }
  const categoryRule = categoryOnly.get(row.product_family_id);
  assert(
    categoryRule && (!categoryRule.variants || categoryRule.variants.has(row.product_variant_id)),
    `Unexpected category-only target ${row.id} in ${row.product_family_id}/${row.product_variant_id}`,
  );
  return {
    category: categoryRule.category,
    family_id: row.product_family_id,
    variant_id: row.product_variant_id,
  };
}

const productTargets = snapshot.products.map((row) => ({ ...row, target: targetFor(row) }));
const itemTargets = snapshot.items.map((row) => ({ ...row, target: targetFor(row) }));
assert(productTargets.length > 0 && itemTargets.length > 0, 'Snapshot has no correction targets');

const productValues = productTargets.map((row) => [
  row.id,
  row.name,
  row.category,
  row.store,
  row.store_product_code,
  row.product_family_id,
  row.product_variant_id,
  row.brand,
  row.is_organic,
  row.target.category,
  row.target.family_id,
  row.target.variant_id,
]);
const itemValues = itemTargets.map((row) => [
  row.id,
  row.receipt_id,
  row.product_id,
  row.product_name,
  row.category,
  row.product_family_id,
  row.product_variant_id,
  row.total_orig,
  row.total_eur,
  row.target.category,
  row.target.family_id,
  row.target.variant_id,
]);

const removableFamilies = [...familyMoves.keys()].sort((left, right) => left.localeCompare(right));
const removableVariants = snapshot.variants
  .filter((variant) => familyMoves.has(variant.family_id))
  .map((variant) => variant.id)
  .sort((left, right) => left.localeCompare(right));

const sqlText = `-- GENERATED from a read-only live snapshot. Do not edit targets by hand; regenerate and review.
-- Scope: reviewed duplicate families and certain category errors only. No receipt totals, quantities,
-- product links, restaurant categories, or alcohol decisions are changed.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.products, public.items, public.product_families, public.product_variants
  in share row exclusive mode;

create temporary table correction_receipt_financial_baseline on commit drop as
select receipt_id, count(*) as item_count, coalesce(sum(qty), 0) as qty_sum,
  coalesce(sum(unit_price_orig), 0) as unit_price_sum, coalesce(sum(discount_orig), 0) as discount_sum,
  coalesce(sum(total_orig), 0) as total_orig_sum, coalesce(sum(total_eur), 0) as total_eur_sum
from public.items group by receipt_id;
create temporary table correction_table_count_baseline on commit drop as
select (select count(*) from public.products) as product_count,
  (select count(*) from public.items) as item_count;

create temporary table correction_product_target (
  id text primary key, expected_name text not null, expected_category text, expected_store text,
  expected_store_product_code text, expected_family text, expected_variant text, expected_brand text,
  expected_organic boolean, target_category text not null, target_family text not null, target_variant text
) on commit drop;
insert into correction_product_target values
${rowsSql(productValues)};

create temporary table correction_item_target (
  id text primary key, expected_receipt_id text not null, expected_product_id text, expected_name text not null,
  expected_category text, expected_family text, expected_variant text, expected_total_orig numeric,
  expected_total_eur numeric, target_category text not null, target_family text not null, target_variant text
) on commit drop;
insert into correction_item_target values
${rowsSql(itemValues)};

do $$
begin
  if (select count(*) from correction_product_target) <> ${productTargets.length}
     or (select count(*) from correction_item_target) <> ${itemTargets.length} then
    raise exception 'Frozen correction target count changed';
  end if;
  if not exists (select 1 from public.product_families where id = 'chips') then
    insert into public.product_families (id, name_uk, name_en, name_de, aliases)
    values ('chips', 'Чипси', 'Chips', 'Chips', array['чипси', 'chips', 'snacks']);
  end if;
  update public.product_families f
  set name_uk = 'Яйця', name_en = 'Eggs', name_de = 'Eier', aliases = array(
    select distinct alias from (
      select unnest(f.aliases) alias
      union all select unnest(s.aliases) from public.product_families s where s.id in ('chicken_egg', 'chicken_eggs')
      union all select s.name_uk from public.product_families s where s.id in ('chicken_egg', 'chicken_eggs')
      union all select s.name_en from public.product_families s where s.id in ('chicken_egg', 'chicken_eggs')
      union all select s.name_de from public.product_families s where s.id in ('chicken_egg', 'chicken_eggs')
      union all select unnest(array['яйця', 'eggs', 'eier'])
    ) aliases where btrim(alias) <> ''
  ) where f.id = 'egg';
  update public.product_families f
  set name_uk = 'Сир', name_en = 'Cheese', name_de = 'Käse', aliases = array(
    select distinct alias from (
      select unnest(f.aliases) alias
      union all select unnest(s.aliases) from public.product_families s where s.id in ('blue_cheese', 'brie_cheese', 'burrata', 'camembert', 'cheese_slices', 'cream_cheese', 'feta', 'feta_cheese', 'goat_cheese', 'gouda', 'grilling_cheese', 'mozzarella', 'sheep_cheese', 'soft_cheese')
      union all select s.name_uk from public.product_families s where s.id in ('blue_cheese', 'brie_cheese', 'burrata', 'camembert', 'cheese_slices', 'cream_cheese', 'feta', 'feta_cheese', 'goat_cheese', 'gouda', 'grilling_cheese', 'mozzarella', 'sheep_cheese', 'soft_cheese')
      union all select s.name_en from public.product_families s where s.id in ('blue_cheese', 'brie_cheese', 'burrata', 'camembert', 'cheese_slices', 'cream_cheese', 'feta', 'feta_cheese', 'goat_cheese', 'gouda', 'grilling_cheese', 'mozzarella', 'sheep_cheese', 'soft_cheese')
      union all select s.name_de from public.product_families s where s.id in ('blue_cheese', 'brie_cheese', 'burrata', 'camembert', 'cheese_slices', 'cream_cheese', 'feta', 'feta_cheese', 'goat_cheese', 'gouda', 'grilling_cheese', 'mozzarella', 'sheep_cheese', 'soft_cheese')
      union all select unnest(array['сир', 'cheese', 'käse', 'kaese'])
    ) aliases where btrim(alias) <> ''
  ) where f.id = 'cheese';
  update public.product_families f set aliases = array(
    select distinct alias from (
      select unnest(f.aliases) alias
      union all select unnest(s.aliases) from public.product_families s where s.id in ('potato_chips', 'potato_crisps', 'snack_chips')
      union all select s.name_uk from public.product_families s where s.id in ('potato_chips', 'potato_crisps', 'snack_chips')
      union all select s.name_en from public.product_families s where s.id in ('potato_chips', 'potato_crisps', 'snack_chips')
      union all select s.name_de from public.product_families s where s.id in ('potato_chips', 'potato_crisps', 'snack_chips')
    ) aliases where btrim(alias) <> ''
  ) where f.id = 'chips';
  update public.product_families f set aliases = array(
    select distinct alias from (
      select unnest(f.aliases) alias
      union all select unnest(s.aliases) from public.product_families s where s.id = 'grape'
      union all select s.name_uk from public.product_families s where s.id = 'grape'
      union all select s.name_en from public.product_families s where s.id = 'grape'
      union all select s.name_de from public.product_families s where s.id = 'grape'
    ) aliases where btrim(alias) <> ''
  ) where f.id = 'grapes';
  update public.product_families f set aliases = array(
    select distinct alias from (
      select unnest(f.aliases) alias
      union all select unnest(s.aliases) from public.product_families s where s.id = 'cow_milk'
      union all select s.name_uk from public.product_families s where s.id = 'cow_milk'
      union all select s.name_en from public.product_families s where s.id = 'cow_milk'
      union all select s.name_de from public.product_families s where s.id = 'cow_milk'
    ) aliases where btrim(alias) <> ''
  ) where f.id = 'milk';
  update public.product_families f set aliases = array(
    select distinct alias from (
      select unnest(f.aliases) alias
      union all select unnest(s.aliases) from public.product_families s where s.id in ('champignon', 'champignon_mushroom')
      union all select s.name_uk from public.product_families s where s.id in ('champignon', 'champignon_mushroom')
      union all select s.name_en from public.product_families s where s.id in ('champignon', 'champignon_mushroom')
      union all select s.name_de from public.product_families s where s.id in ('champignon', 'champignon_mushroom')
    ) aliases where btrim(alias) <> ''
  ) where f.id = 'mushroom';
  update public.product_families f set aliases = array(
    select distinct alias from (
      select unnest(f.aliases) alias
      union all select unnest(s.aliases) from public.product_families s where s.id = 'fire_lighting_supply'
      union all select s.name_uk from public.product_families s where s.id = 'fire_lighting_supply'
      union all select s.name_en from public.product_families s where s.id = 'fire_lighting_supply'
      union all select s.name_de from public.product_families s where s.id = 'fire_lighting_supply'
    ) aliases where btrim(alias) <> ''
  ) where f.id = 'firelighter';
  update public.product_families f
  set name_uk = 'Куряче м''ясо', name_en = 'Chicken meat', name_de = 'Hähnchenfleisch',
    aliases = array(select distinct alias from unnest(f.aliases || array['курятина', 'куряче м''ясо', 'chicken', 'hähnchen']) alias)
  where f.id = 'chicken';
  update public.product_families f
  set name_uk = 'Лохина', aliases = array(
    select distinct alias from unnest(f.aliases || array['лохина', 'Чорниця', 'чорниця']) alias
  ) where f.id = 'blueberry';
  update public.product_families f
  set name_uk = 'Помідори', aliases = array(
    select distinct alias from unnest(f.aliases || array['Помідор', 'Помідори', 'помідор', 'помідори']) alias
  ) where f.id = 'tomato';
  if exists (
    select 1 from correction_product_target t left join public.products p on p.id::text = t.id
    where p.id is null or p.name is distinct from t.expected_name or p.category is distinct from t.expected_category
      or p.store is distinct from t.expected_store or p.store_product_code is distinct from t.expected_store_product_code
      or p.product_family_id is distinct from t.expected_family or p.product_variant_id is distinct from t.expected_variant
      or p.brand is distinct from t.expected_brand or p.is_organic is distinct from t.expected_organic
  ) then raise exception 'Product correction prestate drifted'; end if;
  if exists (
    select 1 from correction_item_target t left join public.items i on i.id::text = t.id
    where i.id is null or i.receipt_id::text is distinct from t.expected_receipt_id
      or i.product_id::text is distinct from t.expected_product_id or i.product_name is distinct from t.expected_name
      or i.category is distinct from t.expected_category or i.product_family_id is distinct from t.expected_family
      or i.product_variant_id is distinct from t.expected_variant or i.total_orig is distinct from t.expected_total_orig
      or i.total_eur is distinct from t.expected_total_eur
  ) then raise exception 'Item correction prestate drifted'; end if;
end $$;

insert into public.product_variants (id, family_id, name_uk, name_en, name_de, aliases)
values
${rowsSql(uniqueVariants.map((row) => [row.id, row.family_id, row.name_uk, row.name_en, row.name_de, `{${row.aliases.map((x) => `"${x.replaceAll('"', '\\"')}"`).join(',')}}`]))}
on conflict (id) do nothing;

do $$
begin
  if exists (
    select 1
    from (values
${rowsSql(uniqueVariants.map((row) => [row.id, row.family_id, row.name_uk, row.name_en, row.name_de]))}
    ) as expected(id, family_id, name_uk, name_en, name_de)
    join public.product_variants actual on actual.id = expected.id
    where actual.family_id is distinct from expected.family_id
       or actual.name_uk is distinct from expected.name_uk
       or actual.name_en is distinct from expected.name_en
       or actual.name_de is distinct from expected.name_de
  ) then raise exception 'A target variant ID collides with a different existing variant'; end if;
end $$;

update public.products p set category = t.target_category, product_family_id = t.target_family,
  product_variant_id = t.target_variant from correction_product_target t where p.id::text = t.id;
update public.items i set category = t.target_category, product_family_id = t.target_family,
  product_variant_id = t.target_variant from correction_item_target t where i.id::text = t.id;

do $$
begin
  if exists (
    (select receipt_id, item_count, qty_sum, unit_price_sum, discount_sum, total_orig_sum, total_eur_sum
      from correction_receipt_financial_baseline)
    except all
    (select receipt_id, count(*), coalesce(sum(qty), 0), coalesce(sum(unit_price_orig), 0),
      coalesce(sum(discount_orig), 0), coalesce(sum(total_orig), 0), coalesce(sum(total_eur), 0)
      from public.items group by receipt_id)
  ) or exists (
    (select receipt_id, count(*), coalesce(sum(qty), 0), coalesce(sum(unit_price_orig), 0),
      coalesce(sum(discount_orig), 0), coalesce(sum(total_orig), 0), coalesce(sum(total_eur), 0)
      from public.items group by receipt_id)
    except all
    (select receipt_id, item_count, qty_sum, unit_price_sum, discount_sum, total_orig_sum, total_eur_sum
      from correction_receipt_financial_baseline)
  ) then raise exception 'Receipt financial invariant changed'; end if;
  if (select product_count from correction_table_count_baseline) <> (select count(*) from public.products)
     or (select item_count from correction_table_count_baseline) <> (select count(*) from public.items)
  then raise exception 'Correction unexpectedly changed product or item count'; end if;
end $$;

do $$
begin
  if exists (
    select 1 from public.products where product_family_id = any(array[${removableFamilies.map(sql).join(', ')}])
  ) or exists (
    select 1 from public.items where product_family_id = any(array[${removableFamilies.map(sql).join(', ')}])
  ) or exists (
    select 1 from public.products where product_variant_id = any(array[${removableVariants.map(sql).join(', ')}])
  ) or exists (
    select 1 from public.items where product_variant_id = any(array[${removableVariants.map(sql).join(', ')}])
  ) then raise exception 'A source family or variant was not fully drained'; end if;
end $$;

delete from public.product_variants where id = any(array[${removableVariants.map(sql).join(', ')}]);
delete from public.product_families where id = any(array[${removableFamilies.map(sql).join(', ')}]);

do $$
begin
  if exists (
    select 1 from correction_product_target t join public.products p on p.id::text = t.id
    where p.category is distinct from t.target_category or p.product_family_id is distinct from t.target_family
      or p.product_variant_id is distinct from t.target_variant
  ) or exists (
    select 1 from correction_item_target t join public.items i on i.id::text = t.id
    where i.category is distinct from t.target_category or i.product_family_id is distinct from t.target_family
      or i.product_variant_id is distinct from t.target_variant or i.total_orig is distinct from t.expected_total_orig
      or i.total_eur is distinct from t.expected_total_eur
  ) then raise exception 'Correction postcondition failed'; end if;
  if exists (select 1 from public.products p left join public.product_families f on f.id=p.product_family_id where p.product_family_id is not null and f.id is null)
     or exists (select 1 from public.items i left join public.product_families f on f.id=i.product_family_id where i.product_family_id is not null and f.id is null)
  then raise exception 'Correction left an invalid family FK'; end if;
end $$;
commit;
`;

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, sqlText, 'utf8');
await writeFile(rollbackValidationPath, sqlText.replace(/commit;\s*$/, 'rollback;\n'), 'utf8');
await writeFile(
  snapshotPath,
  `${JSON.stringify({ generated_at: new Date().toISOString(), source: 'read-only linked Supabase snapshot', family_moves: [...familyMoves], category_only: [...categoryOnly], snapshot }, null, 2)}\n`,
  'utf8',
);
console.log(
  `Wrote ${productTargets.length} product targets and ${itemTargets.length} item targets.`,
);
console.log(outputPath);

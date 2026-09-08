import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = process.cwd();
const artifactDir = resolve(root, 'output/taxonomy-audit-20260908');
const validationInput = JSON.parse(
  await readFile(
    resolve(artifactDir, 'audit-a-reviewed-live-correction-validation-input.json'),
    'utf8',
  ),
);
const snapshot = validationInput.snapshot;
const targetManifest = JSON.parse(
  await readFile(resolve(artifactDir, 'audit-a-reviewed-live-correction-snapshot.json'), 'utf8'),
).snapshot;
const correction = await readFile(
  resolve(artifactDir, 'audit-a-reviewed-live-correction.sql'),
  'utf8',
);
const db = new PGlite();

function q(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replaceAll("'", "''")}'`;
}
function array(values = []) {
  return values.length === 0 ? 'array[]::text[]' : `array[${values.map(q).join(', ')}]`;
}

function idArray(rows) {
  return `array[${rows.map((row) => q(row.id)).join(', ')}]`;
}

await db.exec(`
  create table public.categories (
    name text primary key, group_name text not null, name_en text, name_de text,
    aliases text[] not null default '{}'
  );
  create table public.product_families (
    id text primary key, name_uk text not null, name_en text not null, name_de text not null,
    aliases text[] not null default '{}'
  );
  create table public.product_variants (
    id text primary key, family_id text not null references public.product_families(id),
    name_uk text not null, name_en text not null, name_de text not null, aliases text[] not null default '{}',
    unique (id, family_id)
  );
  create table public.products (
    id text primary key, name text not null, category text not null references public.categories(name),
    store text, store_product_code text, product_family_id text references public.product_families(id),
    product_variant_id text, brand text, is_organic boolean,
    foreign key (product_variant_id, product_family_id) references public.product_variants(id, family_id)
  );
  create table public.receipts (id text primary key);
  create table public.items (
    id text primary key, receipt_id text not null references public.receipts(id),
    product_id text references public.products(id), product_name text not null,
    category text not null references public.categories(name), qty numeric not null,
    unit_price_orig numeric not null, discount_orig numeric not null, total_orig numeric not null,
    total_eur numeric not null, product_family_id text references public.product_families(id), product_variant_id text,
    foreign key (product_variant_id, product_family_id) references public.product_variants(id, family_id)
  );
`);

await db.exec(
  `insert into public.categories values ${snapshot.categories
    .map(
      (x) =>
        `(${q(x.name)},${q(x.group_name)},${q(x.name_en)},${q(x.name_de)},${array(x.aliases)})`,
    )
    .join(', ')};`,
);

await db.exec(
  `insert into public.product_families values ${snapshot.families
    .map((x) => `(${q(x.id)},${q(x.name_uk)},${q(x.name_en)},${q(x.name_de)},${array(x.aliases)})`)
    .join(', ')};`,
);
await db.exec(
  `insert into public.product_variants values ${snapshot.variants
    .map(
      (x) =>
        `(${q(x.id)},${q(x.family_id)},${q(x.name_uk)},${q(x.name_en)},${q(x.name_de)},${array(x.aliases)})`,
    )
    .join(', ')};`,
);
await db.exec(
  `insert into public.products values ${snapshot.products
    .map(
      (x) =>
        `(${q(x.id)},${q(x.name)},${q(x.category)},${q(x.store)},${q(x.store_product_code)},${q(x.product_family_id)},${q(x.product_variant_id)},${q(x.brand)},${q(x.is_organic)})`,
    )
    .join(', ')};`,
);
await db.exec(
  `insert into public.receipts values ${snapshot.receipts.map((x) => `(${q(x.id)})`).join(', ')};`,
);
await db.exec(
  `insert into public.items values ${snapshot.items
    .map(
      (x) =>
        `(${q(x.id)},${q(x.receipt_id)},${q(x.product_id)},${q(x.product_name)},${q(x.category)},${q(x.qty)},${q(x.unit_price_orig)},${q(x.discount_orig)},${q(x.total_orig)},${q(x.total_eur)},${q(x.product_family_id)},${q(x.product_variant_id)})`,
    )
    .join(', ')};`,
);

const {
  rows: [financialBefore],
} = await db.query(
  'select coalesce(sum(total_orig),0)::text total_orig, coalesce(sum(total_eur),0)::text total_eur from public.items',
);
const [unaffectedProductsBefore, unaffectedItemsBefore] = await Promise.all([
  db.query(`
    select id, name, category, store, store_product_code, product_family_id, product_variant_id, brand, is_organic
    from public.products
    where id <> all(${idArray(targetManifest.products)})
    order by id
  `),
  db.query(`
    select id, receipt_id, product_id, product_name, category, qty, unit_price_orig, discount_orig,
      total_orig, total_eur, product_family_id, product_variant_id
    from public.items
    where id <> all(${idArray(targetManifest.items)})
    order by id
  `),
]);
await db.exec(correction);
const [
  {
    rows: [counts],
  },
  {
    rows: [money],
  },
  { rows: aliases },
] = await Promise.all([
  db.query(
    'select count(*)::int products, (select count(*)::int from public.items) items from public.products',
  ),
  db.query(
    'select coalesce(sum(total_orig),0)::text total_orig, coalesce(sum(total_eur),0)::text total_eur from public.items',
  ),
  db.query(
    "select id, name_uk, aliases from public.product_families where id in ('blueberry','cheese','egg','chips','firelighter','grapes','milk','mushroom','tomato') order by id",
  ),
]);
assert.equal(counts.products, snapshot.products.length);
assert.equal(counts.items, snapshot.items.length);
assert.equal(
  (
    await db.query(
      'select count(*)::int count from public.items where total_orig is null or total_eur is null',
    )
  ).rows[0].count,
  0,
);
assert.equal(
  (
    await db.query(
      "select count(*)::int count from public.product_families where id in ('blue_cheese','chicken_egg','potato_chips','snack_chips','cow_milk','fire_lighting_supply','grape','champignon')",
    )
  ).rows[0].count,
  0,
);
assert.equal(
  (
    await db.query(
      "select count(*)::int count from public.items where product_family_id in ('cheese','egg','chips','grapes','milk','mushroom')",
    )
  ).rows[0].count > 0,
  true,
);
assert.equal(aliases.length, 9);
assert.deepEqual(money, financialBefore);
assert.deepEqual(
  (
    await db.query(`
      select id, name, category, store, store_product_code, product_family_id, product_variant_id, brand, is_organic
      from public.products
      where id <> all(${idArray(targetManifest.products)})
      order by id
    `)
  ).rows,
  unaffectedProductsBefore.rows,
);
assert.deepEqual(
  (
    await db.query(`
      select id, receipt_id, product_id, product_name, category, qty, unit_price_orig, discount_orig,
        total_orig, total_eur, product_family_id, product_variant_id
      from public.items
      where id <> all(${idArray(targetManifest.items)})
      order by id
    `)
  ).rows,
  unaffectedItemsBefore.rows,
);

const aliasByFamily = new Map(aliases.map((family) => [family.id, family.aliases]));
for (const [familyId, sourceAlias] of [
  ['cheese', 'Brie'],
  ['egg', 'Hühnerei'],
  ['chips', 'Kartoffelchips'],
  ['grapes', 'Trauben'],
  ['milk', 'Kuhmilch'],
  ['mushroom', 'Champignon'],
  ['firelighter', 'Anzündhilfe'],
  ['blueberry', 'чорниця'],
]) {
  assert.equal(
    aliasByFamily.get(familyId).includes(sourceAlias),
    true,
    `${familyId} retains ${sourceAlias}`,
  );
}
assert.equal(aliasByFamily.get('blueberry').includes('лохина'), true);
assert.equal(
  (await db.query("select name_uk from public.product_families where id = 'blueberry'")).rows[0]
    .name_uk,
  'Лохина',
);
assert.equal(
  (await db.query("select name_uk from public.product_families where id = 'tomato'")).rows[0]
    .name_uk,
  'Помідори',
);
assert.equal(
  (
    await db.query(
      "select count(*)::int count from public.product_variants where family_id in ('cheese','egg','chips')",
    )
  ).rows[0].count > 0,
  true,
);
assert.equal(
  (
    await db.query(
      "select count(*)::int count from public.product_variants where id in ('chicken_legs','marinated_chicken_breast_fillet','unmarinated_chicken_breast_fillet') and family_id = 'chicken'",
    )
  ).rows[0].count,
  3,
);

const summary = {
  status: 'passed',
  source: 'full read-only live validation snapshot',
  captured_at: validationInput.captured_at,
  input_counts: Object.fromEntries(
    Object.entries(snapshot).map(([key, value]) => [key, value.length]),
  ),
  unaffected_rows_preserved: {
    products: unaffectedProductsBefore.rows.length,
    items: unaffectedItemsBefore.rows.length,
  },
  resulting_counts: counts,
  correction_targets: {
    products: targetManifest.products.length,
    items: targetManifest.items.length,
  },
  money,
  canonical_alias_sets: aliases,
};
await writeFile(
  resolve(artifactDir, 'audit-a-reviewed-live-correction-local-validation.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify({ ...summary, canonical_alias_sets: 'verified' }));
await db.close();

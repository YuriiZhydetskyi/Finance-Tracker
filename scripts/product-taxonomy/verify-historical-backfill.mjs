import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const manifestPath = resolve(root, 'scripts/product-taxonomy/approved-taxonomy-manifest.json');
const migrationPath = resolve(
  root,
  'supabase/migrations/20260908083827_product_taxonomy_historical_backfill.sql',
);
const expected = { ready: 591, families: 278, variants: 406, products: 622, items: 1112 };

function normalizedName(value) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function valuesBlock(migration, table, ending) {
  const match = migration.match(
    new RegExp(`insert into ${table}\\nvalues\\n([\\s\\S]*?)${ending}`),
  );
  assert(match, `Missing ${table} values block`);
  return match[1].split('\n').filter((line) => line.startsWith('('));
}

function parseValue(value) {
  if (value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  assert(value.startsWith("'") && value.endsWith("'"), `Unexpected SQL value: ${value}`);
  return value.slice(1, -1).replaceAll("''", "'");
}

function parseRow(line) {
  assert(line.startsWith('(') && (line.endsWith('),') || line.endsWith(')')), 'Malformed SQL row');
  const body = line.slice(1, line.endsWith('),') ? -2 : -1);
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quoted && character === "'" && body[index + 1] === "'") {
      value += "''";
      index += 1;
    } else if (character === "'") {
      quoted = !quoted;
      value += character;
    } else if (character === ',' && !quoted) {
      values.push(parseValue(value.trim()));
      value = '';
    } else {
      value += character;
    }
  }
  assert(!quoted, 'Unterminated SQL string');
  values.push(parseValue(value.trim()));
  return values;
}

function targets(migration, table, ending, expectedColumns) {
  const rows = valuesBlock(migration, table, ending).map(parseRow);
  assert(
    rows.every((row) => row.length === expectedColumns),
    `${table} has an invalid row shape`,
  );
  return rows;
}

const [manifest, migration] = await Promise.all([
  readFile(manifestPath, 'utf8').then(JSON.parse),
  readFile(migrationPath, 'utf8'),
]);
assert.equal(manifest.schema_version, 1);
assert.equal(manifest.entries.length, expected.ready);
const approved = new Map(manifest.entries.map((entry) => [entry.normalized_name, entry]));
assert.equal(approved.size, expected.ready);

assert.doesNotMatch(migration, /taxonomy_assignment/);
assert.doesNotMatch(migration, /create temporary table[\s\S]*?references public\./);
assert.doesNotMatch(migration, /on conflict/);
assert.match(migration, /lock table public\.products, public\.items in share row exclusive mode;/);
assert.match(migration, /Product target prestate drifted/);
assert.match(migration, /Item target prestate drifted/);
assert.match(migration, /Taxonomy postcondition failed/);
assert.match(migration, /where p\.id::text = t\.product_id;/);
assert.match(migration, /where i\.id::text = t\.item_id;/);

const variantBlock = valuesBlock(
  migration,
  'public.product_variants \\(id, family_id, name_uk, name_en, name_de, aliases\\)',
  '\\);',
);
const variantIds = variantBlock.map((line) => line.match(/^\('([^']+)'/)[1]);
assert.equal(variantIds.length, expected.variants);
assert.equal(new Set(variantIds).size, expected.variants, 'Variant IDs must be globally unique.');

const products = targets(migration, 'taxonomy_product_target', ';\\n\\ncreate temporary table', 13);
const items = targets(migration, 'taxonomy_item_target', ';\\n\\ndo \\$\\$', 9);
assert.equal(products.length, expected.products);
assert.equal(items.length, expected.items);
assert.equal(new Set(products.map(([id]) => id)).size, expected.products);
assert.equal(new Set(items.map(([id]) => id)).size, expected.items);

for (const product of products) {
  const [
    id,
    expectedName,
    ,
    ,
    ,
    expectedFamily,
    expectedVariant,
    expectedBrand,
    expectedOrganic,
    family,
    variant,
    brand,
    organic,
  ] = product;
  const entry = approved.get(normalizedName(expectedName));
  assert(entry, `Product ${id} is outside the approved scope`);
  assert.equal(expectedFamily, null, `Product ${id} did not start unclassified`);
  assert.equal(expectedVariant, null, `Product ${id} did not start unclassified`);
  assert.equal(family, entry.family_id, `Product ${id} family differs from the reviewed payload`);
  assert.equal(
    variant,
    entry.variant_id,
    `Product ${id} variant differs from the reviewed payload`,
  );
  assert.equal(brand, expectedBrand ?? entry.brand, `Product ${id} brand violates preservation`);
  assert.equal(
    organic,
    expectedOrganic ?? entry.is_organic,
    `Product ${id} Bio violates preservation`,
  );
}

for (const item of items) {
  const [id, , , expectedName, , expectedFamily, expectedVariant, family, variant] = item;
  const entry = approved.get(normalizedName(expectedName));
  assert(entry, `Item ${id} is outside the approved scope`);
  assert.equal(expectedFamily, null, `Item ${id} did not start unclassified`);
  assert.equal(expectedVariant, null, `Item ${id} did not start unclassified`);
  assert.equal(family, entry.family_id, `Item ${id} family differs from the reviewed payload`);
  assert.equal(variant, entry.variant_id, `Item ${id} variant differs from the reviewed payload`);
}

console.log(
  `Verified ${expected.ready} approved classifications and a frozen recovery scope of ${products.length} products and ${items.length} items.`,
);

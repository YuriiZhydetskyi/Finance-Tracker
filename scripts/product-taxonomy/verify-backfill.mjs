import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawNames } from './catalog-tools.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const requireTool = createRequire(resolve(directory, '../../.cache/taxonomy-typegen/package.json'));
const { Client } = requireTool('pg');
const databaseUrl = new URL(process.argv[2]);
if (!['127.0.0.1', 'localhost'].includes(databaseUrl.hostname)) {
  throw new Error(
    'Backfill integration verification is restricted to disposable localhost databases.',
  );
}
const assignments = JSON.parse(await readFile(resolve(directory, 'assignments.json'), 'utf8'));
const backfill = await readFile(resolve(directory, 'proposed-backfill.sql'), 'utf8');
const client = new Client({ connectionString: databaseUrl.href });
await client.connect();
try {
  const fixtures = assignments.flatMap((assignment) =>
    rawNames(assignment.source_name).map((name) => ({ ...assignment, name })),
  );
  await client.query(`insert into public.categories(name,group_name) values ('Backfill test','Test');
    insert into public.receipts(id,date,store,currency,total_orig,fx_rate_eur,total_eur,paid_by,source)
      values('backfill-receipt','2026-09-07','Test','EUR',1,1,1,'test@example.invalid','manual');
    insert into public.product_families(id,name_uk,name_en,name_de)
      values('backfill_preserved','Збережено','Preserved','Behalten');`);
  for (let index = 0; index < fixtures.length; index++) {
    const fixture = fixtures[index];
    const id = `backfill-${index}`;
    await client.query(
      `insert into public.products(id,name,category,store,store_product_code)
      values($1,$2,'Backfill test','Test',$1)`,
      [id, fixture.name],
    );
    // Include both catalogue-linked purchases and historical unlinked items.
    await client.query(
      `insert into public.items(id,receipt_id,product_id,product_name,category,qty,unit_price_orig,total_orig,total_eur,consumed_by)
      values($1,'backfill-receipt',$2,$3,'Backfill test',1,1,1,1,'shared')`,
      [id, index % 2 ? null : id, fixture.name],
    );
  }
  const firstReady = fixtures.find((fixture) => fixture.status === 'ready');
  const readyName = firstReady.name;
  await client.query(
    `insert into public.products(id,name,category,store,store_product_code,product_family_id,brand,is_organic)
    values('backfill-preserve',$1,'Backfill test','Test','preserve','backfill_preserved','Existing brand',false);
  `,
    [readyName],
  );
  await client.query(
    `insert into public.products(id,name,category,store,store_product_code,brand,is_organic)
    values('backfill-attributes',$1,'Backfill test','Test','attributes','Existing brand',false)`,
    [readyName],
  );
  await client.query(
    `insert into public.items(id,receipt_id,product_name,category,qty,unit_price_orig,total_orig,total_eur,consumed_by,product_family_id)
    values('backfill-preserved-item','backfill-receipt',$1,'Backfill test',1,1,1,1,'shared','backfill_preserved')`,
    [readyName],
  );
  await client.query(
    `insert into public.items(id,receipt_id,product_name,category,qty,unit_price_orig,total_orig,total_eur,consumed_by)
    values('backfill-negative','backfill-receipt',$1,'Backfill test',1,-1,-1,-1,'shared')`,
    [readyName],
  );
  await client.query(backfill);
  const products = (
    await client.query(
      `select id,name,product_family_id,product_variant_id,brand,is_organic from public.products order by id`,
    )
  ).rows;
  const items = (
    await client.query(
      `select id,product_name,product_family_id,product_variant_id from public.items order by id`,
    )
  ).rows;
  const productMap = new Map(products.map((row) => [row.id, row]));
  const itemMap = new Map(items.map((row) => [row.id, row]));
  for (let index = 0; index < fixtures.length; index++) {
    const fixture = fixtures[index];
    const id = `backfill-${index}`;
    const product = productMap.get(id);
    const item = itemMap.get(id);
    const family = fixture.status === 'ready' ? fixture.product_family_id : null;
    const variant = fixture.status === 'ready' ? fixture.product_variant_id : null;
    assert.equal(product.name, fixture.name);
    assert.equal(item.product_name, fixture.name);
    for (const row of [product, item]) {
      assert.equal(row.product_family_id, family, fixture.source_name);
      assert.equal(row.product_variant_id, variant, fixture.source_name);
    }
    assert.equal(product.brand, fixture.status === 'ready' ? fixture.brand : null);
    assert.equal(product.is_organic, fixture.status === 'ready' ? fixture.is_organic : null);
  }
  assert.equal(productMap.get('backfill-preserve').product_family_id, 'backfill_preserved');
  assert.equal(productMap.get('backfill-preserve').brand, 'Existing brand');
  assert.equal(productMap.get('backfill-preserve').is_organic, false);
  assert.equal(
    productMap.get('backfill-attributes').product_family_id,
    firstReady.product_family_id,
  );
  assert.equal(productMap.get('backfill-attributes').brand, 'Existing brand');
  assert.equal(productMap.get('backfill-attributes').is_organic, false);
  assert.equal(itemMap.get('backfill-preserved-item').product_family_id, 'backfill_preserved');
  assert.equal(itemMap.get('backfill-negative').product_family_id, null);
  // Exercise user-entered spellings against the real catalog and SQL search,
  // not a duplicated JavaScript approximation of the matching rules.
  for (const [query, variantIds] of [
    ['чері', ['tomatoes_cherry_vine', 'tomatoes_cherry_roma']],
    ['свиняча шия', ['pork_neck_steak', 'pork_neck_steak_marinated']],
  ]) {
    const matches = new Set(
      (await client.query('select id from public.search_waste_items($1)', [query])).rows.map(
        (row) => row.id,
      ),
    );
    const expected = fixtures.flatMap((fixture, index) =>
      fixture.status === 'ready' && variantIds.includes(fixture.product_variant_id)
        ? [`backfill-${index}`]
        : [],
    );
    assert(expected.length > 0, `Missing search fixtures for ${query}`);
    for (const id of expected) assert(matches.has(id), `Missing ${id} for ${query}`);
  }
  await client.query(backfill);
  assert.deepEqual(
    (
      await client.query(
        `select id,name,product_family_id,product_variant_id,brand,is_organic from public.products order by id`,
      )
    ).rows,
    products,
  );
  assert.deepEqual(
    (
      await client.query(
        `select id,product_name,product_family_id,product_variant_id from public.items order by id`,
      )
    ).rows,
    items,
  );
  console.log(
    `Backfill passed for ${fixtures.length} source-name fixtures, linked/unlinked history, existing classifications, negative rows, and an identical repeat run.`,
  );
} finally {
  await client.end();
}

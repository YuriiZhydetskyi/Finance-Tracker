import assert from 'node:assert/strict';
import {
  applyCanonicalStoresMigrations,
  asUser,
  createPreDeployDatabase,
  scalar,
} from './lib/pglite-app-schema.mjs';
import {
  iid,
  loadDuplicateProductsFixture,
  pid,
  PP,
  rid,
} from './lib/duplicate-products-fixture.mjs';

const OWNER = 'a@example.com';
const STRANGER = 'b@example.com';

const database = await createPreDeployDatabase();
const { db } = database;
await loadDuplicateProductsFixture(db);
// Only the machinery: the data migration (20261027120300) is not applied, so every
// duplicate is still there and every merge in this script is an explicit call.
await applyCanonicalStoresMigrations(database, { upTo: '20261027120200_merge_products.sql' });

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = (sql, params = []) => scalar(db, sql, params);
const merge = (keep, drop, dryRun, resolution = {}) =>
  one('select public.merge_products($1, $2, $3, $4::jsonb)', [
    pid(keep),
    pid(drop),
    dryRun,
    JSON.stringify(resolution),
  ]);

async function expectFailure(promise, expected, code) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message), expected);
    if (code) assert.equal(error.code, code);
    return true;
  });
}

// Every column that is evidence or identity, per table, hashed. updated_at is the
// one thing a merge and its undo legitimately change (the set_updated_at triggers).
const TABLES = {
  products: 'id',
  items: 'id',
  product_prices: 'id',
  product_match_rules: 'store_key, raw_product_name_key',
};
async function dump() {
  const result = {};
  for (const [table, order] of Object.entries(TABLES)) {
    result[table] = await one(
      `select md5(coalesce(string_agg((to_jsonb(t) - 'updated_at')::text, '|' order by ${order}), '')) from public.${table} t`,
    );
    result[`${table}_count`] = Number(await one(`select count(*) from public.${table}`));
  }
  result.merge_log = Number(await one('select count(*) from public.product_merge_log'));
  return result;
}
const tablesOnly = ({ merge_log: _ignored, ...rest }) => rest;

try {
  const initial = await dump();
  assert.equal(initial.products_count, 55);

  // ── 1. Dry run (the default) writes nothing and says what would happen ────
  const plan = await one('select public.merge_products($1, $2)', [pid(3), pid(4)]);
  assert.equal(plan.status, 'dry_run');
  assert.deepEqual(plan.will_move, { items: 1, product_prices: 1, product_match_rules: 1 });
  assert.equal(plan.result.store, 'ALDI SÜD');
  assert.deepEqual(plan.conflicts, []);
  const batchPlan = await q('select tier, status from public.merge_duplicate_products()');
  assert.equal(batchPlan.filter((r) => r.status === 'would_merge').length, 14);
  assert.equal(batchPlan.filter((r) => r.status === 'skipped_conflict').length, 4);
  assert.deepEqual(await dump(), initial, 'dry runs leave every table as it was');

  // ── 2. Identity guards ────────────────────────────────────────────────────
  await expectFailure(merge(3, 3, true), /two different ids/, '22023');
  await expectFailure(merge(3, 999, true), /not found/, 'P0002');
  await expectFailure(merge(1, 30, true), /different stores/, '22023');
  await expectFailure(merge(22, 23, true), /different store_product_code/, '22023');
  await expectFailure(
    one('select public.merge_products($1, $2, true, $3::jsonb)', [pid(3), pid(4), '[]']),
    /JSON object/,
    '22023',
  );

  // ── 3. Conflicts are listed and never chosen silently ─────────────────────
  const taxonomy = await merge(5, 6, true);
  assert.deepEqual(
    taxonomy.conflicts.map((c) => [c.field, c.blocking]),
    [['taxonomy', true]],
  );
  await expectFailure(merge(5, 6, false), /unresolved blocking conflicts/, '23514');
  assert.deepEqual(await dump(), initial, 'a refused merge leaves both rows');
  const packaged = await merge(7, 8, true);
  assert.deepEqual(
    packaged.conflicts.map((c) => c.field),
    ['packaged_product_id'],
  );
  const packagingState = await merge(21, 20, true);
  assert.deepEqual(
    packagingState.conflicts.map((c) => c.field),
    ['packaged_product_id'],
  );
  const category = await merge(9, 10, true);
  assert.deepEqual(
    category.conflicts.map((c) => [c.field, c.blocking]),
    [['category', false]],
  );

  // ── 4. The hazards, on a pair that has all three kinds of reference ───────
  // P4 (dropped) has one item, one price snapshot and one learned rule.
  const itemsBefore = await one(
    `select md5(string_agg(concat_ws('|', id, product_name, raw_product_name, category,
                                     coalesce(product_family_id, '~'), coalesce(product_variant_id, '~')),
                           ';' order by id)) from public.items`,
  );
  const ruleCountBefore = Number(await one('select count(*) from public.product_match_rules'));
  const priceCountBefore = Number(await one('select count(*) from public.product_prices'));
  const merged = await merge(3, 4, false);
  assert.equal(merged.status, 'merged');
  assert.equal(
    Number(await one('select count(*) from public.product_match_rules')),
    ruleCountBefore,
    'the learned rule survived the delete (its FK is ON DELETE CASCADE)',
  );
  assert.equal(
    await one('select product_id from public.product_match_rules where raw_product_name_key = $1', [
      'süßkartoffeln lose',
    ]),
    pid(3),
  );
  assert.equal(Number(await one('select count(*) from public.product_prices')), priceCountBefore);
  assert.equal(
    await one('select count(*)::int from public.product_prices where product_id = $1', [pid(4)]),
    0,
  );
  assert.equal(Number(await one('select count(*) from public.items where product_id is null')), 0);
  assert.equal(
    await one(
      `select md5(string_agg(concat_ws('|', id, product_name, raw_product_name, category,
                                       coalesce(product_family_id, '~'), coalesce(product_variant_id, '~')),
                             ';' order by id)) from public.items`,
    ),
    itemsBefore,
    'items keep their label, category and taxonomy snapshot',
  );
  assert.deepEqual(await merge(3, 4, false), { status: 'already_merged', log_id: merged.log_id });
  await expectFailure(merge(1, 4, false), /already merged into/, '23505');
  assert.equal(await one('select count(*)::int from public.product_merge_log'), 1);

  // The control: without the second statement the item trigger rewrites history.
  await db.exec('begin');
  await db.exec(
    `update public.items set product_id = '${pid(19)}' where product_id = '${pid(18)}'`,
  );
  const rewritten = await q(
    `select product_variant_id from public.items where id = any($1) order by id`,
    [[iid(25), iid(26)]],
  );
  await db.exec('rollback');
  assert.deepEqual(
    rewritten,
    [{ product_variant_id: 'whole_milk' }, { product_variant_id: 'whole_milk' }],
    'a plain re-point DOES rewrite family-only snapshots (this is what merge_products prevents)',
  );

  // The survivor takes the dropped row's code only after that row is gone.
  await db.exec(`
    insert into public.products (id, name, store, store_product_code, category)
      values ('${pid(900)}', 'Brötchen', 'Aldi Süd', '424242', 'Бакалія');
  `);
  const absorbed = await merge(14, 900, false);
  assert.equal(absorbed.result.store_product_code, '424242');
  assert.deepEqual(
    (await q(`select store, store_product_code from public.products where id = $1`, [pid(14)]))[0],
    { store: 'ALDI SÜD', store_product_code: '424242' },
  );

  // ── 5. Resolutions ────────────────────────────────────────────────────────
  await merge(5, 6, false, { taxonomy: 'drop' });
  assert.equal(
    await one('select product_family_id from public.products where id = $1', [pid(5)]),
    'sandwich_bread',
  );
  await merge(7, 8, false, { packaged_product_id: 'drop' });
  assert.equal(
    await one('select packaged_product_id from public.products where id = $1', [pid(7)]),
    PP.two,
  );
  const chosen = await merge(9, 10, false, { category: 'drop' });
  assert.equal(chosen.status, 'merged');
  assert.equal(
    await one('select category from public.products where id = $1', [pid(9)]),
    'Солодке',
  );
  await merge(21, 20, false, { prefer: 'keep' });
  assert.deepEqual(
    (
      await q(
        `select packaged_product_id, packaging_not_applicable from public.products where id = $1`,
        [pid(21)],
      )
    )[0],
    { packaged_product_id: PP.three, packaging_not_applicable: false },
  );

  // ── 6. The batch, then everything back ────────────────────────────────────
  const batch = await q('select status from public.merge_duplicate_products(false)');
  assert.equal(
    batch.filter((r) => r.status === 'merged').length,
    13,
    'the 14 rule pairs minus the one merged by hand',
  );
  assert.equal(batch.filter((r) => r.status === 'skipped_conflict').length, 0);
  assert.equal(await one('select count(*)::int from public.merge_duplicate_products(true)'), 0);

  const logs = await q(
    'select id, keep_id, drop_id from public.product_merge_log order by id desc',
  );
  // By hand: 3/4, 14/900 and the four conflict pairs; then the 13 rule pairs.
  assert.equal(logs.length, 6 + 13);
  // Nothing was lost on the way.
  assert.equal(Number(await one('select count(*) from public.items')), initial.items_count);
  assert.equal(Number(await one('select count(*) from public.items where product_id is null')), 0);
  assert.equal(
    Number(await one('select count(*) from public.product_prices')),
    initial.product_prices_count,
  );
  assert.equal(
    Number(await one('select count(*) from public.product_match_rules')),
    initial.product_match_rules_count,
  );

  // Undo in reverse order; the extra row created for the code test goes first.
  for (const log of logs) {
    const result = await one('select public.unmerge_product($1)', [log.id]);
    assert.equal(result.status, 'reverted');
  }
  await db.exec(`delete from public.products where id = '${pid(900)}'`);
  assert.deepEqual(
    tablesOnly(await dump()),
    tablesOnly(initial),
    'unmerging every merge restores the start state',
  );
  assert.deepEqual(await one('select public.unmerge_product($1)', [logs[0].id]), {
    status: 'already_reverted',
    log_id: logs[0].id,
  });
  await expectFailure(one('select public.unmerge_product($1)', [999999]), /not found/, 'P0002');

  // A reverted pair can be merged again (the log's uniqueness only covers active merges).
  assert.equal((await merge(3, 4, false)).status, 'merged');
  await one('select public.unmerge_product($1)', [
    (await q('select max(id) as id from public.product_merge_log'))[0].id,
  ]);

  // ── 7. Who may merge ─────────────────────────────────────────────────────
  await db.exec(`insert into public.app_users (email) values ('${OWNER}') on conflict do nothing`);
  await expectFailure(
    asUser(db, STRANGER, 'select public.merge_products($1, $2, false)', [pid(3), pid(4)]),
    /not found/,
    'P0002',
  );
  assert.equal(await one('select count(*)::int from public.products where id = $1', [pid(4)]), 1);
  const asOwner = await asUser(db, OWNER, 'select public.merge_products($1, $2, false) as result', [
    pid(3),
    pid(4),
  ]);
  assert.equal(asOwner.rows[0].result.status, 'merged');
  assert.equal(
    (
      await asUser(
        db,
        OWNER,
        'select merged_by from public.product_merge_log order by id desc limit 1',
      )
    ).rows[0].merged_by,
    OWNER,
  );
  await expectFailure(
    asUser(db, OWNER, 'delete from public.product_merge_log'),
    /permission denied/,
  );

  // ── 8. A group of three with a skipped member ────────────────────────────
  // The survivor is stored as "Aldi Süd", one loser (canonical spelling, a different
  // card) is skipped, the other loser merges. Writing the canonical spelling onto the
  // survivor would collide with the skipped row on (store, code): it must keep its own.
  await db.exec('begin');
  try {
    const trio = (n) => pid(800 + n);
    await db.exec(`
      insert into public.products (id, name, category, store, store_product_code, packaged_product_id)
        values ('${trio(1)}', 'Trio', 'Бакалія', 'Aldi Süd', '808080', '${PP.one}'),
               ('${trio(2)}', 'Trio', 'Бакалія', 'ALDI SÜD', '808080', '${PP.two}'),
               ('${trio(3)}', 'Trio', 'Бакалія', 'Aldi', '808080', null);
      insert into public.items (id, receipt_id, product_id, product_name, raw_product_name, category,
                                qty, unit_price_orig, discount_orig, total_orig, total_eur, consumed_by)
        values ('${iid(900)}', '${rid(4)}', '${trio(1)}', 'Trio', 'Trio', 'Бакалія', 1, 1, 0, 1, 1, 'shared');
    `);
    const trioBatch = await q(
      `select keep_id, drop_id, status from public.merge_duplicate_products(false)
        where keep_id = $1 order by drop_id`,
      [trio(1)],
    );
    assert.deepEqual(trioBatch, [
      { keep_id: trio(1), drop_id: trio(2), status: 'skipped_conflict' },
      { keep_id: trio(1), drop_id: trio(3), status: 'merged' },
    ]);
    assert.equal(
      await one('select store from public.products where id = $1', [trio(1)]),
      'Aldi Süd',
      'the survivor keeps its spelling while a twin holds the canonical one',
    );
  } finally {
    await db.exec('rollback');
  }

  console.log('merge_products SQL tests passed');
} finally {
  await db.close();
}

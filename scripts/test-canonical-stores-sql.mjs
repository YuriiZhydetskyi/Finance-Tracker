import assert from 'node:assert/strict';
import {
  applyCanonicalStoresMigrations,
  asUser,
  createPreDeployDatabase,
  migrationText,
  scalar,
  ULID,
} from './lib/pglite-app-schema.mjs';
import { iid, loadDuplicateProductsFixture, pid, rid } from './lib/duplicate-products-fixture.mjs';

const OWNER = 'a@example.com';
const STRANGER = 'b@example.com';

const database = await createPreDeployDatabase();
const { db } = database;

const rows = async (sql, params = []) => (await db.query(sql, params)).rows;

async function expectFailure(promise, expected) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message), expected);
    return true;
  });
}

try {
  // ── 1. The key ────────────────────────────────────────────────────────────
  await applyCanonicalStoresMigrations(database, {
    upTo: '20261027120000_store_name_registry.sql',
  });

  const keyCases = [
    ['ALDI SÜD', 'aldi sud'],
    ['Aldi Süd', 'aldi sud'],
    ['  aldi   süd. ', 'aldi sud'],
    ['EDEKA Straßfeld', 'edeka strassfeld'],
    ['ORLEN S.A.', 'orlen s a'],
    [
      'S-mart Lebensmittelmärkte GmbH & Co KG (REWE Rahmati)',
      's mart lebensmittelmarkte gmbh co kg rewe rahmati',
    ],
    ['VIS A VIS KOZIOŁKÓW', 'vis a vis koziolkow'],
    ['Кафе у Stolberg', 'кафе у stolberg'],
    ['', ''],
    ['---', ''],
    [null, ''],
  ];
  for (const [input, expected] of keyCases) {
    assert.equal(
      await scalar(db, 'select public.normalize_store_key($1)', [input]),
      expected,
      input,
    );
  }
  // Idempotent: the registry's own check constraint depends on it.
  for (const [, key] of keyCases) {
    assert.equal(await scalar(db, 'select public.normalize_store_key($1)', [key]), key);
  }

  // ── 2. Canonical names: registry, patterns, first seen wins ───────────────
  const canonical = (store) => scalar(db, 'select public.canonical_store_name($1)', [store]);
  const register = (store) => scalar(db, 'select public.register_store_name($1)', [store]);

  assert.equal(await canonical('Aldi Süd'), 'ALDI SÜD');
  assert.equal(await canonical('Aldi'), 'ALDI SÜD');
  assert.equal(await canonical('ALDI SUED'), 'ALDI SÜD');
  assert.equal(await canonical('Aldi Nord'), 'Aldi Nord', 'Aldi Nord is a different chain');
  assert.equal(await canonical('Netto Marken-Discount'), 'Netto');
  assert.equal(await canonical('REWE Anything oHG'), 'REWE');
  assert.equal(await canonical('Foo GmbH (REWE Bar)'), 'REWE');
  assert.equal(await canonical('Rewerk Dienste'), 'Rewerk Dienste', 'rewe must be a whole word');
  assert.equal(await canonical('AVEX Tankstelle Wherever'), 'AVEX');
  assert.equal(await canonical('ORLEN S.A.'), 'ORLEN');
  assert.equal(await canonical('EDEKA Straßfeld'), 'EDEKA Straßfeld');
  assert.equal(await canonical('Marktkauf Frechen'), 'Marktkauf Frechen');
  assert.equal(
    await canonical('  Cafe   Extrablatt '),
    'Cafe Extrablatt',
    'unknown: trimmed, spaces collapsed',
  );
  assert.equal(await canonical(''), '');

  // canonical_store_name never writes; register_store_name remembers the first spelling.
  assert.equal(await scalar(db, 'select count(*)::int from public.store_name_registry'), 0);
  assert.equal(await register('Cafe Extrablatt'), 'Cafe Extrablatt');
  assert.equal(await register('CAFE  extrablatt!'), 'Cafe Extrablatt', 'first seen wins');
  assert.equal(await canonical('café extrablatt'), 'Cafe Extrablatt');
  assert.equal(await scalar(db, 'select count(*)::int from public.store_name_registry'), 1);
  assert.equal(await register('Aldi Süd'), 'ALDI SÜD');
  assert.equal(
    await scalar(db, 'select count(*)::int from public.store_name_registry'),
    1,
    'a chain pattern resolves without adding a registry row',
  );

  // An exact registry row beats a pattern; of two patterns the longer wins.
  await db.exec(`
    insert into public.store_name_registry (store_key, canonical_name) values ('rewe city', 'REWE City');
    insert into public.store_name_patterns (pattern, canonical_name)
      values ('^rewe city (nord|sued|west|ost)( |$)', 'REWE City Filiale');
  `);
  assert.equal(await canonical('REWE City'), 'REWE City');
  assert.equal(await canonical('REWE City Nord'), 'REWE City Filiale');
  assert.equal(await canonical('REWE Markt'), 'REWE');
  await db.exec(`
    delete from public.store_name_registry where store_key in ('rewe city', 'cafe extrablatt');
    delete from public.store_name_patterns where pattern like '^rewe city %';
  `);
  await expectFailure(
    db.exec(
      `insert into public.store_name_patterns (pattern, canonical_name) values ('(', 'Broken')`,
    ),
    /invalid regular expression/i,
  );
  await expectFailure(
    db.exec(
      `insert into public.store_name_registry (store_key, canonical_name) values ('Not Normal', 'x')`,
    ),
    /store_name_registry_store_key_check/,
  );

  // ── 3. RLS: the registry is the app's to read and extend, not to rewrite ──
  await db.exec(`insert into public.app_users (email) values ('${OWNER}')`);
  assert.equal(
    (await asUser(db, OWNER, `select public.register_store_name('Brand New Shop') as name`)).rows[0]
      .name,
    'Brand New Shop',
  );
  await expectFailure(
    asUser(db, STRANGER, `select public.register_store_name('Another New Shop') as name`),
    /row-level security/,
  );
  await expectFailure(
    asUser(db, OWNER, `delete from public.store_name_registry where store_key = 'brand new shop'`),
    /permission denied/,
  );
  await expectFailure(
    asUser(
      db,
      OWNER,
      `insert into public.store_name_patterns (pattern, canonical_name) values ('x', 'X')`,
    ),
    /permission denied/,
  );
  assert.equal(
    (await asUser(db, OWNER, 'select count(*)::int as n from public.store_name_patterns')).rows[0]
      .n,
    5,
  );
  assert.equal(
    (await asUser(db, STRANGER, 'select count(*)::int as n from public.store_name_patterns'))
      .rows[0].n,
    0,
    'a signed-in stranger sees no registry or pattern',
  );
  await db.exec(`delete from public.store_name_registry where store_key = 'brand new shop'`);
  await db.exec(`delete from public.app_users`);

  // ── 4. The whole deploy over realistic data ───────────────────────────────
  // Start again from the production state, put the fixture in, then run every
  // migration in order, as `supabase db push` would.
  const deploy = await createPreDeployDatabase();
  const meta = await loadDuplicateProductsFixture(deploy.db);
  const live = deploy.db;
  const q = async (sql, params = []) => (await live.query(sql, params)).rows;
  const one = async (sql, params = []) => scalar(live, sql, params);

  // Same helpers against the second database.
  const snapshotOf = async () => {
    const stats = {};
    for (const name of [
      'stats_by_month',
      'stats_by_category',
      'stats_by_user',
      'stats_savings_by_month',
      'stats_waste_by_month',
    ]) {
      stats[name] = await q(`select * from public.${name}()`);
    }
    return {
      products: Number(await one('select count(*) from public.products')),
      items: Number(await one('select count(*) from public.items')),
      itemsWithoutProduct: Number(
        await one('select count(*) from public.items where product_id is null'),
      ),
      prices: Number(await one('select count(*) from public.product_prices')),
      receipts: Number(await one('select count(*) from public.receipts')),
      itemHash: await one(
        `select md5(string_agg(concat_ws('|', id, receipt_id, product_name, raw_product_name, category,
                                         qty, unit_price_orig, total_eur,
                                         coalesce(product_family_id, '~'), coalesce(product_variant_id, '~')),
                               ';' order by id))
           from public.items`,
      ),
      stats,
    };
  };

  // stats_by_store groups by the raw store, so it changes on purpose: compare it
  // with the same totals grouped by canonical name.
  const before = await snapshotOf();
  const storeStatsBefore = await q(
    `select store, total_eur::text as total from public.stats_by_store(null, null, null, null, 100) order by store`,
  );
  assert.equal(before.products, meta.productCount);
  assert.equal(before.items, meta.itemCount);
  assert.equal(before.itemsWithoutProduct, 0);
  const rulesBefore = Number(await one('select count(*) from public.product_match_rules'));
  assert.equal(rulesBefore, meta.ruleCount);

  const notices = await applyCanonicalStoresMigrations(deploy);

  const after = await snapshotOf();
  // 14 pairs merged: 6 by code, 8 by name; 4 pairs left for the owner.
  assert.equal(after.products, before.products - 14);
  assert.equal(await one('select count(*)::int from public.product_merge_log'), 14);
  for (const key of ['items', 'itemsWithoutProduct', 'prices', 'receipts', 'itemHash', 'stats']) {
    assert.deepEqual(after[key], before[key], `${key} must not change`);
  }
  assert.equal(
    await one(`select count(*)::int from public.items i where i.product_id is not null
                and not exists (select 1 from public.products p where p.id = i.product_id)`),
    0,
    'no orphaned item',
  );

  // by_store: the by-spelling totals of the same receipts now sit under one name each.
  const storeStatsAfter = await q(
    `select store, total_eur::text as total from public.stats_by_store(null, null, null, null, 100) order by store`,
  );
  const regroup = (stores) => {
    const totals = new Map();
    for (const { store, total } of stores) {
      totals.set(store, (totals.get(store) ?? 0) + Number(total));
    }
    return totals;
  };
  const canonicalOf = new Map();
  for (const { store } of storeStatsBefore) {
    canonicalOf.set(store, await one('select public.canonical_store_name($1)', [store]));
  }
  const expectedByCanonical = new Map();
  for (const { store, total } of storeStatsBefore) {
    const key = canonicalOf.get(store);
    expectedByCanonical.set(key, (expectedByCanonical.get(key) ?? 0) + Number(total));
  }
  const actualByStore = regroup(storeStatsAfter);
  for (const [store, total] of expectedByCanonical) {
    // 'AMAZON.DE' stays a separate row (see below); everything else must add up.
    if (store === 'Amazon.de') continue;
    assert.ok(
      Math.abs((actualByStore.get(store) ?? Number.NaN) - total) < 0.005,
      `${store}: ${String(actualByStore.get(store))} vs ${String(total)}`,
    );
  }

  // Survivors and the rows that stayed.
  const survivors = await q(
    `select id, store, store_product_code, packaged_product_id, product_family_id, product_variant_id
       from public.products where id = any($1) order by id`,
    [[pid(1), pid(11), pid(15), pid(19), pid(30), pid(60), pid(50)]],
  );
  assert.deepEqual(
    survivors.map((r) => [r.id, r.store]),
    [
      [pid(1), 'ALDI SÜD'],
      [pid(11), 'ALDI SÜD'],
      [pid(15), 'ALDI SÜD'],
      [pid(19), 'ALDI SÜD'],
      [pid(30), 'Netto'],
      [pid(50), 'REWE'],
      [pid(60), 'AVEX'],
    ].sort(([left], [right]) => left.localeCompare(right)),
  );
  const refined = survivors.find((r) => r.id === pid(19));
  assert.deepEqual([refined.product_family_id, refined.product_variant_id], ['milk', 'whole_milk']);
  const strays = await q(
    `select id from public.products where store <> public.canonical_store_name(store) order by id`,
  );
  assert.deepEqual(
    strays.map((r) => r.id),
    [pid(10), pid(21), pid(6), pid(8)].sort((left, right) => left.localeCompare(right)),
    'exactly the four conflicting pairs keep their own spelling',
  );
  // Both rows of every skipped pair survive untouched.
  for (const n of [5, 6, 7, 8, 9, 10, 20, 21]) {
    assert.equal(await one('select count(*)::int from public.products where id = $1', [pid(n)]), 1);
  }
  // Different codes / different stores / deposits are never merged.
  for (const n of [22, 23, 24, 25, 42, 43, 44, 45, 70, 71]) {
    assert.equal(await one('select count(*)::int from public.products where id = $1', [pid(n)]), 1);
  }

  // Item snapshots: the family-only snapshot of a re-pointed item is still family-only.
  assert.deepEqual(
    await q(
      `select id, product_id, product_family_id, product_variant_id from public.items
        where product_name = 'Milch' order by id`,
    ),
    [
      { id: iid(25), product_id: pid(19), product_family_id: 'milk', product_variant_id: null },
      { id: iid(26), product_id: pid(19), product_family_id: 'milk', product_variant_id: null },
      {
        id: iid(27),
        product_id: pid(19),
        product_family_id: 'milk',
        product_variant_id: 'whole_milk',
      },
      { id: iid(28), product_id: pid(19), product_family_id: 'milk', product_variant_id: null },
    ],
  );

  // Rules: the learned rule followed its product and the canonical key; the one
  // that would have collided with a different product stayed where it was.
  assert.deepEqual(
    await q(
      `select store_key, raw_product_name_key, product_id from public.product_match_rules order by 1, 2`,
    ),
    [
      { store_key: 'aldi', raw_product_name_key: 'mix', product_id: pid(9) },
      { store_key: 'aldi süd', raw_product_name_key: 'brötchen', product_id: pid(14) },
      { store_key: 'aldi süd', raw_product_name_key: 'mix', product_id: pid(10) },
      { store_key: 'aldi süd', raw_product_name_key: 'süßkartoffeln lose', product_id: pid(3) },
    ],
  );
  assert.deepEqual(
    notices.filter((n) => n.startsWith('canonical stores:')),
    [
      `canonical stores: products ${String(meta.productCount)} -> ${String(meta.productCount - 14)} (14 pair(s) merged, 15 item(s) re-pointed, 4 pair(s) skipped for the owner)`,
      'canonical stores: products re-stored 3, left on their own spelling 4; receipts re-stored 9 (printed spelling kept), left 1; rules re-keyed 1, deduplicated 1, left 1',
      `canonical stores: items ${String(meta.itemCount)}, items without a product 0, product_prices ${String(meta.itemCount)}, receipts ${String(meta.receiptCount)} (all unchanged)`,
    ],
  );
  assert.equal(notices.filter((n) => n.startsWith('SKIPPED')).length, 4);
  assert.equal(notices.filter((n) => n.startsWith('MERGED')).length, 14);

  // Receipts: canonical store, the printed spelling kept, the clash left alone.
  assert.deepEqual(
    await q(`select store, store_printed from public.receipts where id = any($1) order by id`, [
      [rid(4), rid(6), rid(8), rid(11), rid(12), rid(16), rid(18)],
    ]),
    [
      { store: 'ALDI SÜD', store_printed: 'Aldi Süd' },
      { store: 'ALDI SÜD', store_printed: 'Aldi' },
      { store: 'Netto', store_printed: 'Netto Marken-Discount' },
      { store: 'REWE', store_printed: 'REWE Müller oHG' },
      { store: 'REWE', store_printed: 'Beispiel Markt GmbH & Co KG (REWE Beispiel)' },
      { store: 'AVEX', store_printed: 'AVEX Tankstelle Beispieldorf' },
      { store: 'ORLEN', store_printed: 'ORLEN S.A.' },
    ],
  );
  assert.equal(
    await one(`select store from public.receipts where id = $1`, [rid(20)]),
    'AMAZON.DE',
    'a rewrite that would break (store, merchant_order_id) is left for the owner',
  );
  // Both Netto receipts survive: deleting the double import is the owner's call.
  assert.equal(await one(`select count(*)::int from public.receipts where store = 'Netto'`), 2);

  // Undoing every merge on the deployed database: the canonical-store trigger must
  // not rewrite the re-created rows onto the survivors' keys, the spellings come
  // back, and the rules (re-keyed by the data migration) go back with their rows.
  const productsAfterDeploy = Number(await one('select count(*) from public.products'));
  const logIds = (await q('select id from public.product_merge_log order by id desc')).map(
    (r) => r.id,
  );
  await live.exec('begin');
  try {
    for (const id of logIds) {
      assert.equal(
        (await q('select public.unmerge_product($1) as result', [id]))[0].result.status,
        'reverted',
      );
    }
    assert.equal(
      Number(await one('select count(*) from public.products')),
      productsAfterDeploy + 14,
    );
    assert.deepEqual(
      (await q(`select store, store_product_code from public.products where id = $1`, [pid(2)]))[0],
      { store: 'Aldi Süd', store_product_code: '111111' },
      'the dropped twin is back under the spelling it had',
    );
    assert.equal(
      await one('select store from public.products where id = $1', [pid(1)]),
      'ALDI SÜD',
    );
    assert.equal(await one(`select count(*)::int from public.items where product_id is null`), 0);
    assert.equal(await one('select product_id from public.items where id = $1', [iid(4)]), pid(2));
    assert.equal(
      await one(`select product_id from public.product_match_rules where raw_product_name_key = 'süßkartoffeln lose'
                  order by store_key limit 1`),
      pid(4),
      'the rule that followed the merge goes back to the dropped row',
    );
    assert.equal(
      await one(`select count(*)::int from public.product_merge_log where reverted_at is null`),
      0,
    );
  } finally {
    await live.exec('rollback');
  }
  // A NULL dry-run flag must never mean "apply".
  assert.equal(
    (await q('select public.merge_products($1, $2, null) as result', [pid(5), pid(6)]))[0].result
      .status,
    'dry_run',
  );
  assert.equal(
    (
      await q(
        'select count(*)::int as n from public.merge_duplicate_products(null) where status = $1',
        ['merged'],
      )
    )[0].n,
    0,
  );
  assert.equal(await one('select count(*)::int from public.products where id = $1', [pid(6)]), 1);

  // Tabs and newlines at the edge of a store name must not trip the registry's own checks.
  assert.equal(
    await one(`select public.register_store_name(E'	Tab Laden
')`),
    'Tab Laden',
  );
  assert.equal(
    await one(`select public.canonical_store_name(E' 
 ')`),
    '',
  );
  await live.exec(`delete from public.store_name_registry where store_key = 'tab laden'`);

  // Re-running the rule finds nothing new: only the four skipped pairs remain.
  const remaining = await q(
    'select status, tier from public.merge_duplicate_products(true) order by 2',
  );
  assert.deepEqual(remaining, [
    { status: 'skipped_conflict', tier: 1 },
    { status: 'skipped_conflict', tier: 1 },
    { status: 'skipped_conflict', tier: 1 },
    { status: 'skipped_conflict', tier: 1 },
  ]);
  await live.exec(
    await migrationText('20261027120300_canonicalize_stores_and_merge_duplicates.sql'),
  );
  assert.deepEqual(await snapshotOf(), after, 'the data migration is idempotent');
  assert.equal(await one('select count(*)::int from public.product_merge_log'), 14);

  // ── 5. Write path: nothing can be written under a non-canonical spelling ──
  await live.exec(
    `insert into public.app_users (email) values ('${OWNER}') on conflict do nothing`,
  );
  await live.exec(`
    insert into public.products (id, name, store, store_product_code, category)
      values ('${ULID('NEWAL')}', 'Neu bei Aldi', 'aldi süd', '246810', 'Бакалія');
  `);
  assert.equal(
    await one(`select store from public.products where id = $1`, [ULID('NEWAL')]),
    'ALDI SÜD',
  );
  await expectFailure(
    live.exec(`insert into public.products (id, name, store, store_product_code, category)
               values ('${ULID('NEWAL2')}', 'Neu bei Aldi', 'ALDI SUED', '246810', 'Бакалія')`),
    /products_store_code_uniq/,
  );
  await expectFailure(
    live.exec(`insert into public.products (id, name, store, category)
               values ('${ULID('NEWNE')}', 'Quarki Quark FK 250g', 'netto marken-discount', 'Молочка')`),
    /products_store_name_nocode_uniq/,
  );
  await live.exec(`update public.products set store = 'Aldi' where id = '${ULID('NEWAL')}'`);
  assert.equal(
    await one(`select store from public.products where id = $1`, [ULID('NEWAL')]),
    'ALDI SÜD',
  );

  await live.exec(`
    insert into public.receipts (id, date, store, currency, total_orig, fx_rate_eur, total_eur, paid_by, source)
      values ('${ULID('RWRITE')}', '2026-10-01', 'Netto Marken-Discount', 'EUR', 5, 1, 5, '${OWNER}', 'manual');
  `);
  assert.deepEqual(
    (
      await q(`select store, store_printed from public.receipts where id = $1`, [ULID('RWRITE')])
    )[0],
    { store: 'Netto', store_printed: 'Netto Marken-Discount' },
  );
  await live.exec(`update public.receipts set note = 'x' where id = '${ULID('RWRITE')}'`);
  await live.exec(`update public.receipts set store = 'Netto' where id = '${ULID('RWRITE')}'`);
  assert.equal(
    await one(`select store_printed from public.receipts where id = $1`, [ULID('RWRITE')]),
    'Netto Marken-Discount',
    'saving the canonical name unchanged keeps what was printed',
  );
  await live.exec(
    `update public.receipts set store = 'EDEKA Musterstadt' where id = '${ULID('RWRITE')}'`,
  );
  assert.equal(
    await one(`select store_printed from public.receipts where id = $1`, [ULID('RWRITE')]),
    null,
  );

  // The browser's bundle save: a spelling variant lands on the canonical rows.
  const bundleReceipt = {
    id: ULID('RBUNDLE'),
    date: '2026-10-02',
    time: null,
    store: 'REWE Müller oHG',
    store_address: null,
    currency: 'EUR',
    total_orig: 1.99,
    fx_rate_eur: 1,
    total_eur: 1.99,
    paid_by: OWNER,
    photo_url: null,
    photo_path: null,
    merchant_order_id: null,
    source: 'manual',
    raw_ocr_json: null,
    note: null,
  };
  await live.query(
    'select public.save_receipt_bundle($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, false)',
    [
      JSON.stringify(bundleReceipt),
      JSON.stringify([
        {
          id: ULID('IBUNDLE'),
          price_id: ULID('PBUNDLE'),
          product_id: ULID('PBUNDLE1'),
          product_name: 'Neuer Artikel',
          raw_product_name: 'Neuer Artikel',
          category: 'Бакалія',
          qty: 1,
          unit_price_orig: 1.99,
          discount_orig: 0,
          total_orig: 1.99,
          total_eur: 1.99,
          consumed_by: 'shared',
        },
      ]),
      JSON.stringify([
        {
          id: ULID('PBUNDLE1'),
          name: 'Neuer Artikel',
          store: 'REWE Müller oHG',
          store_product_code: null,
          category: 'Бакалія',
        },
      ]),
      '[]',
      '[]',
    ],
  );
  assert.deepEqual(
    (
      await q(
        `select r.store as receipt_store, p.store as product_store
         from public.receipts r join public.items i on i.receipt_id = r.id
         join public.products p on p.id = i.product_id where r.id = $1`,
        [ULID('RBUNDLE')],
      )
    )[0],
    { receipt_store: 'REWE', product_store: 'REWE' },
  );

  // ── 6. The durable importers resolve to the canonical rows ─────────────────
  await live.exec(`
    insert into public.receipt_import_batches (id, paid_by) values ('${ULID('BATCH')}', '${OWNER}');
  `);
  let fileNumber = 0;
  async function startFile(manualJson = null) {
    const id = ULID(`FILE${++fileNumber}`);
    await live.query(
      `insert into public.receipt_import_files (id, batch_id, storage_path, manual_json, status)
       values ($1, $2, $3, $4::jsonb, 'processing')`,
      [
        id,
        ULID('BATCH'),
        manualJson ? null : `${OWNER}/${id}.jpg`,
        manualJson ? JSON.stringify(manualJson) : null,
      ],
    );
    return id;
  }
  const importReceipt = (number, store, overrides = {}) => ({
    id: ULID(`RIMP${number}`),
    date: '2026-10-20',
    time: null,
    store,
    store_address: null,
    currency: 'EUR',
    total_orig: 3.5,
    fx_rate_eur: 1,
    total_eur: 3.5,
    ...overrides,
  });
  const importItem = (number, overrides = {}) => ({
    id: ULID(`IIMP${number}`),
    price_id: ULID(`PIMP${number}`),
    product_candidate_id: ULID(`CIMP${number}`),
    product_name: 'Bio Knusperriegel',
    store_product_code: '111111',
    category: 'Солодке',
    qty: 1,
    unit_price_orig: 3.5,
    discount_orig: 0,
    total_orig: 3.5,
    total_eur: 3.5,
    price_net: 3.5,
    ...overrides,
  });
  const finalize = async (fn, fileId, receipt, items) =>
    (
      await live.query(`select public.${fn}($1, 1, $2::jsonb, $3::jsonb, '{}'::jsonb) as result`, [
        fileId,
        JSON.stringify(receipt),
        JSON.stringify(items),
      ])
    ).rows[0].result;

  // Photo import, store printed in another spelling: same product row, canonical receipt.
  const productsBeforeImport = Number(await one('select count(*) from public.products'));
  const imported = await finalize(
    'finalize_receipt_import',
    await startFile(),
    importReceipt(1, 'Aldi Süd'),
    [importItem(1)],
  );
  assert.equal(imported.status, 'saved');
  assert.equal(
    (
      await q(
        `select r.store as receipt_store, i.product_id from public.receipts r
         join public.items i on i.receipt_id = r.id where r.id = $1`,
        [ULID('RIMP1')],
      )
    )[0].receipt_store,
    'ALDI SÜD',
  );
  assert.equal(
    await one('select product_id from public.items where id = $1', [ULID('IIMP1')]),
    pid(1),
    'resolved to the surviving row, not a new duplicate',
  );
  assert.equal(Number(await one('select count(*) from public.products')), productsBeforeImport);

  // A new code-less product under one spelling is found again under the other.
  await finalize(
    'finalize_receipt_import',
    await startFile(),
    importReceipt(2, 'Netto Marken-Discount', { total_orig: 1.29, total_eur: 1.29 }),
    [
      importItem(2, {
        product_name: 'Frisch vom Netto',
        store_product_code: null,
        category: 'Бакалія',
        unit_price_orig: 1.29,
        total_orig: 1.29,
        total_eur: 1.29,
        price_net: 1.29,
      }),
    ],
  );
  await finalize(
    'finalize_receipt_import',
    await startFile(),
    importReceipt(3, 'Netto', { date: '2026-10-21', total_orig: 1.29, total_eur: 1.29 }),
    [
      importItem(3, {
        product_name: 'Frisch vom Netto',
        store_product_code: null,
        category: 'Бакалія',
        unit_price_orig: 1.29,
        total_orig: 1.29,
        total_eur: 1.29,
        price_net: 1.29,
      }),
    ],
  );
  assert.equal(
    await one(`select count(*)::int from public.products where name = 'Frisch vom Netto'`),
    1,
  );
  assert.equal(
    await one(`select store from public.products where name = 'Frisch vom Netto'`),
    'Netto',
  );

  // The same purchase under two spellings is one purchase: held for review, not saved twice.
  const first = await finalize(
    'finalize_receipt_import',
    await startFile(),
    importReceipt(4, 'Netto', { date: '2026-10-22', total_orig: 29.32, total_eur: 29.32 }),
    [
      importItem(4, {
        product_name: 'Wocheneinkauf',
        store_product_code: null,
        category: 'Бакалія',
        unit_price_orig: 29.32,
        total_orig: 29.32,
        total_eur: 29.32,
        price_net: 29.32,
      }),
    ],
  );
  assert.equal(first.status, 'saved');
  const second = await finalize(
    'finalize_receipt_import',
    await startFile(),
    importReceipt(5, 'Netto Marken-Discount', {
      date: '2026-10-22',
      total_orig: 29.32,
      total_eur: 29.32,
    }),
    [
      importItem(5, {
        product_name: 'Wocheneinkauf',
        store_product_code: null,
        category: 'Бакалія',
        unit_price_orig: 29.32,
        total_orig: 29.32,
        total_eur: 29.32,
        price_net: 29.32,
      }),
    ],
  );
  assert.deepEqual(second, { status: 'needs_review', duplicate_receipt_id: ULID('RIMP4') });
  assert.equal(
    await one(`select count(*)::int from public.receipts where id = $1`, [ULID('RIMP5')]),
    0,
  );

  // Pasted JSON (and the Amazon order id guard) behave the same way.
  const pastedOne = await finalize(
    'finalize_pasted_json_import',
    await startFile({ any: 'json' }),
    importReceipt(6, 'Amazon.de', {
      date: '2026-10-23',
      merchant_order_id: '028-1111111-2222222',
      total_orig: 9,
      total_eur: 9,
    }),
    [
      importItem(6, {
        product_name: 'Buch',
        store_product_code: null,
        category: 'Інше',
        unit_price_orig: 9,
        total_orig: 9,
        total_eur: 9,
        price_net: 9,
      }),
    ],
  );
  assert.equal(pastedOne.status, 'saved');
  const pastedTwo = await finalize(
    'finalize_pasted_json_import',
    await startFile({ any: 'json' }),
    importReceipt(7, 'AMAZON.DE', {
      date: '2026-10-23',
      merchant_order_id: '028-1111111-2222222',
      total_orig: 9,
      total_eur: 9,
    }),
    [
      importItem(7, {
        product_name: 'Buch',
        store_product_code: null,
        category: 'Інше',
        unit_price_orig: 9,
        total_orig: 9,
        total_eur: 9,
        price_net: 9,
      }),
    ],
  );
  assert.equal(pastedTwo.status, 'saved');
  assert.equal(pastedTwo.auto_duplicate, true);
  assert.equal(pastedTwo.receipt_id, ULID('RIMP6'));
  const pastedThree = await finalize(
    'finalize_pasted_json_import',
    await startFile({ any: 'json' }),
    importReceipt(8, 'Netto Marken-Discount', {
      date: '2026-10-22',
      total_orig: 29.32,
      total_eur: 29.32,
    }),
    [
      importItem(8, {
        product_name: 'Wocheneinkauf',
        store_product_code: null,
        category: 'Бакалія',
        unit_price_orig: 29.32,
        total_orig: 29.32,
        total_eur: 29.32,
        price_net: 29.32,
      }),
    ],
  );
  assert.deepEqual(pastedThree, { status: 'needs_review', duplicate_receipt_id: ULID('RIMP4') });

  // ── 7. The queue hint ─────────────────────────────────────────────────────
  const queue = await q(
    `select product_id, store, purchases_count, group_purchases_count, other_store_purchases_count
       from public.search_packaging_candidates('', null, null, null, null, 500, 0, null)`,
  );
  const byId = new Map(queue.map((row) => [row.product_id, row]));

  // Same chain under two spellings (a skipped pair): the old hint fired, the new one does not.
  for (const n of [5, 6]) {
    const row = byId.get(pid(n));
    assert.ok(row, `product ${n} is in the queue`);
    assert.ok(row.group_purchases_count > row.purchases_count, 'the old condition would fire');
    assert.equal(row.other_store_purchases_count, 0, `product ${n}: same canonical store`);
  }
  // Another code of the same article in the same store: no hint either.
  for (const n of [24, 25]) assert.equal(byId.get(pid(n)).other_store_purchases_count, 0);
  // The same private-label product in two different stores: the hint is right.
  assert.equal(byId.get(pid(42)).other_store_purchases_count, 1);
  assert.equal(byId.get(pid(43)).other_store_purchases_count, 1);
  assert.equal(byId.get(pid(42)).group_purchases_count, 2);
  // The Pfand rule and the recency window of the queue still hold.
  assert.equal(byId.has(pid(22)), false);
  assert.equal(byId.has(pid(44)), false);
  const recent = await q(
    `select count(*)::int as n from public.search_packaging_candidates('', null, null, null, null, 500, 0, '2026-10-01')`,
  );
  assert.ok(recent[0].n < queue.length);
  const summary = await q(`select * from public.packaging_queue_summary('', '2026-10-01')`);
  assert.equal(summary[0].total_count, queue.length);
  assert.equal(summary[0].recent_count, recent[0].n);

  console.log('canonical stores SQL tests passed');
} finally {
  await db.close();
}

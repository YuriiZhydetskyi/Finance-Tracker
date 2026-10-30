import assert from 'node:assert/strict';
import {
  applyCanonicalStoresMigrations,
  createPreDeployDatabase,
  migrationText,
  scalar,
} from './lib/pglite-app-schema.mjs';
import {
  PP,
  iid,
  loadDuplicateProductsFixture,
  pid,
  rid,
} from './lib/duplicate-products-fixture.mjs';

const database = await createPreDeployDatabase();
const { db } = database;
await loadDuplicateProductsFixture(db);

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = (sql, params = []) => scalar(db, sql, params);
const reason = (category, name, positive, fractional) =>
  one('select public.packaging_exclusion_reason($1, $2, $3, $4)', [
    category,
    name,
    positive,
    fractional,
  ]);

async function expectFailure(promise, expected) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message), expected);
    return true;
  });
}

try {
  // ── 1. The rule on its own ────────────────────────────────────────────────
  await applyCanonicalStoresMigrations(database, {
    upTo: '20261027120400_canonical_store_write_path.sql',
  });
  // The functions live in the next migration; create them without its apply step.
  const source = await migrationText('20261027120500_packaging_exclusion_rule.sql');
  await db.exec(source.slice(0, source.indexOf('-- ── Apply it once')));
  // The produce-bag pattern, the split queue view and the card-wins trigger replace parts of it.
  const linkableSource = await migrationText('20261030100000_flagged_packaging_rows_linkable.sql');
  await db.exec(linkableSource.slice(0, linkableSource.indexOf('-- ── Apply it once')));

  const cases = [
    // category decides: nothing to photograph
    ['Авто', 'Super SB', 3, 3, 'service'],
    ['Кафе/ресторани', 'Cappuccino', 1, 0, 'service'],
    ['Підписки', 'Streaming', 1, 0, 'service'],
    ['Одяг', 'T-Shirt', 1, 0, 'non_food'],
    ['Електроніка', 'Kabel', 1, 0, 'non_food'],
    // carrier and produce bags, by name
    ['Інше', 'Tragetasche', 1, 0, 'bag'],
    ['Інше', 'Papiertragetasche', 1, 0, 'bag'],
    ['Інше', 'Gewebetasche', 1, 0, 'bag'],
    ['Інше', 'Obstknotenbeutel', 1, 0, 'bag'],
    ['Хімія/гігієна', 'Müllbeutel 50L', 1, 0, null],
    // weighed: at least half of the purchases have a fractional quantity
    ['Овочі/фрукти', 'Bananen', 2, 2, 'weighed'],
    ['Бакалія', 'Halb gewogen', 4, 2, 'weighed'],
    ['Бакалія', 'Selten gewogen', 3, 1, null],
    // weighed, pre-packed meat and fish still get a card (barcode null)
    ['М’ясо/риба', 'Schweinefilet', 2, 2, null],
    ["М'ясо/риба", 'Lachsfilet', 3, 3, null],
    // loose produce is sold by weight (a non-round quantity) and is flagged as weighed...
    ['Овочі/фрукти', 'Äpfel lose', 3, 2, 'weighed'],
    // ...while a whole quantity (no multiplication, or by an integer) is a pack: a bag
    // or a net rung up as 1 x price. Nothing in the name changes that, so it stays
    ['Овочі/фрукти', 'Kaki St.', 2, 0, null],
    ['Овочі/фрукти', 'Avocado Stk', 3, 0, null],
    ['Овочі/фрукти', 'Paprika rot', 4, 0, null],
    ['Овочі/фрукти', 'Kartoffeln', 2, 0, null],
    ['Овочі/фрукти', 'Apfel Pink Lady', 3, 0, null],
    ['Овочі/фрукти', 'Karotten 1kg', 5, 0, null],
    // weighed meat and fish are packaged whatever the quantity
    ['М’ясо/риба', 'Hähnchenbrust', 3, 3, null],
    // never bought: no evidence
    ['Овочі/фрукти', 'Nie gekauft Birne', 0, 0, null],
    // the till's produce bag
    ['Інше', '2 Cent OuG Beutel', 1, 0, 'bag'],
    // packaged goods, household and pharmacy do have a package
    ['Молочка', 'Joghurt', 4, 0, null],
    ['Хімія/гігієна', 'Duschgel', 2, 0, null],
    ['Аптека', 'Magnesium', 1, 0, null],
    // a row never bought has no weighed evidence
    ['Бакалія', 'Nie gekauft', 0, 0, null],
  ];
  for (const [category, name, positive, fractional, expected] of cases) {
    assert.equal(
      await reason(category, name, positive, fractional),
      expected,
      `${category} / ${name}`,
    );
  }

  // ── 2. Dry run, apply, idempotence ───────────────────────────────────────
  const flaggedBefore = Number(
    await one('select count(*) from public.products where packaging_not_applicable'),
  );
  assert.equal(
    flaggedBefore,
    2,
    'the fixture has two rows flagged by hand (87, and 20 of a skipped pair)',
  );

  const preview = await q(
    'select product_id, reason from public.apply_packaging_exclusion_rule() order by product_id',
  );
  // The duplicate pairs are already merged by the data migration, so each survivor appears once.
  const expected = [
    [pid(34), 'bag'],
    [pid(80), 'bag'],
    [pid(3), 'weighed'],
    [pid(81), 'weighed'],
    [pid(85), 'weighed'],
    [pid(60), 'service'],
    [pid(70), 'service'],
    [pid(71), 'service'],
    [pid(84), 'non_food'],
  ]
    .map(([product_id, why]) => ({ product_id, reason: why }))
    .sort((a, b) => (a.product_id < b.product_id ? -1 : 1));
  assert.deepEqual(preview, expected);
  assert.equal(
    Number(await one('select count(*) from public.products where packaging_not_applicable')),
    flaggedBefore,
    'a dry run (the default) writes nothing',
  );

  const applied = await q(
    'select product_id, reason from public.apply_packaging_exclusion_rule(false) order by product_id',
  );
  assert.deepEqual(applied, expected);
  assert.deepEqual(
    await q(`select id, packaging_not_applicable_reason as reason from public.products
              where packaging_not_applicable_reason is not null order by id`),
    expected.map(({ product_id, reason: why }) => ({ id: product_id, reason: why })),
  );
  assert.equal(
    await one('select count(*)::int from public.apply_packaging_exclusion_rule(false)'),
    0,
    'a second run flags nothing',
  );

  // Not flagged, on purpose.
  const untouched = {
    'whole-quantity produce': pid(82),
    'household goods': pid(83),
    'a seldom weighed row': pid(86),
    'deposit rows': pid(22),
    'deposit rows by name': pid(44),
    'a row linked to a card': pid(88),
    'weighed meat': pid(89),
  };
  for (const [label, id] of Object.entries(untouched)) {
    assert.equal(
      await one('select packaging_not_applicable from public.products where id = $1', [id]),
      false,
      label,
    );
  }
  // The hand-flagged row keeps its flag and gains no reason.
  assert.deepEqual(
    (
      await q(
        'select packaging_not_applicable as na, packaging_not_applicable_reason as why from public.products where id = $1',
        [pid(87)],
      )
    )[0],
    { na: true, why: null },
  );

  // ── 3. Flagged rows leave the queue, and the flag is reversible ───────────
  const inQueue = async () =>
    new Set((await q('select id from public.v_packaging_queue_products')).map((r) => r.id));
  const queueAfter = await inQueue();
  for (const { product_id } of expected) assert.equal(queueAfter.has(product_id), false);
  assert.equal(queueAfter.has(pid(82)), true, 'whole-quantity produce is still in the queue');
  assert.equal(queueAfter.has(pid(83)), true);

  // «Повернути в чергу» only flips the boolean (useSkipPackagingMutation); the
  // reason follows it, and the rows are back.
  await db.exec(
    `update public.products set packaging_not_applicable = false where id = '${pid(3)}'`,
  );
  assert.deepEqual(
    (
      await q(
        'select packaging_not_applicable as na, packaging_not_applicable_reason as why from public.products where id = $1',
        [pid(3)],
      )
    )[0],
    { na: false, why: null },
  );
  assert.equal((await inQueue()).has(pid(3)), true);
  // Undoing a whole rule is one statement.
  await db.exec(`update public.products set packaging_not_applicable = false
                  where packaging_not_applicable_reason = 'weighed'`);
  for (const id of [pid(81), pid(85)]) assert.equal((await inQueue()).has(id), true);
  assert.equal(
    await one(
      `select count(*)::int from public.products where packaging_not_applicable_reason = 'weighed'`,
    ),
    0,
  );
  // ...and the rule can be applied again: it is a function of the data, not a one-off.
  assert.equal(
    await one('select count(*)::int from public.apply_packaging_exclusion_rule(false)'),
    3,
  );

  // ── 4. A flagged row stays linkable; a card wins over the flag ────────────
  // pid(81), the weighed bananas, is flagged by the rule above.
  const flaggedId = pid(81);
  assert.equal(
    await one('select packaging_not_applicable_reason from public.products where id = $1', [
      flaggedId,
    ]),
    'weighed',
  );

  const candidateIds = async (includeFlagged) =>
    (
      await q(
        'select product_id from public.search_packaging_candidates($1, null, null, null, null, 100, 0, null, $2)',
        ['bananen', includeFlagged],
      )
    ).map((r) => r.product_id);
  assert.deepEqual(await candidateIds(false), [], 'the queue does not list it');
  assert.deepEqual(await candidateIds(true), [flaggedId], 'the import review still finds it');
  assert.deepEqual(
    await q(`select product_id from public.search_packaging_candidates('bananen')`),
    [],
    'the default call is the queue',
  );
  assert.equal(
    await one(`select total_count::int from public.packaging_queue_summary('bananen', null)`),
    0,
    'the count and the badge leave it out too',
  );
  assert.equal(
    Number(
      await one('select count(*) from public.v_packaging_link_targets where id = $1', [flaggedId]),
    ),
    1,
  );

  const flagState = async (id) =>
    (
      await q(
        'select packaging_not_applicable as na, packaging_not_applicable_reason as why, packaged_product_id as card from public.products where id = $1',
        [id],
      )
    )[0];
  // A tag card linked to the flagged row clears both the flag and its reason.
  await db.exec(
    `update public.products set packaged_product_id = '${PP.one}' where id = '${flaggedId}'`,
  );
  assert.deepEqual(await flagState(flaggedId), { na: false, why: null, card: PP.one });
  assert.deepEqual(await candidateIds(true), [], 'a linked row is no longer a candidate');

  // Same for a row flagged by hand (no reason), and for a row created with a card.
  await db.exec(`update public.products set packaged_product_id = null where id = '${flaggedId}'`);
  await db.exec(
    `update public.products set packaging_not_applicable = true where id = '${flaggedId}'`,
  );
  assert.deepEqual(await flagState(flaggedId), { na: true, why: null, card: null });
  await db.exec(
    `update public.products set packaged_product_id = '${PP.two}' where id = '${flaggedId}'`,
  );
  assert.deepEqual(await flagState(flaggedId), { na: false, why: null, card: PP.two });
  await db.exec(`
    insert into public.products (id, name, category, store, packaged_product_id, packaging_not_applicable)
      values ('${pid(901)}', 'Mango St', 'Овочі/фрукти', 'REWE', '${PP.three}', true)`);
  assert.deepEqual(await flagState(pid(901)), { na: false, why: null, card: PP.three });

  // A reason without the flag is not representable.
  await expectFailure(
    db.exec(
      `update public.products set packaging_not_applicable_reason = 'weighed' where id = '${pid(83)}'`,
    ),
    /products_na_reason_requires_flag/,
  );

  // ── 5. The whole migration, as the deploy runs it ─────────────────────────
  const deploy = await createPreDeployDatabase();
  try {
    await loadDuplicateProductsFixture(deploy.db);
    await applyCanonicalStoresMigrations(deploy);
    const bagId = pid(902);
    await deploy.db.exec(`
      insert into public.products (id, name, category, store)
        values ('${bagId}', '2 Cent OuG Beutel', 'Інше', 'Kaufland');
      insert into public.items (id, receipt_id, product_id, product_name, raw_product_name, category,
                                qty, unit_price_orig, discount_orig, total_orig, total_eur, consumed_by)
        values ('${iid(902)}', '${rid(13)}', '${bagId}', '2 Cent OuG Beutel', '2 Cent OuG Beutel',
                'Інше', 1, 0.02, 0, 0.02, 0.02, 'shared');
    `);
    await deploy.db.exec(linkableSource, { onNotice: deploy.onNotice });
    const summary = deploy.notices.find((line) => line.includes('newly flagged'));
    assert.match(
      summary ?? '',
      /1 row\(s\) newly flagged.*3 bag/,
      'the produce bag is flagged; whole-quantity produce of the fixture is not',
    );
    assert.equal(
      Number(
        (await deploy.db.query('select count(*) from public.apply_packaging_exclusion_rule(true)'))
          .rows[0].count,
      ),
      0,
      'a second run flags nothing',
    );
    assert.equal(
      Number(
        (
          await deploy.db.query(
            `select count(*) from public.search_packaging_candidates('ouG beutel', null, null, null, null, 100, 0, null, true)`,
          )
        ).rows[0].count,
      ),
      1,
      'the flagged row is still listed for the import review',
    );
  } finally {
    await deploy.db.close();
  }

  console.log('packaging exclusion SQL tests passed');
} finally {
  await db.close();
}

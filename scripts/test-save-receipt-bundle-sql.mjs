import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const readMigration = (name) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

const db = new PGlite();

const ULID = (suffix) => suffix.padStart(26, '0');
const RECEIPT_ID = ULID('R1');
const priceIdFor = (itemId) => `P${itemId.slice(1)}`;

function receipt(overrides = {}) {
  return {
    id: RECEIPT_ID,
    date: '2026-09-20',
    time: '10:15:00',
    store: 'REWE',
    store_address: null,
    currency: 'EUR',
    total_orig: 4.48,
    fx_rate_eur: 1,
    total_eur: 4.48,
    paid_by: 'a@example.com',
    photo_url: null,
    photo_path: null,
    merchant_order_id: null,
    source: 'manual',
    raw_ocr_json: null,
    note: null,
    created_at: '2026-09-20T10:15:00.000Z',
    updated_at: '2026-09-20T10:15:00.000Z',
    ...overrides,
  };
}

function item(id, overrides = {}) {
  return {
    id,
    price_id: priceIdFor(id),
    receipt_id: RECEIPT_ID,
    product_id: null,
    product_family_id: null,
    product_variant_id: null,
    product_name: 'Milch',
    raw_product_name: 'Milch',
    store_product_code: null,
    product_url: null,
    product_image_url: null,
    category: 'Інше',
    qty: 1,
    unit_price_orig: 1.49,
    discount_orig: 0,
    total_orig: 1.49,
    total_eur: 1.49,
    consumed_by: 'shared',
    note: null,
    wasted_qty: 0,
    wasted_at: null,
    created_at: '2026-09-20T10:15:00.000Z',
    updated_at: '2026-09-20T10:15:00.000Z',
    ...overrides,
  };
}

async function saveBundle({
  receipt: r,
  items,
  newProducts = [],
  backfills = [],
  enrichments = [],
  replace = false,
}) {
  const result = await db.query(
    'select public.save_receipt_bundle($1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6) as result',
    [
      JSON.stringify(r),
      JSON.stringify(items),
      JSON.stringify(newProducts),
      JSON.stringify(backfills),
      JSON.stringify(enrichments),
      replace,
    ],
  );
  return result.rows[0].result;
}

async function scalar(sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0])[0];
}

try {
  // Real migrations where they run on PGlite; hand-written DDL only for the
  // pieces that need Supabase-only extensions (pgmq, unaccent).
  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  `);
  await db.exec(await readMigration('20260507000001_initial_schema.sql'));
  await db.exec(await readMigration('20260510000001_product_codes_and_prices.sql'));
  await db.exec(await readMigration('20260517000001_add_store_address_and_time.sql'));
  await db.exec(await readMigration('20260518000002_waste_tracking.sql'));
  await db.exec(await readMigration('20260531000001_add_manual_json_source.sql'));
  await db.exec(await readMigration('20260606000001_add_statement_source.sql'));
  // 20260831054319_background_receipt_imports.sql needs pgmq/pg_cron; only its
  // receipts column matters here.
  await db.exec('alter table public.receipts add column photo_path text;');
  await db.exec(await readMigration('20260905130900_add_amazon_order_metadata.sql'));

  // Taxonomy: tables + columns mirrored from 20260907202419; the item trigger
  // function is sliced verbatim from that migration so ordering is real.
  const taxonomy = await readMigration('20260907202419_multilingual_product_taxonomy.sql');
  const triggerStart = taxonomy.indexOf('create function public.inherit_item_product_taxonomy()');
  const triggerEnd = taxonomy.indexOf('-- Keep matching language-neutral');
  assert.ok(triggerStart > 0 && triggerEnd > triggerStart, 'taxonomy trigger block not found');
  await db.exec(`
    create table public.product_families (id text primary key);
    create table public.product_variants (
      id text primary key,
      family_id text not null references public.product_families(id),
      unique (id, family_id)
    );
    alter table public.products
      add column product_family_id text references public.product_families(id),
      add column product_variant_id text,
      add column brand text check (brand is null or btrim(brand) <> ''),
      add column is_organic boolean,
      add constraint products_variant_requires_family
        check (product_variant_id is null or product_family_id is not null),
      add constraint products_variant_family_fkey
        foreign key (product_variant_id, product_family_id)
        references public.product_variants(id, family_id);
    alter table public.items
      add column product_family_id text references public.product_families(id),
      add column product_variant_id text,
      add constraint items_variant_requires_family
        check (product_variant_id is null or product_family_id is not null),
      add constraint items_variant_family_fkey
        foreign key (product_variant_id, product_family_id)
        references public.product_variants(id, family_id);
  `);
  await db.exec(taxonomy.slice(triggerStart, triggerEnd));
  await db.exec(await readMigration('20260908160458_purchase_correction_rules.sql'));
  await db.exec(await readMigration('20260922100000_save_receipt_bundle.sql'));
  await db.exec(await readMigration('20260922100001_apply_product_match_rule_single_lookup.sql'));

  await db.exec(`
    insert into public.categories (name, group_name) values ('Інше', 'Інше'), ('Молочне', 'Продукти')
      on conflict do nothing;
    insert into public.product_families values ('milk'), ('butter');
    insert into public.product_variants values ('whole_milk', 'milk');
    insert into public.products (id, name, store, category, product_family_id, product_variant_id, brand, is_organic)
      values ('${ULID('PRODMILK')}', 'Milch', 'REWE', 'Молочне', 'milk', 'whole_milk', 'Weihenstephan', true);
  `);

  const grants = await db.query(`
    select has_function_privilege('authenticated', 'public.save_receipt_bundle(jsonb, jsonb, jsonb, jsonb, jsonb, boolean)', 'execute') as authenticated,
           has_function_privilege('anon', 'public.save_receipt_bundle(jsonb, jsonb, jsonb, jsonb, jsonb, boolean)', 'execute') as anon
  `);
  assert.deepEqual(grants.rows[0], { authenticated: true, anon: false });

  // 1. insert: one linked item + one unlinked item -> one price snapshot, net = orig - discount.
  const inserted = await saveBundle({
    receipt: receipt(),
    items: [
      item(ULID('I1'), {
        product_id: ULID('PRODMILK'),
        unit_price_orig: 1.49,
        discount_orig: 0.3,
        total_orig: 1.19,
        total_eur: 1.19,
      }),
      item(ULID('I2'), { product_name: 'Tüte', raw_product_name: 'Tüte', unit_price_orig: 0.2 }),
    ],
  });
  assert.deepEqual(inserted, { receipt_id: RECEIPT_ID, items_count: 2 });
  const prices = await db.query(
    'select product_id, price_orig::text, price_net::text, currency, date::text from public.product_prices where receipt_id = $1',
    [RECEIPT_ID],
  );
  assert.deepEqual(prices.rows, [
    {
      product_id: ULID('PRODMILK'),
      price_orig: '1.49',
      price_net: '1.19',
      currency: 'EUR',
      date: '2026-09-20',
    },
  ]);
  const inheritedTaxonomy = await db.query(
    'select product_family_id, product_variant_id from public.items where id = $1',
    [ULID('I1')],
  );
  assert.deepEqual(
    inheritedTaxonomy.rows[0],
    { product_family_id: 'milk', product_variant_id: 'whole_milk' },
    'item insert trigger should still inherit taxonomy from the linked product',
  );

  // 2. replace: same receipt id, one new item -> exactly one item, old snapshots gone.
  const replaced = await saveBundle({
    receipt: receipt({ store: 'REWE City', source: 'edit', total_orig: 0.99, total_eur: 0.99 }),
    items: [
      item(ULID('I3'), {
        product_id: ULID('PRODMILK'),
        product_name: 'Milch 3.5%',
        raw_product_name: 'Milch 3.5%',
        unit_price_orig: 0.99,
        total_orig: 0.99,
        total_eur: 0.99,
      }),
    ],
    replace: true,
  });
  assert.deepEqual(replaced, { receipt_id: RECEIPT_ID, items_count: 1 });
  assert.equal(
    await scalar('select count(*)::int from public.items where receipt_id = $1', [RECEIPT_ID]),
    1,
  );
  assert.equal(
    await scalar('select id from public.items where receipt_id = $1', [RECEIPT_ID]),
    ULID('I3'),
  );
  const replacedPrices = await db.query(
    'select id, price_orig::text from public.product_prices where receipt_id = $1',
    [RECEIPT_ID],
  );
  assert.deepEqual(replacedPrices.rows, [{ id: priceIdFor(ULID('I3')), price_orig: '0.99' }]);
  const replacedReceipt = await db.query(
    'select store, source::text, total_orig::text from public.receipts where id = $1',
    [RECEIPT_ID],
  );
  assert.deepEqual(replacedReceipt.rows[0], {
    store: 'REWE City',
    source: 'edit',
    total_orig: '0.99',
  });

  // 3. insert atomicity: second item references a missing product -> nothing persists.
  const atomicReceiptId = ULID('R2');
  await assert.rejects(
    saveBundle({
      receipt: receipt({ id: atomicReceiptId }),
      items: [
        item(ULID('I4'), { receipt_id: atomicReceiptId, product_id: ULID('PRODMILK') }),
        item(ULID('I5'), { receipt_id: atomicReceiptId, product_id: ULID('MISSING') }),
      ],
      newProducts: [
        {
          id: ULID('PRODNEW'),
          name: 'Butter',
          store: 'REWE',
          store_product_code: null,
          category: 'Молочне',
          unit: null,
          unit_size: null,
          notes: null,
          product_family_id: null,
          product_variant_id: null,
          brand: null,
          is_organic: null,
        },
      ],
    }),
    /foreign key/i,
  );
  assert.equal(
    await scalar('select count(*)::int from public.receipts where id = $1', [atomicReceiptId]),
    0,
  );
  assert.equal(
    await scalar('select count(*)::int from public.items where receipt_id = $1', [atomicReceiptId]),
    0,
  );
  assert.equal(
    await scalar('select count(*)::int from public.products where id = $1', [ULID('PRODNEW')]),
    0,
    'product created in a failed bundle must roll back too',
  );

  // 4. replace atomicity: the same failure leaves the previous items and snapshots in place.
  await assert.rejects(
    saveBundle({
      receipt: receipt({ source: 'edit', store: 'Broken' }),
      items: [
        item(ULID('I6'), { product_id: ULID('PRODMILK') }),
        item(ULID('I7'), { product_id: ULID('MISSING') }),
      ],
      replace: true,
    }),
    /foreign key/i,
  );
  const survivors = await db.query('select id from public.items where receipt_id = $1', [
    RECEIPT_ID,
  ]);
  assert.deepEqual(survivors.rows, [{ id: ULID('I3') }]);
  assert.equal(
    await scalar('select count(*)::int from public.product_prices where receipt_id = $1', [
      RECEIPT_ID,
    ]),
    1,
  );
  assert.equal(
    await scalar('select store from public.receipts where id = $1', [RECEIPT_ID]),
    'REWE City',
  );

  // 5. enrichment: explicit null clears; an absent key keeps the value.
  const enrichReceiptId = ULID('R3');
  await saveBundle({
    receipt: receipt({ id: enrichReceiptId }),
    items: [item(ULID('I8'), { receipt_id: enrichReceiptId, product_id: ULID('PRODMILK') })],
    enrichments: [{ id: ULID('PRODMILK'), brand: null, is_organic: false }],
  });
  const enriched = await db.query(
    'select brand, is_organic, product_family_id, product_variant_id from public.products where id = $1',
    [ULID('PRODMILK')],
  );
  assert.deepEqual(enriched.rows[0], {
    brand: null,
    is_organic: false,
    product_family_id: 'milk',
    product_variant_id: 'whole_milk',
  });

  // 6. backfill: store_product_code is set on the existing code-less product.
  await db.exec(`
    insert into public.products (id, name, store, category)
      values ('${ULID('PRODBUTTER')}', 'Butter', 'REWE', 'Молочне');
  `);
  const backfillReceiptId = ULID('R4');
  await saveBundle({
    receipt: receipt({ id: backfillReceiptId }),
    items: [
      item(ULID('I9'), {
        receipt_id: backfillReceiptId,
        product_id: ULID('PRODBUTTER'),
        product_name: 'Butter',
        raw_product_name: 'Butter',
        store_product_code: '297855',
      }),
    ],
    backfills: [{ id: ULID('PRODBUTTER'), store_product_code: '297855' }],
  });
  assert.equal(
    await scalar('select store_product_code from public.products where id = $1', [
      ULID('PRODBUTTER'),
    ]),
    '297855',
  );

  // 7. new products + match-rule trigger: the snapshot follows the post-trigger product_id.
  await db.exec(`
    insert into public.product_match_rules (store_key, raw_product_name_key, product_id, product_name, category)
      values ('rewe', 'bio butter', '${ULID('PRODBUTTER')}', 'Butter', 'Молочне');
  `);
  const ruleReceiptId = ULID('R5');
  await saveBundle({
    receipt: receipt({ id: ruleReceiptId }),
    items: [
      item(ULID('IA'), {
        receipt_id: ruleReceiptId,
        product_id: ULID('PRODBIO'),
        product_name: 'Bio Butter',
        raw_product_name: 'Bio Butter',
        unit_price_orig: 2.49,
      }),
    ],
    newProducts: [
      {
        id: ULID('PRODBIO'),
        name: 'Bio Butter',
        store: 'REWE',
        store_product_code: null,
        category: 'Молочне',
        unit: null,
        unit_size: null,
        notes: null,
        product_family_id: 'butter',
        product_variant_id: null,
        brand: null,
        is_organic: true,
      },
    ],
  });
  assert.equal(
    await scalar('select count(*)::int from public.products where id = $1', [ULID('PRODBIO')]),
    1,
  );
  assert.equal(
    await scalar('select product_id from public.items where id = $1', [ULID('IA')]),
    ULID('PRODBUTTER'),
  );
  assert.equal(
    await scalar('select product_id from public.product_prices where receipt_id = $1', [
      ruleReceiptId,
    ]),
    ULID('PRODBUTTER'),
  );

  // 8. replace ordering: the receipt becomes 'edit' before items are inserted,
  //    so the match rule must not override the human classification.
  await saveBundle({
    receipt: receipt({ id: ruleReceiptId, source: 'edit' }),
    items: [
      item(ULID('IB'), {
        receipt_id: ruleReceiptId,
        product_id: ULID('PRODBIO'),
        product_name: 'Bio Butter',
        raw_product_name: 'Bio Butter',
        unit_price_orig: 2.49,
      }),
    ],
    replace: true,
  });
  assert.equal(
    await scalar('select product_id from public.items where id = $1', [ULID('IB')]),
    ULID('PRODBIO'),
  );
  assert.equal(
    await scalar('select product_id from public.product_prices where receipt_id = $1', [
      ruleReceiptId,
    ]),
    ULID('PRODBIO'),
  );

  // Replace of an unknown receipt fails instead of silently inserting items.
  await assert.rejects(
    saveBundle({ receipt: receipt({ id: ULID('NOPE') }), items: [], replace: true }),
    /not found/,
  );

  console.log('save_receipt_bundle SQL tests passed');
} finally {
  await db.close();
}

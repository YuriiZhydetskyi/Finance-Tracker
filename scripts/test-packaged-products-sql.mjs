import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();

async function expectFailure(sql, expected) {
  await assert.rejects(
    () => db.exec(sql),
    (error) => {
      assert.match(String(error.message), expected);
      return true;
    },
  );
}

try {
  await db.exec(`
    create schema auth;
    create role anon;
    create role authenticated;
    create role service_role;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;

    create table public.categories (name text primary key);
    insert into public.categories values ('Інше'), ('Снеки'), ('Овочі/фрукти'), ('Pfand');

    create table public.product_families (id text primary key);
    insert into public.product_families values ('chips'), ('tomatoes');

    create table public.product_variants (
      id text primary key,
      family_id text not null references public.product_families(id),
      unique (id, family_id)
    );
    insert into public.product_variants values ('potato_chips', 'chips');

    create type public.product_unit as enum ('pcs', 'g', 'kg', 'ml', 'l');

    create table public.products (
      id text primary key,
      name text not null,
      store text not null,
      store_product_code text,
      category text not null references public.categories(name),
      brand text,
      is_organic boolean,
      product_family_id text references public.product_families(id),
      product_variant_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      foreign key (product_variant_id, product_family_id)
        references public.product_variants(id, family_id)
    );

    create table public.receipts (
      id text primary key,
      store text not null,
      date date not null
    );

    create table public.items (
      id text primary key,
      receipt_id text not null references public.receipts(id),
      product_id text references public.products(id),
      product_name text not null,
      raw_product_name text not null,
      category text not null references public.categories(name),
      qty numeric not null,
      total_orig numeric not null,
      total_eur numeric not null
    );

    create table public.product_prices (
      id text primary key,
      product_id text not null references public.products(id),
      receipt_id text not null references public.receipts(id),
      price_orig numeric not null,
      price_net numeric not null,
      currency text not null,
      date date not null,
      created_at timestamptz not null default now()
    );

    create function public.set_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at = now(); return new; end; $$;
    create function public.is_allowed_user() returns boolean language sql stable as $$ select true $$;
    create function public.normalize_product_search(p_value text) returns text language sql stable as $$
      select btrim(regexp_replace(lower(coalesce(p_value, '')), '[[:space:].,;:/()\\[\\]{}+!?"''’–—-]+', ' ', 'g'))
    $$;
  `);

  for (const file of [
    '20260912072149_packaged_products.sql',
    '20260912072151_packaging_queue_functions.sql',
    '20261026190000_packaged_product_review_notes.sql',
    '20261027090000_packaging_queue_deposits_and_recency.sql',
  ]) {
    await db.exec(
      await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'),
    );
  }

  // ── RLS is on and the allowlist policy exists ────────────────────────────
  const rls = await db.query(`
    select c.relname, c.relrowsecurity, exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = c.relname
        and policyname = 'allowlist_all_' || c.relname
    ) as has_allowlist_policy
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('packaged_products', 'packaged_product_photos')
    order by c.relname
  `);
  assert.deepEqual(rls.rows, [
    { relname: 'packaged_product_photos', relrowsecurity: true, has_allowlist_policy: true },
    { relname: 'packaged_products', relrowsecurity: true, has_allowlist_policy: true },
  ]);

  // ── Barcode: nullable, unique only among non-null ────────────────────────
  await db.exec(`
    insert into public.packaged_products (id, name, category, barcode)
      values ('pp-pringles', 'Pringles Original 165 г', 'Снеки', '5053990101658');
    insert into public.packaged_products (id, name, category)
      values ('pp-nobarcode-a', 'Безіменний товар А', 'Інше');
    insert into public.packaged_products (id, name, category)
      values ('pp-nobarcode-b', 'Безіменний товар Б', 'Інше');
  `);

  await expectFailure(
    `insert into public.packaged_products (id, name, category, barcode)
       values ('pp-dupe', 'Інша назва', 'Снеки', '5053990101658')`,
    /packaged_products_barcode_uniq/,
  );

  // Without a barcode the normalized name is the identity.
  await expectFailure(
    `insert into public.packaged_products (id, name, category)
       values ('pp-dupe-name', '  безіменний товар а  ', 'Інше')`,
    /packaged_products_name_nobarcode_uniq/,
  );

  await expectFailure(
    `insert into public.packaged_products (id, name, category, barcode)
       values ('pp-bad-barcode', 'Кривий код', 'Інше', '50 5399')`,
    /packaged_products_barcode_check/,
  );

  // ── Nutrition constraints ────────────────────────────────────────────────
  await expectFailure(
    `insert into public.packaged_products (id, name, category, protein_g)
       values ('pp-no-basis', 'Без основи', 'Інше', 5.6)`,
    /packaged_products_nutrition_requires_basis/,
  );

  await expectFailure(
    `insert into public.packaged_products (id, name, category, nutrition_basis, fat_g, saturated_fat_g)
       values ('pp-fat', 'Забагато насичених', 'Інше', 'per_100_g', 3.0, 9.0)`,
    /packaged_products_saturated_fat_within_fat/,
  );

  await expectFailure(
    `insert into public.packaged_products (id, name, category, nutrition_basis, carbohydrate_g, sugars_g)
       values ('pp-sugar', 'Забагато цукру', 'Інше', 'per_100_g', 10.0, 25.0)`,
    /packaged_products_sugars_within_carbohydrate/,
  );

  // Rounding slack on the label itself must stay legal.
  await db.exec(`
    insert into public.packaged_products (id, name, category, nutrition_basis, fat_g, saturated_fat_g)
      values ('pp-slack', 'Округлення етикетки', 'Інше', 'per_100_g', 0.5, 0.5)
  `);

  await expectFailure(
    `insert into public.packaged_products (id, name, category, package_size)
       values ('pp-size', 'Розмір без одиниці', 'Інше', 165)`,
    /packaged_products_package_size_unit_together/,
  );

  await expectFailure(
    `insert into public.packaged_products (id, name, category, product_variant_id)
       values ('pp-variant', 'Варіант без сімейства', 'Інше', 'potato_chips')`,
    /packaged_products_variant_requires_family/,
  );

  // ── Review notes ("Потрібна перевірка") ──────────────────────────────────
  // Existing rows and rows inserted without notes mean "nothing to check".
  const defaults = await db.query(
    `select review_notes, cardinality(review_notes) as n
       from public.packaged_products where id = 'pp-pringles'`,
  );
  assert.deepEqual(defaults.rows[0].review_notes, []);
  assert.equal(defaults.rows[0].n, 0);

  // Marking notes as checked rewrites the array; the last one clears the marker.
  await db.exec(`
    update public.packaged_products
       set review_notes = array['Штрихкод розмитий: перевір останні цифри', 'Немає таблиці поживності']
     where id = 'pp-pringles'
  `);
  const flagged = await db.query(
    `select id from public.packaged_products where cardinality(review_notes) > 0`,
  );
  assert.deepEqual(
    flagged.rows.map((r) => r.id),
    ['pp-pringles'],
  );
  await db.exec(`update public.packaged_products set review_notes = '{}' where id = 'pp-pringles'`);
  const cleared = await db.query(
    `select count(*)::int as n from public.packaged_products where cardinality(review_notes) > 0`,
  );
  assert.equal(cleared.rows[0].n, 0);

  // Limits: 300 characters per note is legal, 301 is not.
  await db.exec(
    `update public.packaged_products
        set review_notes = array[repeat('я', 300)] where id = 'pp-pringles'`,
  );
  await expectFailure(
    `update public.packaged_products
        set review_notes = array[repeat('я', 301)] where id = 'pp-pringles'`,
    /packaged_products_review_notes_valid/,
  );
  // Blank, padded and NULL entries are rejected: the client trims before writing.
  await expectFailure(
    `update public.packaged_products set review_notes = array[''] where id = 'pp-pringles'`,
    /packaged_products_review_notes_valid/,
  );
  await expectFailure(
    `update public.packaged_products set review_notes = array['   '] where id = 'pp-pringles'`,
    /packaged_products_review_notes_valid/,
  );
  await expectFailure(
    `update public.packaged_products set review_notes = array[' padded'] where id = 'pp-pringles'`,
    /packaged_products_review_notes_valid/,
  );
  await expectFailure(
    `update public.packaged_products
        set review_notes = array['ok', null] where id = 'pp-pringles'`,
    /packaged_products_review_notes_valid/,
  );
  // 50 notes per card is the ceiling, 51 is not.
  await db.exec(
    `update public.packaged_products
        set review_notes = (select array_agg('note ' || g) from generate_series(1, 50) g)
      where id = 'pp-pringles'`,
  );
  await expectFailure(
    `update public.packaged_products
        set review_notes = (select array_agg('note ' || g) from generate_series(1, 51) g)
      where id = 'pp-pringles'`,
    /packaged_products_review_notes_valid/,
  );
  // The column is NOT NULL: "nothing to check" is an empty array, never NULL.
  await expectFailure(
    `update public.packaged_products set review_notes = null where id = 'pp-pringles'`,
    /review_notes/,
  );
  // A new card can carry its notes from the start (the import path).
  await db.exec(`
    insert into public.packaged_products (id, name, category, review_notes)
      values ('pp-flagged', 'Картка з приміткою', 'Інше', array['Збіг із чеком неоднозначний']);
    update public.packaged_products set review_notes = '{}' where id = 'pp-pringles';
  `);
  const insertedFlag = await db.query(
    `select review_notes from public.packaged_products where id = 'pp-flagged'`,
  );
  assert.deepEqual(insertedFlag.rows[0].review_notes, ['Збіг із чеком неоднозначний']);
  await db.exec(`delete from public.packaged_products where id = 'pp-flagged'`);

  // ── The photographing queue ──────────────────────────────────────────────
  await db.exec(`
    insert into public.receipts values
      ('r-rewe', 'REWE', '2026-09-01'),
      ('r-aldi', 'Aldi', '2026-09-02'),
      ('r-lidl', 'Lidl', '2026-09-03');

    -- One physical product printed differently at two stores.
    insert into public.products (id, name, store, category, brand) values
      ('prod-rewe-pringles', 'Original', 'REWE', 'Снеки', 'Pringles'),
      ('prod-aldi-pringles', 'Original', 'Aldi', 'Снеки', 'Pringles'),
      ('prod-lidl-milk',     'Milbona Milch', 'Lidl', 'Інше', null),
      ('prod-lidl-tomato',   'Tomaten lose', 'Lidl', 'Овочі/фрукти', null);

    insert into public.items (id, receipt_id, product_id, product_name, raw_product_name, category, qty, total_orig, total_eur) values
      ('i1', 'r-rewe', 'prod-rewe-pringles', 'Pringles Original', 'Original',        'Снеки', 1, 2.99, 2.99),
      ('i2', 'r-rewe', 'prod-rewe-pringles', 'Pringles Original', 'Original',        'Снеки', 1, 2.99, 2.99),
      ('i3', 'r-aldi', 'prod-aldi-pringles', 'Pringles Original', 'PRINGLES ORIG.',  'Снеки', 1, 2.79, 2.79),
      ('i4', 'r-lidl', 'prod-lidl-milk',     'Milbona Milch',     'MILBONA MILCH',   'Інше',  1, 1.09, 1.09),
      ('i5', 'r-lidl', 'prod-lidl-tomato',   'Помідори',          'Tomaten lose',    'Овочі/фрукти', 1, 2.20, 2.20);

    insert into public.product_prices values
      ('pr1', 'prod-rewe-pringles', 'r-rewe', 2.99, 2.99, 'EUR', '2026-09-01', now());
  `);

  const queue = await db.query(
    `select product_id, store, group_key, purchases_count, group_purchases_count, receipt_labels, last_price_orig
       from public.search_packaging_candidates()`,
  );

  // Newest purchase first (not most-bought): Lidl on 09-03 beats Pringles, whose
  // newest purchase is 09-02. Both Pringles rows share one group_key, so they sit
  // together, the group's newest row first.
  assert.deepEqual(
    queue.rows.map((r) => r.product_id),
    ['prod-lidl-milk', 'prod-lidl-tomato', 'prod-aldi-pringles', 'prod-rewe-pringles'],
  );
  assert.equal(queue.rows[2].group_key, queue.rows[3].group_key);
  assert.equal(Number(queue.rows[2].group_purchases_count), 3);
  assert.equal(Number(queue.rows[3].group_purchases_count), 3);
  assert.deepEqual(queue.rows[0].receipt_labels, ['MILBONA MILCH']);
  assert.equal(Number(queue.rows[3].last_price_orig), 2.99);

  // ── Deposit and refund-only lines never reach the queue ──────────────────
  await db.exec(`
    insert into public.receipts values
      ('r-old', 'Kaufland', '2026-05-01'),
      ('r-new', 'Kaufland', '2026-09-10');

    insert into public.products (id, name, store, category) values
      -- Pfand by category, whatever it is called.
      ('prod-pfand-category',  'Flaschenrückgabe',   'ALDI',     'Pfand'),
      -- Pfand by printed name, filed under another category.
      ('prod-pfand-name',      'Pfandartikel',       'Kaufland', 'Інше'),
      ('prod-pfand-leergut',   'Leergut Einw.allg.', 'Lidl',     'Інше'),
      ('prod-pfand-eigenmarke', 'Eigenmarke: Pfand', 'ALDI',     'Інше'),
      -- Only ever a negative line: a coupon, not a product.
      ('prod-rabatt',          'Treue Rabatt',       'Kaufland', 'Інше'),
      -- Bought once and refunded once: a real product, stays.
      ('prod-bought-refunded', 'Joghurt Natur',      'Kaufland', 'Інше'),
      -- Free sample at 0.00: not a refund, stays.
      ('prod-free',            'Gratisprobe',        'Kaufland', 'Інше'),
      -- Never bought at all: stays, ranked last.
      ('prod-never-bought',    'Neues Produkt',      'Kaufland', 'Інше');

    insert into public.items (id, receipt_id, product_id, product_name, raw_product_name, category, qty, total_orig, total_eur) values
      ('d1', 'r-new', 'prod-pfand-category',   'Pfand', 'Pfand',             'Pfand', 1,  0.25,  0.25),
      ('d2', 'r-new', 'prod-pfand-name',       'Pfand', 'Pfandartikel',      'Інше',  1,  0.25,  0.25),
      ('d3', 'r-new', 'prod-pfand-leergut',    'Pfand', 'Leergut Einw.allg.', 'Інше', 1, -0.25, -0.25),
      ('d4', 'r-new', 'prod-pfand-eigenmarke', 'Pfand', 'Eigenmarke: Pfand', 'Інше',  1, -0.75, -0.75),
      ('d5', 'r-new', 'prod-rabatt',           'Rabatt', 'Treue Rabatt',     'Інше',  1, -1.00, -1.00),
      ('d6', 'r-old', 'prod-bought-refunded',  'Joghurt', 'Joghurt Natur',   'Інше',  1,  0.89,  0.89),
      ('d7', 'r-new', 'prod-bought-refunded',  'Joghurt', 'Joghurt Natur',   'Інше',  1, -0.89, -0.89),
      ('d8', 'r-new', 'prod-free',             'Probe',  'Gratisprobe',      'Інше',  1,  0.00,  0.00);
  `);

  const withDeposits = await db.query(
    `select product_id from public.search_packaging_candidates()`,
  );
  assert.deepEqual(
    withDeposits.rows.map((r) => r.product_id),
    [
      // Newest positive purchase first; the joghurt's last one is 05-01 (the refund
      // does not count). The free sample and the never-bought row have no purchase
      // date, so they come last.
      'prod-lidl-milk',
      'prod-lidl-tomato',
      'prod-aldi-pringles',
      'prod-rewe-pringles',
      'prod-bought-refunded',
      'prod-free',
      'prod-never-bought',
    ],
  );

  // A deposit row stays out even when a search names it, and out of the summary.
  const searchedDeposit = await db.query(
    `select product_id from public.search_packaging_candidates('pfand')`,
  );
  assert.deepEqual(searchedDeposit.rows, []);
  const summaryAll = await db.query(`select * from public.packaging_queue_summary()`);
  assert.deepEqual(summaryAll.rows, [{ total_count: 7, recent_count: 7 }]);

  // ── The recency window ───────────────────────────────────────────────────
  const since = async (date, query = '') =>
    (
      await db.query(
        `select product_id, group_purchases_count
           from public.search_packaging_candidates($1, null, null, null, null, 100, 0, $2)`,
        [query, date],
      )
    ).rows;

  // On or after the date, and never-bought rows (no date) are outside any window.
  assert.deepEqual(
    (await since('2026-09-03')).map((r) => r.product_id),
    ['prod-lidl-milk', 'prod-lidl-tomato'],
  );
  assert.deepEqual(
    (await since('2026-09-11')).map((r) => r.product_id),
    [],
  );

  // The hidden Pringles row still counts toward the cross-store hint: the visible
  // Aldi row is part of a 3-purchase group even though the REWE row is outside.
  const windowed = await since('2026-09-02');
  assert.deepEqual(
    windowed.map((r) => r.product_id),
    ['prod-lidl-milk', 'prod-lidl-tomato', 'prod-aldi-pringles'],
  );
  assert.equal(Number(windowed[2].group_purchases_count), 3);

  // The summary splits the same candidate set: 7 rows, 3 of them in the window.
  const summaryWindow = await db.query(
    `select * from public.packaging_queue_summary('', '2026-09-02')`,
  );
  assert.deepEqual(summaryWindow.rows, [{ total_count: 7, recent_count: 3 }]);
  // A search counts every match, wherever it falls relative to the window.
  const summarySearch = await db.query(
    `select * from public.packaging_queue_summary('pringles', '2026-09-03')`,
  );
  assert.deepEqual(summarySearch.rows, [{ total_count: 2, recent_count: 0 }]);

  await db.exec(`
    delete from public.items where id in ('d1','d2','d3','d4','d5','d6','d7','d8');
    delete from public.products where id like 'prod-pfand-%' or id in
      ('prod-rabatt', 'prod-bought-refunded', 'prod-free', 'prod-never-bought');
    delete from public.receipts where id in ('r-old', 'r-new');
  `);

  // Search is literal: LIKE metacharacters must not act as wildcards.
  const wildcard = await db.query(`select product_id from public.search_packaging_candidates('%')`);
  assert.deepEqual(wildcard.rows, []);

  const byBrand = await db.query(
    `select product_id from public.search_packaging_candidates('pringles')`,
  );
  assert.deepEqual(
    byBrand.rows.map((r) => r.product_id),
    ['prod-aldi-pringles', 'prod-rewe-pringles'],
  );

  // ── Linking and opting out both empty the queue ──────────────────────────
  await db.exec(`
    update public.products set packaged_product_id = 'pp-pringles'
      where id in ('prod-rewe-pringles', 'prod-aldi-pringles');
    update public.products set packaging_not_applicable = true
      where id = 'prod-lidl-tomato';
  `);

  const afterLink = await db.query(`select product_id from public.search_packaging_candidates()`);
  assert.deepEqual(
    afterLink.rows.map((r) => r.product_id),
    ['prod-lidl-milk'],
  );

  // ── The reverse lookup: how is this product printed at each store ────────
  const labels = await db.query(
    `select store, product_name, receipt_labels, purchases_count, last_price_orig
       from public.packaged_product_store_labels('pp-pringles')`,
  );
  assert.deepEqual(
    labels.rows.map((r) => [r.store, r.receipt_labels[0], Number(r.purchases_count)]),
    [
      ['REWE', 'Original', 2],
      ['Aldi', 'PRINGLES ORIG.', 1],
    ],
  );
  assert.equal(Number(labels.rows[0].last_price_orig), 2.99);

  // ── Deleting a card unlinks the store rows instead of cascading ──────────
  await db.exec(`delete from public.packaged_products where id = 'pp-pringles'`);
  const unlinked = await db.query(
    `select count(*)::int as remaining from public.products where packaged_product_id is not null`,
  );
  assert.equal(unlinked.rows[0].remaining, 0);
  const requeued = await db.query(`select product_id from public.search_packaging_candidates()`);
  assert.deepEqual(requeued.rows.map((r) => r.product_id).sort(), [
    'prod-aldi-pringles',
    'prod-lidl-milk',
    'prod-rewe-pringles',
  ]);

  // ── Photos cascade with their packaged product ──────────────────────────
  await db.exec(`
    insert into public.packaged_products (id, name, category) values ('pp-photos', 'Товар з фото', 'Інше');
    insert into public.packaged_product_photos (id, packaged_product_id, storage_path, kind)
      values ('ph1', 'pp-photos', 'a@b.c/pp-photos/01.jpg', 'front'),
             ('ph2', 'pp-photos', 'a@b.c/pp-photos/02.jpg', 'nutrition');
  `);
  await expectFailure(
    `insert into public.packaged_product_photos (id, packaged_product_id, storage_path)
       values ('ph3', 'pp-photos', 'a@b.c/pp-photos/01.jpg')`,
    /packaged_product_photos_storage_path_key/,
  );
  await db.exec(`delete from public.packaged_products where id = 'pp-photos'`);
  const photos = await db.query(`select count(*)::int as n from public.packaged_product_photos`);
  assert.equal(photos.rows[0].n, 0);

  console.log('packaged-products SQL: all assertions passed');
} finally {
  await db.close();
}

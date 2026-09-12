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
    insert into public.categories values ('Інше'), ('Снеки'), ('Овочі/фрукти');

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

  // Pringles wins: 3 purchases across two stores against 1 each for the others,
  // and both store rows share one group_key so they sit together.
  assert.deepEqual(
    queue.rows.map((r) => r.product_id),
    ['prod-rewe-pringles', 'prod-aldi-pringles', 'prod-lidl-milk', 'prod-lidl-tomato'],
  );
  assert.equal(queue.rows[0].group_key, queue.rows[1].group_key);
  assert.equal(Number(queue.rows[0].group_purchases_count), 3);
  assert.equal(Number(queue.rows[1].group_purchases_count), 3);
  assert.deepEqual(queue.rows[2].receipt_labels, ['MILBONA MILCH']);
  assert.equal(Number(queue.rows[0].last_price_orig), 2.99);

  // Search is literal: LIKE metacharacters must not act as wildcards.
  const wildcard = await db.query(`select product_id from public.search_packaging_candidates('%')`);
  assert.deepEqual(wildcard.rows, []);

  const byBrand = await db.query(
    `select product_id from public.search_packaging_candidates('pringles')`,
  );
  assert.deepEqual(
    byBrand.rows.map((r) => r.product_id),
    ['prod-rewe-pringles', 'prod-aldi-pringles'],
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

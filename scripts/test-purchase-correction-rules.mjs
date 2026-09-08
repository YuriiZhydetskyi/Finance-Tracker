import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();

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
    create table public.products (
      id text primary key,
      name text not null,
      store text not null,
      store_product_code text,
      category text not null references public.categories(name),
      product_family_id text references public.product_families(id),
      product_variant_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      foreign key (product_variant_id, product_family_id)
        references public.product_variants(id, family_id)
    );
    create type public.receipt_source as enum ('photo', 'manual', 'edit');
    create table public.receipts (
      id text primary key,
      store text not null,
      source public.receipt_source not null default 'manual'
    );
    create unique index products_store_name_nocode_uniq
      on public.products (store, name) where store_product_code is null;
    create table public.items (
      id text primary key,
      receipt_id text not null references public.receipts(id),
      product_id text references public.products(id),
      product_name text not null,
      category text not null references public.categories(name),
      product_family_id text references public.product_families(id),
      product_variant_id text,
      qty numeric not null,
      unit_price_orig numeric not null,
      total_orig numeric not null,
      total_eur numeric not null,
      consumed_by text not null,
      discount_orig numeric not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      foreign key (product_variant_id, product_family_id)
        references public.product_variants(id, family_id)
    );
    create table public.product_prices (
      id text primary key,
      product_id text not null references public.products(id),
      receipt_id text not null references public.receipts(id),
      price_orig numeric not null,
      price_net numeric not null,
      currency text not null,
      date date not null
    );
    create function public.set_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at = now(); return new; end; $$;
    create function public.is_allowed_user() returns boolean language sql stable as $$ select true $$;
    create function public.normalize_product_search(p_value text) returns text language sql stable as $$
      select btrim(regexp_replace(lower(coalesce(p_value, '')), '[[:space:].,;:/()\\[\\]{}+!?"''’–—-]+', ' ', 'g'))
    $$;
    create function public.inherit_item_product_taxonomy() returns trigger language plpgsql as $$
    begin
      if tg_op = 'UPDATE' then
        if new.product_id is null or new.product_id is not distinct from old.product_id then
          return new;
        end if;
        if new.product_family_id is not distinct from old.product_family_id
           and new.product_variant_id is not distinct from old.product_variant_id then
          new.product_family_id := null;
          new.product_variant_id := null;
        end if;
      end if;
      if new.product_id is not null
         and new.product_family_id is null and new.product_variant_id is null then
        select p.product_family_id, p.product_variant_id
          into new.product_family_id, new.product_variant_id
          from public.products p where p.id = new.product_id;
      end if;
      return new;
    end;
    $$;
    create trigger trg_items_inherit_product_taxonomy
      before insert or update of product_id on public.items
      for each row execute function public.inherit_item_product_taxonomy();
  `);

  const migration = await readFile(
    new URL('../supabase/migrations/20260908160458_purchase_correction_rules.sql', import.meta.url),
    'utf8',
  );
  await db.exec(migration);

  const rls = await db.query(`
    select c.relrowsecurity, exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'product_match_rules'
        and policyname = 'allowlist_all_product_match_rules'
    ) as has_allowlist_policy
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'product_match_rules'
  `);
  assert.deepEqual(rls.rows[0], { relrowsecurity: true, has_allowlist_policy: true });

  await db.exec(`
    insert into public.receipts values ('r-rewe', 'REWE', 'manual'), ('r-lidl', 'Lidl', 'manual');
    insert into public.products (id, name, store, category, product_family_id, product_variant_id)
      values ('pringles-original', 'Pringles Original', 'REWE', 'Снеки', 'chips', 'potato_chips');
    insert into public.products (id, name, store, category)
      values ('rewe-original-source', 'Original', 'REWE', 'Інше');
    insert into public.product_match_rules (
      store_key, raw_product_name_key, product_id, product_name, category,
      product_family_id, product_variant_id
    ) values ('rewe', 'original', 'pringles-original', 'Pringles Original', 'Снеки', 'chips', 'potato_chips');

    insert into public.items (id, receipt_id, product_id, product_name, category, qty, unit_price_orig, total_orig, total_eur, consumed_by)
      values ('rewe-original', 'r-rewe', 'rewe-original-source', ' Original ', 'Інше', 1, 2.99, 2.99, 2.99, 'shared');
    insert into public.items (id, receipt_id, product_name, category, qty, unit_price_orig, total_orig, total_eur, consumed_by)
      values ('lidl-original', 'r-lidl', 'Original', 'Інше', 1, 2.99, 2.99, 2.99, 'shared');
    insert into public.items (id, receipt_id, product_name, category, qty, unit_price_orig, total_orig, total_eur, consumed_by)
      values ('rewe-punctuation', 'r-rewe', 'Original!', 'Інше', 1, 2.99, 2.99, 2.99, 'shared');
  `);

  const matched = await db.query(
    "select raw_product_name, product_name, category, product_family_id, product_variant_id from public.items where id = 'rewe-original'",
  );
  assert.deepEqual(matched.rows[0], {
    raw_product_name: ' Original ',
    product_name: 'Pringles Original',
    category: 'Снеки',
    product_family_id: 'chips',
    product_variant_id: 'potato_chips',
  });

  const unmatched = await db.query(
    "select raw_product_name, product_name, product_id from public.items where id = 'lidl-original'",
  );
  assert.deepEqual(unmatched.rows[0], {
    raw_product_name: 'Original',
    product_name: 'Original',
    product_id: null,
  });
  const punctuationDistinct = await db.query(
    "select product_id, product_name from public.items where id = 'rewe-punctuation'",
  );
  assert.deepEqual(punctuationDistinct.rows[0], { product_id: null, product_name: 'Original!' });

  await db.exec(`
    select public.correct_purchase_classification(
      'rewe-original', 'unused-new-id', 'Pringles Original', 'Овочі/фрукти', 'tomatoes', null, true
    );
  `);
  const categoryCorrection = await db.query(`
    select i.product_id, i.category, i.product_family_id, p.category as catalogue_category
    from public.items i join public.products p on p.id = i.product_id
    where i.id = 'rewe-original'
  `);
  assert.deepEqual(categoryCorrection.rows[0], {
    product_id: 'pringles-original',
    category: 'Овочі/фрукти',
    product_family_id: 'tomatoes',
    catalogue_category: 'Снеки',
  });

  await db.exec(`
    select public.correct_purchase_classification(
      'rewe-original', 'unused-new-id', 'Pringles Original', 'Овочі/фрукти', null, null, true
    );
  `);
  const nullTaxonomyCorrection = await db.query(`
    select product_family_id, product_variant_id from public.items where id = 'rewe-original'
  `);
  assert.deepEqual(nullTaxonomyCorrection.rows[0], {
    product_family_id: null,
    product_variant_id: null,
  });

  await db.exec(`
    insert into public.products (id, name, store, category)
      values ('old-rewe-product', 'Old label', 'REWE', 'Інше');
    insert into public.items (id, receipt_id, product_id, product_name, category, qty, unit_price_orig, total_orig, total_eur, consumed_by)
      values ('correct-me', 'r-rewe', 'old-rewe-product', 'Different receipt label', 'Інше', 2, 1.49, 2.98, 2.98, 'shared');
    select public.correct_purchase_classification(
      'correct-me', 'new-tomatoes', 'Tomaten', 'Овочі/фрукти', 'tomatoes', null, true
    );
  `);

  const corrected = await db.query(
    "select product_id, product_name, raw_product_name, category, qty, total_orig from public.items where id = 'correct-me'",
  );
  assert.deepEqual(corrected.rows[0], {
    product_id: 'new-tomatoes',
    product_name: 'Tomaten',
    raw_product_name: 'Different receipt label',
    category: 'Овочі/фрукти',
    qty: '2',
    total_orig: '2.98',
  });

  const unchangedProduct = await db.query(
    "select name, category from public.products where id = 'old-rewe-product'",
  );
  assert.deepEqual(unchangedProduct.rows[0], { name: 'Old label', category: 'Інше' });

  await db.exec(`
    update public.receipts set source = 'edit' where id = 'r-rewe';
    insert into public.items (id, receipt_id, product_name, raw_product_name, category, qty, unit_price_orig, total_orig, total_eur, consumed_by)
      values ('edited-row', 'r-rewe', 'Ручна назва', 'Original', 'Овочі/фрукти', 1, 1, 1, 1, 'shared');
  `);
  const edited = await db.query(
    "select product_id, product_name, category from public.items where id = 'edited-row'",
  );
  assert.deepEqual(edited.rows[0], {
    product_id: null,
    product_name: 'Ручна назва',
    category: 'Овочі/фрукти',
  });

  await assert.rejects(
    db.exec(`
      select public.correct_purchase_classification(
        'correct-me', 'must-not-persist', 'Broken category', 'Missing category', null, null, true
      );
    `),
  );
  const failedCorrectionProduct = await db.query(
    "select id from public.products where id = 'must-not-persist'",
  );
  assert.equal(failedCorrectionProduct.rows.length, 0);

  await assert.rejects(
    db.exec("update public.items set raw_product_name = 'tampered' where id = 'correct-me'"),
    /original receipt product label/i,
  );

  process.stdout.write('purchase-correction SQL regression checks passed\n');
} finally {
  await db.close();
}

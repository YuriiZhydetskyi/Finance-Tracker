// Shared PGlite bootstrap for the SQL test scripts that need the real product /
// receipt / packaging schema. Real migrations run wherever PGlite can run them;
// only what needs Supabase-only extensions (pgmq, unaccent, pg_cron, vault,
// storage) is replaced by a hand-written stub, and the stubs are kept here so
// every script uses the same ones.

import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export const migrationText = async (name) =>
  (await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')).replace(
    /\r\n/g,
    '\n',
  );

export const ULID = (suffix) => String(suffix).padStart(26, '0');

// The migrations that make up the deploy of the canonical-stores change, in order.
export const CANONICAL_STORES_MIGRATIONS = [
  '20261027120000_store_name_registry.sql',
  '20261027120100_packaging_not_applicable_reason.sql',
  '20261027120200_merge_products.sql',
  '20261027120300_canonicalize_stores_and_merge_duplicates.sql',
  '20261027120400_canonical_store_write_path.sql',
  '20261027120500_packaging_exclusion_rule.sql',
  '20261027120600_packaging_queue_other_store_hint.sql',
];

/**
 * A database in the state it has on production just before the canonical-stores
 * migrations: every earlier migration applied, nothing of the new ones.
 */
export async function createPreDeployDatabase() {
  const db = new PGlite();
  const notices = [];
  const onNotice = (notice) => notices.push(notice.message);

  await db.exec(`
    create schema auth;
    create schema extensions;
    create schema pgmq;
    create role anon;
    create role authenticated;
    create role service_role;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb
    $$;
    create function extensions.unaccent(text) returns text language sql immutable as $$ select $1 $$;
    create function pgmq.archive(text, bigint) returns boolean language sql as $$ select true $$;

    -- What Supabase grants by default; migrations then revoke what they want closed.
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);

  for (const file of [
    '20260507000001_initial_schema.sql',
    '20260510000001_product_codes_and_prices.sql',
    '20260517000001_add_store_address_and_time.sql',
    '20260518000002_waste_tracking.sql',
    '20260531000001_add_manual_json_source.sql',
    '20260606000001_add_statement_source.sql',
  ]) {
    await db.exec(await migrationText(file));
  }

  // 20260831054319_background_receipt_imports.sql needs pgmq/pg_cron/vault. The
  // finalizers only need its receipts column and the two import tables.
  await db.exec(`
    alter table public.receipts add column photo_path text;
    create table public.receipt_import_batches (
      id text primary key,
      paid_by text not null
    );
    create table public.receipt_import_files (
      id text primary key,
      batch_id text not null references public.receipt_import_batches(id),
      storage_path text,
      manual_json jsonb,
      status text not null default 'processing',
      skip_duplicate_check boolean not null default false,
      receipt_id text,
      document_kind text,
      parsed_json jsonb,
      exception_kind text,
      error_message text,
      duplicate_receipt_id text,
      processed_at timestamptz
    );
  `);
  await db.exec(await migrationText('20260905130900_add_amazon_order_metadata.sql'));

  // Taxonomy: the tables are mirrored, the item trigger function is sliced verbatim.
  const taxonomy = await migrationText('20260907202419_multilingual_product_taxonomy.sql');
  const triggerStart = taxonomy.indexOf('create function public.inherit_item_product_taxonomy()');
  const triggerEnd = taxonomy.indexOf('-- Keep matching language-neutral');
  if (triggerStart < 0 || triggerEnd < triggerStart) throw new Error('taxonomy trigger not found');
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
  await db.exec(
    taxonomy.slice(
      taxonomy.indexOf('create function public.normalize_product_search'),
      taxonomy.indexOf('create function public.search_waste_items'),
    ),
  );

  for (const file of [
    '20260908160458_purchase_correction_rules.sql',
    '20260912072149_packaged_products.sql',
    '20260907132451_stats_period_filters.sql',
    '20260912072151_packaging_queue_functions.sql',
    '20260922100000_save_receipt_bundle.sql',
    '20260922100001_apply_product_match_rule_single_lookup.sql',
    '20261027090000_packaging_queue_deposits_and_recency.sql',
  ]) {
    await db.exec(await migrationText(file));
  }

  // The durable finalizers, exactly as production has them: the receipt one in
  // full, the pasted-JSON one sliced out of the migration that also creates the
  // batch RPC (which needs pgmq), then the two later migrations that wrap/patch them.
  await db.exec(await migrationText('20260831161602_auto_resolve_exact_receipt_duplicates.sql'));
  const pasted = await migrationText('20260907085445_create_manual_json_import_batch.sql');
  const pastedStart = pasted.indexOf(
    'create or replace function public.finalize_pasted_json_import(',
  );
  const pastedEnd = pasted.indexOf(
    'revoke execute on function public.create_manual_receipt_import_batch',
  );
  if (pastedStart < 0 || pastedEnd < pastedStart) throw new Error('pasted finalizer not found');
  await db.exec(pasted.slice(pastedStart, pastedEnd));
  await db.exec(
    await migrationText('20260907124730_auto_resolve_exact_amazon_order_duplicates.sql'),
  );
  await db.exec(await migrationText('20260908162225_fix_product_match_price_linking.sql'));

  return { db, notices, onNotice };
}

/**
 * Applies the canonical-stores migrations (all of them, or the range from..upTo,
 * both inclusive) and returns the NOTICE lines collected so far.
 */
export async function applyCanonicalStoresMigrations(database, { from, upTo } = {}) {
  const start = from ? CANONICAL_STORES_MIGRATIONS.indexOf(from) : 0;
  const end = upTo
    ? CANONICAL_STORES_MIGRATIONS.indexOf(upTo) + 1
    : CANONICAL_STORES_MIGRATIONS.length;
  for (const file of CANONICAL_STORES_MIGRATIONS.slice(start, end)) {
    await database.db.exec(await migrationText(file), { onNotice: database.onNotice });
  }
  return database.notices;
}

export async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0])[0];
}

/** Runs `sql` as a signed-in user (RLS applies) and resets the role afterwards. */
export async function asUser(db, email, sql, params = []) {
  await db.query(`select set_config('test.jwt', $1, false)`, [JSON.stringify({ email })]);
  await db.exec('set role authenticated');
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('test.jwt', '', false)`);
  }
}

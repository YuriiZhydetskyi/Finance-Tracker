import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = process.cwd();
const outputDirectory = resolve(root, 'output/product-taxonomy');
const manifestPath = resolve(root, 'scripts/product-taxonomy/approved-taxonomy-manifest.json');
const migrationPath = resolve(
  root,
  'supabase/migrations/20260908083827_product_taxonomy_historical_backfill.sql',
);
const expected = { ready: 591, products: 622, items: 1112, families: 278, variants: 406 };

function sql(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function values(rows) {
  return rows.map((row) => `(${row.map(sql).join(', ')})`).join(',\n');
}

function targetRows(rows, proposalByName, kind) {
  return rows
    .map((row) => {
      const proposal = proposalByName.get(row.normalized_name);
      assert(proposal, `${kind} ${row.id} has no approved proposal`);
      const family = proposal.family_id;
      const variant = proposal.variant_id;
      if (kind === 'product') {
        return [
          row.id,
          row.name,
          row.category,
          row.store,
          row.store_product_code,
          row.product_family_id,
          row.product_variant_id,
          row.brand,
          row.is_organic,
          family,
          variant,
          row.brand ?? proposal.brand,
          row.is_organic ?? proposal.is_organic,
        ];
      }
      return [
        row.id,
        row.receipt_id,
        row.product_id,
        row.product_name,
        row.category,
        row.product_family_id,
        row.product_variant_id,
        family,
        variant,
      ];
    })
    .sort((left, right) => left[0].localeCompare(right[0]));
}

function migrationTail(productTargets, itemTargets) {
  return `
-- Recovery scope is ID-based. It was generated from a fresh, read-only live snapshot;
-- a later purchase with the same receipt text is intentionally outside this backfill.
create temporary table taxonomy_product_target (
  product_id text primary key,
  expected_name text not null,
  expected_category text,
  expected_store text,
  expected_store_product_code text,
  expected_product_family_id text,
  expected_product_variant_id text,
  expected_brand text,
  expected_is_organic boolean,
  target_family_id text not null,
  target_variant_id text,
  target_brand text,
  target_is_organic boolean
) on commit drop;

insert into taxonomy_product_target
values
${values(productTargets)};

create temporary table taxonomy_item_target (
  item_id text primary key,
  expected_receipt_id text not null,
  expected_product_id text,
  expected_product_name text not null,
  expected_category text,
  expected_product_family_id text,
  expected_product_variant_id text,
  target_family_id text not null,
  target_variant_id text
) on commit drop;

insert into taxonomy_item_target
values
${values(itemTargets)};

do $$
begin
  if (select count(*) from public.product_families) <> ${expected.families}
     or (select count(*) from public.product_variants) <> ${expected.variants} then
    raise exception 'Unexpected taxonomy catalog cardinality after seeding';
  end if;

  if (select count(*) from taxonomy_product_target) <> ${expected.products}
     or (select count(*) from taxonomy_item_target) <> ${expected.items} then
    raise exception 'Unexpected frozen backfill target cardinality';
  end if;

  if exists (
    select 1
    from (
      select target_family_id as family_id, target_variant_id as variant_id from taxonomy_product_target
      union all
      select target_family_id, target_variant_id from taxonomy_item_target
    ) t
    left join public.product_families f on f.id = t.family_id
    left join public.product_variants v on v.id = t.variant_id and v.family_id = t.family_id
    where f.id is null or (t.variant_id is not null and v.id is null)
  ) then
    raise exception 'Frozen target references an invalid family or variant';
  end if;

  if exists (
    select 1
    from taxonomy_product_target t
    left join public.products p on p.id::text = t.product_id
    where p.id is null
      or p.name is distinct from t.expected_name
      or p.category is distinct from t.expected_category
      or p.store is distinct from t.expected_store
      or p.store_product_code is distinct from t.expected_store_product_code
      or p.product_family_id is distinct from t.expected_product_family_id
      or p.product_variant_id is distinct from t.expected_product_variant_id
      or p.brand is distinct from t.expected_brand
      or p.is_organic is distinct from t.expected_is_organic
  ) then
    raise exception 'Product target prestate drifted; regenerate and review the backfill';
  end if;

  if exists (
    select 1
    from taxonomy_item_target t
    left join public.items i on i.id::text = t.item_id
    where i.id is null
      or i.receipt_id::text is distinct from t.expected_receipt_id
      or i.product_id::text is distinct from t.expected_product_id
      or i.product_name is distinct from t.expected_product_name
      or i.category is distinct from t.expected_category
      or i.product_family_id is distinct from t.expected_product_family_id
      or i.product_variant_id is distinct from t.expected_product_variant_id
  ) then
    raise exception 'Item target prestate drifted; regenerate and review the backfill';
  end if;
end;
$$;

update public.products p
set product_family_id = t.target_family_id,
    product_variant_id = t.target_variant_id,
    brand = t.target_brand,
    is_organic = t.target_is_organic
from taxonomy_product_target t
where p.id::text = t.product_id;

update public.items i
set product_family_id = t.target_family_id,
    product_variant_id = t.target_variant_id
from taxonomy_item_target t
where i.id::text = t.item_id;

do $$
begin
  if exists (
    select 1
    from taxonomy_product_target t
    join public.products p on p.id::text = t.product_id
    where p.product_family_id is distinct from t.target_family_id
       or p.product_variant_id is distinct from t.target_variant_id
       or p.brand is distinct from t.target_brand
       or p.is_organic is distinct from t.target_is_organic
  ) or exists (
    select 1
    from taxonomy_item_target t
    join public.items i on i.id::text = t.item_id
    where i.product_family_id is distinct from t.target_family_id
       or i.product_variant_id is distinct from t.target_variant_id
  ) then
    raise exception 'Taxonomy postcondition failed';
  end if;
end;
$$;

commit;
`;
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.equal(manifest.schema_version, 1);
const ready = manifest.entries;
assert.equal(ready.length, expected.ready);
const proposalByName = new Map(ready.map((proposal) => [proposal.normalized_name, proposal]));
assert.equal(proposalByName.size, expected.ready);

const approvedNames = [...proposalByName.keys()].sort((left, right) => left.localeCompare(right));
const query = `
with approved(normalized_name) as (values ${approvedNames.map((name) => `(${sql(name)})`).join(', ')}),
product_targets as (
  select p.id::text as id, lower(regexp_replace(btrim(p.name), '\\s+', ' ', 'g')) as normalized_name,
    p.name, p.category, p.store, p.store_product_code, p.product_family_id, p.product_variant_id,
    p.brand, p.is_organic
  from public.products p
  join approved a on a.normalized_name = lower(regexp_replace(btrim(p.name), '\\s+', ' ', 'g'))
),
item_targets as (
  select i.id::text as id, lower(regexp_replace(btrim(i.product_name), '\\s+', ' ', 'g')) as normalized_name,
    i.receipt_id::text as receipt_id, i.product_id::text as product_id, i.product_name, i.category,
    i.product_family_id, i.product_variant_id, r.date as receipt_date, r.store as receipt_store
  from public.items i
  join approved a on a.normalized_name = lower(regexp_replace(btrim(i.product_name), '\\s+', ' ', 'g'))
  join public.receipts r on r.id = i.receipt_id
)
select jsonb_build_object(
  'products', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from product_targets p), '[]'::jsonb),
  'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from item_targets i), '[]'::jsonb)
) as snapshot;
`;

const executable =
  process.platform === 'win32' ? resolve(root, 'node_modules/supabase/bin/supabase.exe') : 'npx';
const args =
  process.platform === 'win32'
    ? ['db', 'query', '--linked', '--output', 'json', query]
    : ['supabase', 'db', 'query', '--linked', '--output', 'json', query];
const { stdout, stderr } = await execFile(executable, args, {
  cwd: root,
  maxBuffer: 50 * 1024 * 1024,
});
if (stderr.trim()) process.stderr.write(stderr);
const response = JSON.parse(stdout);
assert(Array.isArray(response.rows) && response.rows.length === 1, 'Expected one snapshot row');
const snapshot = response.rows[0].snapshot;
assert(
  Array.isArray(snapshot.products) && Array.isArray(snapshot.items),
  'Invalid target snapshot',
);
assert.equal(snapshot.products.length, expected.products);
assert.equal(snapshot.items.length, expected.items);

const productTargets = targetRows(snapshot.products, proposalByName, 'product');
const itemTargets = targetRows(snapshot.items, proposalByName, 'item');
assert.equal(new Set(productTargets.map((target) => target[0])).size, expected.products);
assert.equal(new Set(itemTargets.map((target) => target[0])).size, expected.items);

const workingSource = await readFile(migrationPath, 'utf8');
// The generator rewrites the recovery migration in place. Until that file is
// committed, HEAD remains the immutable catalog template from which we can
// safely regenerate a new frozen scope after a failed local verification.
const source = workingSource.includes('taxonomy_product_target')
  ? (
      await execFile(
        'git',
        [
          'show',
          'HEAD:supabase/migrations/20260908083827_product_taxonomy_historical_backfill.sql',
        ],
        { cwd: root, maxBuffer: 50 * 1024 * 1024 },
      )
    ).stdout
  : workingSource;
const marker = 'create temporary table taxonomy_assignment (';
const markerIndex = source.indexOf(marker);
assert(markerIndex > 0, 'The migration needs the original catalog prelude');
let prelude = source.slice(0, markerIndex).replaceAll('\r\n', '\n');
assert.equal((prelude.match(/on conflict \(id\) do nothing;/g) ?? []).length, 2);
prelude = prelude.replaceAll('\non conflict (id) do nothing;', ';');
prelude = prelude.replace(
  '-- Exact normalized-name matches only. Existing taxonomy and original receipt values\n-- are preserved: non-null taxonomy snapshots and manually supplied metadata win.',
  '-- This recovery uses a frozen ID scope and fails closed if any reviewed source value\n-- changed after the snapshot. It never applies a name-only rule to a future purchase.',
);
prelude = prelude.replace(
  'begin;\n',
  () =>
    `begin;\n\n-- This recovery replaces an unapplied migration. A non-empty catalog means the reviewed\n-- baseline is no longer current, so stop before writing any historical classification.\nlock table public.products, public.items in share row exclusive mode;\ndo $$\nbegin\n  if exists (select 1 from public.product_families)\n     or exists (select 1 from public.product_variants) then\n    raise exception 'Taxonomy catalog is not empty; regenerate and review the backfill';\n  end if;\nend;\n$$;\n`,
);
const migration = `${prelude}${migrationTail(productTargets, itemTargets)}`;
await Promise.all([
  writeFile(migrationPath, migration, 'utf8'),
  writeFile(
    resolve(outputDirectory, 'safe-backfill-targets.json'),
    `${JSON.stringify({ generated_at: new Date().toISOString(), expected, snapshot }, null, 2)}\n`,
    'utf8',
  ),
]);
console.log(
  `Generated frozen recovery scope: ${productTargets.length} products, ${itemTargets.length} items.`,
);

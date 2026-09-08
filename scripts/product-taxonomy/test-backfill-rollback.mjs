import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = process.cwd();
const source = await readFile(
  resolve(root, 'supabase/migrations/20260908083827_product_taxonomy_historical_backfill.sql'),
  'utf8',
);
const rollbackSql = source.replace(/\ncommit;\s*$/, '\nrollback;\n');
assert.notEqual(rollbackSql, source, 'Migration must end with commit;');

const executable =
  process.platform === 'win32' ? resolve(root, 'node_modules/supabase/bin/supabase.exe') : 'npx';
const command = (sqlPath) =>
  process.platform === 'win32'
    ? ['db', 'query', '--linked', '--file', sqlPath]
    : ['supabase', 'db', 'query', '--linked', '--file', sqlPath];

async function runCase(directory, name, sql, expectedError) {
  const sqlPath = join(directory, `${name}.sql`);
  await writeFile(sqlPath, sql, 'utf8');
  try {
    const { stdout, stderr } = await execFile(executable, command(sqlPath), {
      cwd: root,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (stderr.trim()) process.stderr.write(stderr);
    if (expectedError) assert.fail(`${name} unexpectedly succeeded`);
    process.stdout.write(stdout);
  } catch (error) {
    if (!expectedError) throw error;
    assert.match(`${error.stdout ?? ''}\n${error.stderr ?? ''}`, expectedError);
  }
}

async function assertCleanDatabase() {
  const query = `select
    (select count(*) from public.product_families) as families,
    (select count(*) from public.product_variants) as variants,
    (select count(*) from public.products where product_family_id is not null or product_variant_id is not null) as classified_products,
    (select count(*) from public.items where product_family_id is not null or product_variant_id is not null) as classified_items,
    (select count(*) from supabase_migrations.schema_migrations where version = '20260908083827') as history_entries;`;
  const { stdout } = await execFile(
    executable,
    process.platform === 'win32'
      ? ['db', 'query', '--linked', '--output', 'json', query]
      : ['supabase', 'db', 'query', '--linked', '--output', 'json', query],
    { cwd: root, maxBuffer: 1024 * 1024 },
  );
  const row = JSON.parse(stdout).rows[0];
  assert.deepEqual(row, {
    families: 0,
    variants: 0,
    classified_products: 0,
    classified_items: 0,
    history_entries: 0,
  });
}

const directory = await mkdtemp(join(tmpdir(), 'finance-tracker-backfill-'));
try {
  await runCase(directory, 'success', rollbackSql);
  await runCase(
    directory,
    'prestate-drift',
    rollbackSql.replace(
      /(insert into taxonomy_product_target\nvalues\n\('(?:[^']|'')*', )'((?:[^']|'')*)'/,
      (_, prefix) => `${prefix}'__intentionally_drifted_name__'`,
    ),
    /Product target prestate drifted/,
  );
  await runCase(
    directory,
    'invalid-variant',
    rollbackSql.replace(
      '\ndo $$\nbegin\n  if (select count(*) from public.product_families)',
      () =>
        "\nupdate taxonomy_item_target set target_variant_id = '__invalid_variant__' where item_id = (select item_id from taxonomy_item_target limit 1);\n\ndo $$\nbegin\n  if (select count(*) from public.product_families)",
    ),
    /Frozen target references an invalid family or variant/,
  );
  await assertCleanDatabase();
  console.log(
    'Rollback success, drift rejection, and invalid-reference rejection left no database changes.',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

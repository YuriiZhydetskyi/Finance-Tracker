import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = process.cwd();
const queryPath = resolve(root, 'scripts/product-taxonomy/capture-full-live-validation-input.sql');
const outputPath = resolve(
  root,
  'output/taxonomy-audit-20260908/audit-a-reviewed-live-correction-validation-input.json',
);
const executable =
  process.platform === 'win32' ? resolve(root, 'node_modules/supabase/bin/supabase.exe') : 'npx';
const args =
  process.platform === 'win32'
    ? ['db', 'query', '--linked', '--file', queryPath, '--output', 'json']
    : ['supabase', 'db', 'query', '--linked', '--file', queryPath, '--output', 'json'];

const { stdout, stderr } = await execFile(executable, args, {
  cwd: root,
  env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '' },
  maxBuffer: 32 * 1024 * 1024,
});
if (stderr.trim()) process.stderr.write(stderr);

const response = JSON.parse(stdout);
assert.equal(response.rows.length, 1, 'Expected exactly one full validation snapshot row');
const snapshot = response.rows[0].snapshot;
for (const key of ['categories', 'families', 'variants', 'products', 'receipts', 'items']) {
  assert(Array.isArray(snapshot[key]), `Snapshot field ${key} must be an array`);
}

await mkdir(resolve(root, 'output/taxonomy-audit-20260908'), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({ captured_at: new Date().toISOString(), snapshot }, null, 2)}\n`,
  'utf8',
);
console.log(
  JSON.stringify({
    outputPath,
    categories: snapshot.categories.length,
    families: snapshot.families.length,
    variants: snapshot.variants.length,
    products: snapshot.products.length,
    receipts: snapshot.receipts.length,
    items: snapshot.items.length,
  }),
);

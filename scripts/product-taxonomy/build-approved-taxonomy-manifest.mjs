import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const outputDirectory = resolve(root, 'output/product-taxonomy');
const manifestPath = resolve(root, 'scripts/product-taxonomy/approved-taxonomy-manifest.json');

function normalizedId(value) {
  const normalized = value.replaceAll('-', '_');
  return /^\d/.test(normalized) ? `v_${normalized}` : normalized;
}

async function readProposals(batch) {
  for (const suffix of ['-final', '-reviewed', '']) {
    try {
      return JSON.parse(
        await readFile(resolve(outputDirectory, `proposals-batch-${batch}${suffix}.json`), 'utf8'),
      );
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  throw new Error(`Missing proposals for batch ${batch}`);
}

const proposals = (await Promise.all(['a', 'b', 'c'].map(readProposals))).flat();
const entries = proposals
  .filter((proposal) => proposal.status === 'ready')
  .map((proposal) => ({
    normalized_name: proposal.normalized_name,
    family_id: normalizedId(proposal.family.id),
    variant_id: proposal.variant === null ? null : normalizedId(proposal.variant.id),
    brand: proposal.brand,
    is_organic: proposal.is_organic,
  }))
  .sort((left, right) => left.normalized_name.localeCompare(right.normalized_name));

assert.equal(entries.length, 591);
assert.equal(new Set(entries.map((entry) => entry.normalized_name)).size, entries.length);
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      schema_version: 1,
      description: 'Approved taxonomy payload only; no receipt, product, or item identifiers.',
      entries,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log(`Wrote ${entries.length} approved taxonomy entries.`);

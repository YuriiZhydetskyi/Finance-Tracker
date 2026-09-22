import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const outputDirectory = resolve(process.cwd(), 'output/product-taxonomy');
const inventoryPath = resolve(outputDirectory, 'live-inventory.json');
const batches = ['a', 'b', 'c'];

const identifier = /^[a-z][a-z0-9_]*$/;
const statuses = new Set(['ready', 'review', 'excluded']);

function sql(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlArray(values) {
  return `array[${values.map(sql).join(', ')}]::text[]`;
}

function displayName(entity, language) {
  return entity[`name_${language}`];
}

function assertEntity(entity, label) {
  assert(entity && typeof entity === 'object', `${label} is required`);
  assert(typeof entity.id === 'string' && identifier.test(entity.id), `${label} has an invalid id`);
  for (const language of ['uk', 'en', 'de']) {
    assert(
      typeof displayName(entity, language) === 'string' && displayName(entity, language).trim(),
      `${label} needs name_${language}`,
    );
  }
  assert(
    entity.aliases === undefined ||
      (Array.isArray(entity.aliases) &&
        entity.aliases.every((alias) => typeof alias === 'string' && alias.trim())),
    `${label} aliases must be non-empty strings`,
  );
}

function sameEntity(left, right) {
  return ['id', 'name_uk', 'name_en', 'name_de'].every((key) => left[key] === right[key]);
}

function normalizeEntity(entity) {
  const normalizedId = typeof entity.id === 'string' ? entity.id.replaceAll('-', '_') : entity.id;
  return {
    ...entity,
    // Database IDs deliberately accept only underscores. Proposal authors may use
    // a readable kebab-case spelling, which has one deterministic equivalent.
    // Numeric product descriptors still need a legal textual identifier prefix.
    id:
      typeof normalizedId === 'string' && /^\d/.test(normalizedId)
        ? `v_${normalizedId}`
        : normalizedId,
    aliases: [...new Set(entity.aliases ?? [])].sort(),
  };
}

function mergeEntity(existing, incoming, type, key, translationChoices) {
  if (!sameEntity(existing, incoming)) {
    translationChoices.push({
      type,
      key,
      canonical: {
        name_uk: existing.name_uk,
        name_en: existing.name_en,
        name_de: existing.name_de,
      },
      alternate: {
        name_uk: incoming.name_uk,
        name_en: incoming.name_en,
        name_de: incoming.name_de,
      },
    });
  }
  return {
    ...existing,
    aliases: [
      ...new Set([
        ...existing.aliases,
        ...incoming.aliases,
        existing.name_uk,
        existing.name_en,
        existing.name_de,
        incoming.name_uk,
        incoming.name_en,
        incoming.name_de,
      ]),
    ].sort(),
  };
}

function catalogFrom(proposals) {
  const families = new Map();
  const variants = new Map();
  const variantFamilies = new Map();
  const translationChoices = [];
  for (const proposal of proposals.filter((entry) => entry.status === 'ready')) {
    const family = normalizeEntity(proposal.family);
    const existingFamily = families.get(family.id);
    families.set(
      family.id,
      existingFamily
        ? mergeEntity(existingFamily, family, 'family', family.id, translationChoices)
        : family,
    );

    if (proposal.variant === null) continue;
    const variant = normalizeEntity(proposal.variant);
    const existingVariantFamily = variantFamilies.get(variant.id);
    assert(
      existingVariantFamily === undefined || existingVariantFamily === family.id,
      `Variant id ${variant.id} is already assigned to family ${existingVariantFamily}; cannot also assign it to ${family.id}`,
    );
    variantFamilies.set(variant.id, family.id);
    const variantKey = `${family.id}/${variant.id}`;
    const existingVariant = variants.get(variantKey);
    variants.set(
      variantKey,
      existingVariant
        ? mergeEntity(existingVariant, variant, 'variant', variantKey, translationChoices)
        : { ...variant, family_id: family.id },
    );
  }
  return {
    families: [...families.values()].sort((a, b) => a.id.localeCompare(b.id)),
    variants: [...variants.values()].sort(
      (a, b) => a.family_id.localeCompare(b.family_id) || a.id.localeCompare(b.id),
    ),
    translationChoices,
  };
}

function sqlFor({ families, variants, ready }) {
  const familyValues = families
    .map(
      (family) =>
        `(${[family.id, family.name_uk, family.name_en, family.name_de].map(sql).join(', ')}, ${sqlArray(family.aliases)})`,
    )
    .join(',\n');
  const variantValues = variants
    .map(
      (variant) =>
        `(${[variant.id, variant.family_id, variant.name_uk, variant.name_en, variant.name_de]
          .map(sql)
          .join(', ')}, ${sqlArray(variant.aliases)})`,
    )
    .join(',\n');
  const assignmentValues = ready
    .map(
      (entry) =>
        `(${[
          entry.normalized_name,
          entry.family.id,
          entry.variant?.id ?? null,
          entry.brand,
          entry.is_organic,
        ]
          .map(sql)
          .join(', ')})`,
    )
    .join(',\n');

  return `-- Generated from the live inventory and independently reviewed proposals.\n-- Exact normalized-name matches only. Existing taxonomy and original receipt values are preserved.\nbegin;\n\ninsert into public.product_families (id, name_uk, name_en, name_de, aliases)\nvalues\n${familyValues}\non conflict (id) do nothing;\n\ninsert into public.product_variants (id, family_id, name_uk, name_en, name_de, aliases)\nvalues\n${variantValues}\non conflict (id, family_id) do nothing;\n\ncreate temporary table taxonomy_assignment (\n  normalized_name text primary key,\n  family_id text not null references public.product_families(id),\n  variant_id text,\n  brand text,\n  is_organic boolean,\n  foreign key (variant_id, family_id) references public.product_variants(id, family_id)\n) on commit drop;\n\ninsert into taxonomy_assignment (normalized_name, family_id, variant_id, brand, is_organic)\nvalues\n${assignmentValues};\n\n-- Product fields represent the reusable catalogue identity.\nupdate public.products p\nset product_family_id = a.family_id,\n    product_variant_id = a.variant_id\nfrom taxonomy_assignment a\nwhere lower(regexp_replace(btrim(p.name), '\\s+', ' ', 'g')) = a.normalized_name\n  and p.product_family_id is null\n  and p.product_variant_id is null;\n\n-- Brand and Bio are independent attributes: filling a missing value never overwrites a manual one.\nupdate public.products p\nset brand = coalesce(p.brand, a.brand),\n    is_organic = coalesce(p.is_organic, a.is_organic)\nfrom taxonomy_assignment a\nwhere lower(regexp_replace(btrim(p.name), '\\s+', ' ', 'g')) = a.normalized_name\n  and ((p.brand is null and a.brand is not null)\n    or (p.is_organic is null and a.is_organic is not null));\n\n-- Items retain a purchase-time snapshot, including rows not linked to a product.\nupdate public.items i\nset product_family_id = a.family_id,\n    product_variant_id = a.variant_id\nfrom taxonomy_assignment a\nwhere lower(regexp_replace(btrim(i.product_name), '\\s+', ' ', 'g')) = a.normalized_name\n  and i.product_family_id is null\n  and i.product_variant_id is null;\n\ncommit;\n`;
}

function evidenceText(row) {
  const evidence = row.receipt_evidence ?? [];
  if (evidence.length === 0) return '—';
  return evidence
    .map((entry) => `${entry.receipt_date} · ${entry.store} · ${entry.receipt_id}`)
    .join('<br>');
}

function markdownFor({ inventory, proposals }) {
  const byName = new Map(inventory.rows.map((row) => [row.normalized_name, row]));
  const rows = proposals
    .map((proposal) => {
      const source = byName.get(proposal.normalized_name);
      const name =
        source?.item_names?.[0] ?? source?.product_names?.[0] ?? proposal.normalized_name;
      const status =
        proposal.status === 'ready'
          ? 'Готово'
          : proposal.status === 'review'
            ? 'Уточнити'
            : 'Виключено';
      return `| ${name} | ${proposal.family?.name_uk ?? '—'} | ${proposal.variant?.name_uk ?? '—'} | ${proposal.brand ?? '—'} | ${proposal.is_organic === true ? 'Bio' : proposal.is_organic === false ? 'Звичайний' : '—'} | ${status} | ${proposal.rationale} | ${evidenceText(source)} |`;
    })
    .sort((a, b) => a.localeCompare(b, 'uk'));
  return `# Новий backfill таксономії товарів\n\nЗгенеровано з read-only зрізу live БД. Backfill застосовує лише рядки «Готово»; «Уточнити» та «Виключено» не потрапляють до SQL.\n\n| Назва | Сімейство | Варіант | Бренд | Bio | Статус | Підстава | До трьох чеків-джерел |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n`;
}

async function readProposals(batch) {
  const names = [
    `proposals-batch-${batch}-final.json`,
    `proposals-batch-${batch}-reviewed.json`,
    `proposals-batch-${batch}.json`,
  ];
  for (const name of names) {
    try {
      return JSON.parse(await readFile(resolve(outputDirectory, name), 'utf8'));
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  throw new Error(`Missing proposals for batch ${batch}`);
}

const [inventory, ...proposalBatches] = await Promise.all([
  readFile(inventoryPath, 'utf8').then(JSON.parse),
  ...batches.map(readProposals),
]);
const proposals = proposalBatches.flat().map((proposal) => ({
  ...proposal,
  family: proposal.family === null ? null : normalizeEntity(proposal.family),
  variant: proposal.variant === null ? null : normalizeEntity(proposal.variant),
}));
assert(Array.isArray(inventory.rows), 'Inventory must have a rows array');
assert(Array.isArray(proposals), 'Proposal files must contain arrays');

const inventoryNames = new Set(inventory.rows.map((row) => row.normalized_name));
const proposalNames = new Set();
for (const proposal of proposals) {
  assert(typeof proposal.normalized_name === 'string', 'Every proposal needs normalized_name');
  assert(
    inventoryNames.has(proposal.normalized_name),
    `Unknown inventory name: ${proposal.normalized_name}`,
  );
  assert(
    !proposalNames.has(proposal.normalized_name),
    `Duplicate proposal: ${proposal.normalized_name}`,
  );
  proposalNames.add(proposal.normalized_name);
  assert(statuses.has(proposal.status), `Invalid status for ${proposal.normalized_name}`);
  assert(
    typeof proposal.rationale === 'string' && proposal.rationale.trim(),
    `Missing rationale for ${proposal.normalized_name}`,
  );
  assert(
    proposal.brand === null || (typeof proposal.brand === 'string' && proposal.brand.trim()),
    `Invalid brand for ${proposal.normalized_name}`,
  );
  assert(
    proposal.is_organic === null || typeof proposal.is_organic === 'boolean',
    `Invalid Bio state for ${proposal.normalized_name}`,
  );
  if (proposal.status === 'ready') {
    assertEntity(proposal.family, `Family for ${proposal.normalized_name}`);
    if (proposal.variant !== null)
      assertEntity(proposal.variant, `Variant for ${proposal.normalized_name}`);
  } else {
    assert(
      proposal.family === null && proposal.variant === null,
      `Non-ready row ${proposal.normalized_name} must not classify`,
    );
  }
}
assert.deepEqual(
  [...proposalNames].sort(),
  [...inventoryNames].sort(),
  'Proposal coverage does not match live inventory',
);

const ready = proposals
  .filter((proposal) => proposal.status === 'ready')
  .sort((a, b) => a.normalized_name.localeCompare(b.normalized_name));
const catalog = catalogFrom(proposals);
await Promise.all([
  writeFile(
    resolve(outputDirectory, 'proposed-backfill.sql'),
    sqlFor({ ...catalog, ready }).replace(
      'on conflict (id, family_id) do nothing;',
      'on conflict (id) do nothing;',
    ),
    'utf8',
  ),
  writeFile(
    resolve(outputDirectory, 'catalog-review.md'),
    markdownFor({ inventory, proposals }),
    'utf8',
  ),
  writeFile(
    resolve(outputDirectory, 'summary.json'),
    `${JSON.stringify(
      {
        inventory_names: inventory.rows.length,
        ready: ready.length,
        review: proposals.filter((proposal) => proposal.status === 'review').length,
        excluded: proposals.filter((proposal) => proposal.status === 'excluded').length,
        product_families: catalog.families.length,
        product_variants: catalog.variants.length,
        translation_choices: catalog.translationChoices.length,
      },
      null,
      2,
    )}\n`,
    'utf8',
  ),
  writeFile(
    resolve(outputDirectory, 'catalog-translation-choices.json'),
    `${JSON.stringify(catalog.translationChoices, null, 2)}\n`,
    'utf8',
  ),
]);

console.log(
  `Validated ${proposals.length} names; wrote a backfill for ${ready.length} ready rows.`,
);

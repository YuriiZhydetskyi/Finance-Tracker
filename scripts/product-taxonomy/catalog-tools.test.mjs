import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawNames, seedSql, validateCatalog } from './catalog-tools.mjs';

const catalog = {
  families: [
    {
      id: 'tomato',
      name_uk: 'Помідори',
      name_en: 'Tomatoes',
      name_de: 'Tomaten',
      aliases: ['tomato'],
    },
  ],
  variants: [
    {
      id: 'tomato_cherry',
      family_id: 'tomato',
      name_uk: 'Черрі',
      name_en: 'Cherry',
      name_de: 'Cherry',
      aliases: [],
    },
  ],
};
const assignment = {
  source_name: "Tom's tomatoes",
  product_family_id: 'tomato',
  product_variant_id: 'tomato_cherry',
  brand: null,
  is_organic: null,
  status: 'ready',
  reason: null,
};

test('requires exact one-to-one coverage and real parent references', () => {
  assert.deepEqual(validateCatalog(catalog, [assignment], [assignment.source_name]), {
    ready: 1,
    review: 0,
    excluded: 0,
  });
  assert.throws(() => validateCatalog(catalog, [], [assignment.source_name]));
  assert.throws(() => validateCatalog(catalog, [assignment, assignment], [assignment.source_name]));
  assert.throws(() =>
    validateCatalog(
      catalog,
      [{ ...assignment, product_family_id: null }],
      [assignment.source_name],
    ),
  );
});

test('splits only case-equivalent inventory variants', () => {
  assert.deepEqual(rawNames('Coca-Cola 2l / Coca-Cola 2L'), ['Coca-Cola 2l', 'Coca-Cola 2L']);
  assert.deepEqual(rawNames('Feta / Schafskäse'), ['Feta / Schafskäse']);
});

test('rejects numeric placeholders in translated labels', () => {
  assert.throws(
    () =>
      validateCatalog(
        {
          ...catalog,
          variants: [{ ...catalog.variants[0], name_de: '549' }],
        },
        [assignment],
        [assignment.source_name],
      ),
    /readable label/,
  );
});

test('escapes source text and excludes uncertain assignments from the write plan', () => {
  const output = seedSql(catalog, [
    assignment,
    { ...assignment, source_name: 'ambiguous', status: 'review' },
  ]);
  assert(output.includes("'tom''s tomatoes'"));
  assert(!output.includes('ambiguous'));
  assert(output.includes('p.product_family_id is null'));
  assert(output.includes('i.total_orig > 0'));
  assert(!output.includes('set product_name'));
});

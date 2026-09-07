import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inventoryNames, seedSql, validateCatalog } from './catalog-tools.mjs';

const catalog = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));
const assignments = JSON.parse(
  readFileSync(new URL('./assignments.json', import.meta.url), 'utf8'),
);
const names = inventoryNames(
  readFileSync(new URL('../../product-taxonomy-inventory-2026-09-07.md', import.meta.url), 'utf8'),
);
const counts = validateCatalog(catalog, assignments, names);
const output = new URL('./proposed-backfill.sql', import.meta.url);
writeFileSync(output, seedSql(catalog, assignments), 'utf8');
const families = new Map(catalog.families.map((row) => [row.id, row.name_uk]));
const variants = new Map(catalog.variants.map((row) => [row.id, row.name_uk]));
const cell = (value) =>
  String(value ?? '—')
    .replaceAll('|', '\\|')
    .replace(/\r?\n/g, ' ');
const statuses = { ready: 'Готово', review: 'Уточнити', excluded: 'Виключено' };
const review = [
  '# Унікальні товари: запропонована класифікація',
  '',
  'Згенеровано з `catalog.json` та `assignments.json`. Це план, не підтвердження запису в робочу БД.',
  '',
  '«Звичайний» означає робоче припущення для впізнаваних харчів без Bio у назві; «—» — невідомо або незастосовно.',
  '',
  '<!-- prettier-ignore -->',
  '| Назва з покупок | Сімейство | Варіант | Бренд | Bio | Статус | Примітка |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...assignments.map(
    (row) =>
      `| ${[
        row.source_name,
        families.get(row.product_family_id),
        variants.get(row.product_variant_id),
        row.brand,
        row.is_organic === true ? 'Bio' : row.is_organic === false ? 'Звичайний' : null,
        statuses[row.status],
        row.reason,
      ]
        .map(cell)
        .join(' | ')} |`,
  ),
  '',
].join('\n');
writeFileSync(new URL('./catalog-review.md', import.meta.url), review, 'utf8');
console.log(
  JSON.stringify(
    {
      entries: names.length,
      ...counts,
      families: catalog.families.length,
      variants: catalog.variants.length,
      output: fileURLToPath(output),
    },
    null,
    2,
  ),
);

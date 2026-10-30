import { describe, expect, it } from 'vitest';
import { PackagedProductImportSchema } from '@finance-tracker/domain';
import {
  EXAMPLE_PACKAGED_PRODUCT_JSON,
  buildPackagedProductPrompt,
} from './build-packaged-product-prompt';
import { parsePackagingImport } from './packaging-import';

const taxonomy = { families: [], variants: [] };

describe('buildPackagedProductPrompt', () => {
  it('documents the optional review_notes field and its limits', () => {
    const prompt = buildPackagedProductPrompt(['Снеки'], taxonomy);
    expect(prompt).toContain('review_notes');
    expect(prompt).toContain('до 10 коротких рядків');
    expect(prompt).toContain('300 символів');
    expect(prompt).toContain('[] або null');
  });
  it('keeps the example JSON valid for the import contract with an empty review_notes', () => {
    const example = JSON.parse(EXAMPLE_PACKAGED_PRODUCT_JSON) as { products: unknown[] };
    const parsed = PackagedProductImportSchema.parse(example.products[0]);
    expect(parsed.review_notes).toEqual([]);
    expect(EXAMPLE_PACKAGED_PRODUCT_JSON).toContain('"review_notes": []');
  });
  it('documents the optional attributes object, its limits and what does not belong in it', () => {
    const prompt = buildPackagedProductPrompt(['Снеки'], taxonomy);
    expect(prompt).toContain('Правила розділу «Інше» (attributes)');
    expect(prompt).toContain('до 15 пар');
    expect(prompt).toContain('до 60 символів');
    expect(prompt).toContain('до 300 символів');
    for (const key of ['Сорт', 'Калібр', 'Клас', 'Країна походження', 'Виробник']) {
      expect(prompt).toContain(`"${key}"`);
    }
    expect(prompt).toContain('дослівно з етикетки');
    expect(prompt).toContain('Не копіюй значення attributes із прикладу');
    expect(prompt).toContain('{} або null');
  });
  it('keeps the example JSON valid for the import contract with a few attributes', () => {
    const example = JSON.parse(EXAMPLE_PACKAGED_PRODUCT_JSON) as { products: unknown[] };
    const parsed = PackagedProductImportSchema.parse(example.products[0]);
    expect(Object.keys(parsed.attributes).length).toBeGreaterThan(0);
    expect(EXAMPLE_PACKAGED_PRODUCT_JSON).toContain('"attributes": {');
  });
  it('documents the optional receipt summary and forbids transcribing receipt lines', () => {
    const prompt = buildPackagedProductPrompt(['Снеки'], taxonomy);
    expect(prompt).toContain('receipt: необовʼязковий короткий опис чека');
    expect(prompt).toContain('НЕ переписуй позиції чека');
    expect(prompt).toContain('receipt: null');
  });
  it('keeps the whole example, receipt summary included, acceptable to the importer', () => {
    const batch = parsePackagingImport(EXAMPLE_PACKAGED_PRODUCT_JSON, {
      categories: ['Снеки'],
      taxonomy: {
        families: [{ id: 'chips', name_uk: 'Чіпси', name_de: 'Chips' }],
        variants: [],
      },
      existing: [],
    });
    expect(batch.receipt).toEqual({
      store: 'REWE',
      date: '2026-09-13',
      total: 23.45,
      currency: 'EUR',
    });
    expect(batch.receipt_pages).toEqual([1]);
  });
});

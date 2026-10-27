import { describe, expect, it } from 'vitest';
import { PackagedProductImportSchema } from '@finance-tracker/domain';
import {
  EXAMPLE_PACKAGED_PRODUCT_JSON,
  buildPackagedProductPrompt,
} from './build-packaged-product-prompt';

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
});

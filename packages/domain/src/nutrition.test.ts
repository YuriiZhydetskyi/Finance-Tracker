import { describe, expect, it } from 'vitest';
import {
  EU_ALLERGENS,
  isValidGtin,
  normalizeAllergens,
  normalizeBarcode,
  normalizeNutriScore,
  normalizeNutritionBasis,
  normalizePackageUnit,
  roundEnergy,
  roundNutrientGrams,
} from './nutrition';

describe('roundNutrientGrams', () => {
  it('keeps 3 decimals so salt 0.001 g survives', () => {
    expect(roundNutrientGrams(0.0005)).toBe(0.001);
    expect(roundNutrientGrams(1.2345)).toBe(1.235);
    expect(roundNutrientGrams(99.9994)).toBe(99.999);
  });

  it('leaves already-rounded values untouched', () => {
    expect(roundNutrientGrams(31)).toBe(31);
    expect(roundNutrientGrams(0)).toBe(0);
  });
});

describe('roundEnergy', () => {
  it('keeps 1 decimal', () => {
    expect(roundEnergy(523.04)).toBe(523);
    expect(roundEnergy(52.45)).toBe(52.5);
    expect(roundEnergy(2180)).toBe(2180);
  });
});

describe('normalizeBarcode', () => {
  it('strips the spacing printed under the bars', () => {
    expect(normalizeBarcode('5 053990 101658')).toBe('5053990101658');
    expect(normalizeBarcode('40-06381-33393-1')).toBe('4006381333931');
  });

  it('returns an empty string when nothing numeric is left', () => {
    expect(normalizeBarcode('не видно')).toBe('');
  });
});

describe('isValidGtin', () => {
  it('accepts real EAN-13, EAN-8 and UPC-A codes', () => {
    expect(isValidGtin('4006381333931')).toBe(true); // EAN-13
    expect(isValidGtin('5449000000996')).toBe(true); // EAN-13
    expect(isValidGtin('96385074')).toBe(true); // EAN-8
    expect(isValidGtin('036000291452')).toBe(true); // UPC-A
  });

  it('rejects a single corrupted digit', () => {
    expect(isValidGtin('4006381333932')).toBe(false); // check digit off by one
    expect(isValidGtin('5449000010996')).toBe(false); // transcription slip mid-code
  });

  it('rejects non-GTIN lengths and non-digits', () => {
    expect(isValidGtin('12345')).toBe(false);
    expect(isValidGtin('400638133393X')).toBe(false);
    expect(isValidGtin('')).toBe(false);
  });
});

describe('normalizeAllergens', () => {
  it('lowercases, dedupes and returns canonical label order', () => {
    expect(normalizeAllergens(['Milk', 'GLUTEN', 'milk'])).toEqual(['gluten', 'milk']);
  });

  it('drops values outside the EU FIC list', () => {
    expect(normalizeAllergens(['milk', 'kiwi', 'вершки'])).toEqual(['milk']);
  });

  it('returns an empty array for an empty input', () => {
    expect(normalizeAllergens([])).toEqual([]);
  });

  it('preserves the declared allergen order for a full list', () => {
    expect(normalizeAllergens([...EU_ALLERGENS].reverse())).toEqual([...EU_ALLERGENS]);
  });
});

describe('normalizeNutritionBasis', () => {
  it('accepts the spellings a model actually returns', () => {
    expect(normalizeNutritionBasis('per_100_g')).toBe('per_100_g');
    expect(normalizeNutritionBasis('per 100 g')).toBe('per_100_g');
    expect(normalizeNutritionBasis('per100ml')).toBe('per_100_ml');
    expect(normalizeNutritionBasis('pro 100 g')).toBe('per_100_g');
  });

  it('returns null for a per-serving basis so it fails loudly', () => {
    expect(normalizeNutritionBasis('per serving')).toBeNull();
    expect(normalizeNutritionBasis('на порцію')).toBeNull();
  });
});

describe('normalizePackageUnit', () => {
  it('maps German and Ukrainian unit spellings onto product_unit', () => {
    expect(normalizePackageUnit('g')).toBe('g');
    expect(normalizePackageUnit('Gramm')).toBe('g');
    expect(normalizePackageUnit('г')).toBe('g');
    expect(normalizePackageUnit('мл')).toBe('ml');
    expect(normalizePackageUnit('Stück')).toBe('pcs');
    expect(normalizePackageUnit('шт.')).toBe('pcs');
  });

  it('returns null for an unknown unit', () => {
    expect(normalizePackageUnit('portion')).toBeNull();
    expect(normalizePackageUnit('')).toBeNull();
  });
});

describe('normalizeNutriScore', () => {
  it('is case-insensitive', () => {
    expect(normalizeNutriScore('d')).toBe('D');
    expect(normalizeNutriScore(' A ')).toBe('A');
  });

  it('rejects anything outside A-E', () => {
    expect(normalizeNutriScore('F')).toBeNull();
    expect(normalizeNutriScore('добре')).toBeNull();
  });
});

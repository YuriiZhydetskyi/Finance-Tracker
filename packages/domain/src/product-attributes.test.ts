import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_KEY_MAX_LENGTH,
  ATTRIBUTE_VALUE_MAX_LENGTH,
  CARD_ATTRIBUTES_MAX,
  attributeEntries,
  attributeKeyIdentity,
  attributePairProblem,
  attributesFromJson,
  mergeAttributes,
  normalizeAttributes,
  sameAttributes,
} from './product-attributes';

describe('attributeKeyIdentity', () => {
  it('ignores case and repeated whitespace', () => {
    expect(attributeKeyIdentity('  Країна   Походження ')).toBe('країна походження');
  });
});

describe('normalizeAttributes', () => {
  it('treats absent, null and empty input as nothing recorded', () => {
    expect(normalizeAttributes(undefined)).toEqual({});
    expect(normalizeAttributes(null)).toEqual({});
    expect(normalizeAttributes({})).toEqual({});
  });

  it('trims keys and values', () => {
    expect(normalizeAttributes({ '  Сорт ': '  Jonagold\n' })).toEqual({ Сорт: 'Jonagold' });
  });

  it('drops a pair with a blank key or a blank value', () => {
    expect(
      normalizeAttributes({ '': 'x', '   ': 'y', Сорт: '', Клас: '  ', Калібр: '65–70 мм' }),
    ).toEqual({ Калібр: '65–70 мм' });
  });

  it('drops null and values that are not text or a number', () => {
    expect(
      normalizeAttributes({ Сорт: null, Bio: true, Список: ['a'], Об: { a: 1 }, Клас: 'I' }),
    ).toEqual({ Клас: 'I' });
  });

  it('writes a number as its text', () => {
    expect(normalizeAttributes({ Клас: 1, Вага: 0.5 })).toEqual({ Клас: '1', Вага: '0.5' });
  });

  it('keeps the first pair of keys that differ only by case or spacing, and the input order', () => {
    const result = normalizeAttributes({
      Сорт: 'Jonagold',
      'Країна  походження': 'Німеччина',
      сорт: 'Gala',
      'країна походження': 'Польща',
      Калібр: '65–70 мм',
    });
    expect(result).toEqual({
      Сорт: 'Jonagold',
      'Країна  походження': 'Німеччина',
      Калібр: '65–70 мм',
    });
    expect(Object.keys(result)).toEqual(['Сорт', 'Країна  походження', 'Калібр']);
  });
});

describe('mergeAttributes', () => {
  it('adds only keys the card does not have yet', () => {
    expect(mergeAttributes({ Сорт: 'Jonagold' }, { Калібр: '65–70 мм', Клас: 'I' })).toEqual({
      Сорт: 'Jonagold',
      Калібр: '65–70 мм',
      Клас: 'I',
    });
  });

  it('never overwrites a value already on the card, whatever the case of the key', () => {
    expect(
      mergeAttributes({ Сорт: 'Jonagold (виправлено вручну)' }, { сорт: 'Jonagold', 'СОРТ ': 'x' }),
    ).toEqual({ Сорт: 'Jonagold (виправлено вручну)' });
  });

  it('keeps the stored pairs exactly as they are', () => {
    const stored = { 'Країна  походження': 'Німеччина' };
    expect(mergeAttributes(stored, { Клас: 'I' })).toEqual({
      'Країна  походження': 'Німеччина',
      Клас: 'I',
    });
  });

  it('is idempotent, so replaying a save never changes the card', () => {
    const once = mergeAttributes({ Сорт: 'Jonagold' }, { Калібр: '65–70 мм' });
    expect(mergeAttributes(once, { Калібр: '65–70 мм' })).toEqual(once);
  });

  it('accepts a card without attributes and an import without attributes', () => {
    expect(mergeAttributes(undefined, { Сорт: 'Gala' })).toEqual({ Сорт: 'Gala' });
    expect(mergeAttributes({ Сорт: 'Gala' }, null)).toEqual({ Сорт: 'Gala' });
    expect(mergeAttributes({}, {})).toEqual({});
  });

  it('does not mutate its inputs', () => {
    const stored = { Сорт: 'Gala' };
    mergeAttributes(stored, { Клас: 'I' });
    expect(stored).toEqual({ Сорт: 'Gala' });
  });

  it('does not truncate: the per-card limit is the caller’s decision', () => {
    const many = Object.fromEntries(
      Array.from({ length: CARD_ATTRIBUTES_MAX }, (_, i) => [`ключ ${String(i)}`, 'значення']),
    );
    expect(Object.keys(mergeAttributes(many, { ще: 'одне' }))).toHaveLength(
      CARD_ATTRIBUTES_MAX + 1,
    );
  });
});

describe('sameAttributes', () => {
  it('compares keys and values, not their order', () => {
    expect(sameAttributes({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
    expect(sameAttributes({ a: '1' }, { a: '2' })).toBe(false);
    expect(sameAttributes({ a: '1' }, { a: '1', b: '2' })).toBe(false);
    expect(sameAttributes({ a: '1' }, { b: '1' })).toBe(false);
  });
});

describe('attributesFromJson', () => {
  it('reads the string pairs of an object', () => {
    expect(attributesFromJson({ Сорт: 'Jonagold', Клас: 'I' })).toEqual({
      Сорт: 'Jonagold',
      Клас: 'I',
    });
  });

  it('skips anything that is not a string pair instead of throwing', () => {
    expect(attributesFromJson({ Сорт: 'Gala', Клас: 1, Bio: null })).toEqual({ Сорт: 'Gala' });
    expect(attributesFromJson(null)).toEqual({});
    expect(attributesFromJson(undefined)).toEqual({});
    expect(attributesFromJson([])).toEqual({});
    expect(attributesFromJson('Сорт')).toEqual({});
  });
});

describe('attributeEntries', () => {
  it('orders the pairs alphabetically, so the display does not depend on jsonb', () => {
    expect(
      attributeEntries({ Походження: 'ЄС', Клас: 'I', Калібр: '65–70 мм', Сорт: 'Gala' }).map(
        ([key]) => key,
      ),
    ).toEqual(['Калібр', 'Клас', 'Походження', 'Сорт']);
  });
});

describe('attributePairProblem', () => {
  it('accepts the limits and rejects one past them', () => {
    expect(
      attributePairProblem(
        'к'.repeat(ATTRIBUTE_KEY_MAX_LENGTH),
        'я'.repeat(ATTRIBUTE_VALUE_MAX_LENGTH),
      ),
    ).toBeNull();
    expect(attributePairProblem('к'.repeat(ATTRIBUTE_KEY_MAX_LENGTH + 1), 'x')).toMatch(/Key/);
    expect(attributePairProblem('k', 'я'.repeat(ATTRIBUTE_VALUE_MAX_LENGTH + 1))).toMatch(/Value/);
  });

  it('rejects blank and padded text, because the database does too', () => {
    expect(attributePairProblem('', 'x')).toMatch(/Key/);
    expect(attributePairProblem(' k', 'x')).toMatch(/Key/);
    expect(attributePairProblem('k', '')).toMatch(/Value/);
    expect(attributePairProblem('k', 'x ')).toMatch(/Value/);
  });
});

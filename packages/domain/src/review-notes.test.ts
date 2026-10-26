import { describe, expect, it } from 'vitest';
import {
  CARD_REVIEW_NOTES_MAX,
  mergeReviewNotes,
  normalizeReviewNotes,
  sameReviewNotes,
} from './review-notes';

describe('normalizeReviewNotes', () => {
  it('treats absent, null and empty input as nothing to check', () => {
    expect(normalizeReviewNotes(undefined)).toEqual([]);
    expect(normalizeReviewNotes(null)).toEqual([]);
    expect(normalizeReviewNotes([])).toEqual([]);
  });

  it('trims and drops blank entries', () => {
    expect(normalizeReviewNotes(['  Нечіткий штрихкод  ', '', '   ', '\n\t'])).toEqual([
      'Нечіткий штрихкод',
    ]);
  });

  it('drops duplicates ignoring case and spacing, keeping the first wording and order', () => {
    expect(
      normalizeReviewNotes([
        'Нечіткий штрихкод',
        'Збіг з чеком  неоднозначний',
        'нечіткий  ШТРИХКОД',
      ]),
    ).toEqual(['Нечіткий штрихкод', 'Збіг з чеком  неоднозначний']);
    expect(normalizeReviewNotes(['a b', 'A   B'])).toEqual(['a b']);
  });
});

describe('mergeReviewNotes', () => {
  it('keeps every existing note and appends only new incoming ones', () => {
    expect(
      mergeReviewNotes(
        ['Перевірити штрихкод'],
        ['перевірити  штрихкод', 'Немає таблиці поживності'],
      ),
    ).toEqual(['Перевірити штрихкод', 'Немає таблиці поживності']);
  });

  it('is idempotent, so replaying a save never grows the list', () => {
    const once = mergeReviewNotes(['A'], ['B', 'C']);
    expect(mergeReviewNotes(once, ['B', 'C'])).toEqual(once);
  });

  it('accepts a card without notes and an import without notes', () => {
    expect(mergeReviewNotes(undefined, ['A'])).toEqual(['A']);
    expect(mergeReviewNotes(['A'], null)).toEqual(['A']);
    expect(mergeReviewNotes([], [])).toEqual([]);
  });

  it('does not truncate: the per-card limit is the caller’s decision', () => {
    const many = Array.from({ length: CARD_REVIEW_NOTES_MAX }, (_, i) => `existing ${String(i)}`);
    expect(mergeReviewNotes(many, ['one more'])).toHaveLength(CARD_REVIEW_NOTES_MAX + 1);
  });
});

describe('sameReviewNotes', () => {
  it('compares order-sensitively', () => {
    expect(sameReviewNotes(['A', 'B'], ['A', 'B'])).toBe(true);
    expect(sameReviewNotes(['A', 'B'], ['B', 'A'])).toBe(false);
    expect(sameReviewNotes(['A'], ['A', 'B'])).toBe(false);
  });
});

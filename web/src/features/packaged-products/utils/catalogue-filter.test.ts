import { describe, expect, it } from 'vitest';
import { filterCatalogue, needsReview } from './catalogue-filter';

const pringles = {
  name: 'Pringles Original 165 г',
  brand: 'Pringles',
  barcode: '5053990101658',
  review_notes: ['Штрихкод розмитий'],
  attributes: {},
};
const milk = { name: 'Молоко 1 л', brand: null, barcode: null, review_notes: [], attributes: {} };
const paprika = {
  name: 'Pringles Paprika',
  brand: 'Pringles',
  barcode: null,
  review_notes: ['Немає звороту', 'Смак під питанням'],
  attributes: {},
};
const apples = {
  name: 'Яблука 1 кг',
  brand: null,
  barcode: null,
  review_notes: [],
  attributes: { Сорт: 'Jonagold', 'Країна походження': 'Німеччина' },
};
const catalogue = [pringles, milk, paprika];

describe('needsReview', () => {
  it('is true only for a non-empty list of notes', () => {
    expect(needsReview(pringles)).toBe(true);
    expect(needsReview(milk)).toBe(false);
  });
});

describe('filterCatalogue', () => {
  it('returns everything without a query or filter', () => {
    expect(filterCatalogue(catalogue, { query: '  ', onlyNeedingReview: false })).toEqual(
      catalogue,
    );
  });
  it('keeps only cards that need a check', () => {
    expect(filterCatalogue(catalogue, { query: '', onlyNeedingReview: true })).toEqual([
      pringles,
      paprika,
    ]);
  });
  it('searches name, brand and barcode case-insensitively', () => {
    expect(filterCatalogue(catalogue, { query: 'МОЛОКО', onlyNeedingReview: false })).toEqual([
      milk,
    ]);
    expect(filterCatalogue(catalogue, { query: 'pringles', onlyNeedingReview: false })).toEqual([
      pringles,
      paprika,
    ]);
    expect(filterCatalogue(catalogue, { query: '5053990', onlyNeedingReview: false })).toEqual([
      pringles,
    ]);
  });
  it('finds a card by a value of «Інше», case-insensitively', () => {
    const all = [...catalogue, apples];
    expect(filterCatalogue(all, { query: 'jonagold', onlyNeedingReview: false })).toEqual([apples]);
    expect(filterCatalogue(all, { query: 'НІМЕЧЧИНА', onlyNeedingReview: false })).toEqual([
      apples,
    ]);
  });
  it('does not match the names of the «Інше» pairs, only their values', () => {
    expect(filterCatalogue([apples], { query: 'сорт', onlyNeedingReview: false })).toEqual([]);
  });
  it('combines the text search with the review filter', () => {
    expect(filterCatalogue(catalogue, { query: 'paprika', onlyNeedingReview: true })).toEqual([
      paprika,
    ]);
    expect(filterCatalogue(catalogue, { query: 'молоко', onlyNeedingReview: true })).toEqual([]);
  });
});

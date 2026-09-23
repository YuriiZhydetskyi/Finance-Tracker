import { describe, expect, it, vi } from 'vitest';
import { enrichSavedImportTaxonomy } from './taxonomy-enrichment.ts';
import type { WorkerDeps } from './types.ts';

type DbResult = { data: unknown; error: unknown };
type Update = { table: string; patch: unknown; id: unknown };

function createFakeDb(answers: { items?: DbResult; products?: DbResult }) {
  const selects: string[] = [];
  const updates: Update[] = [];

  function from(table: string) {
    let patch: unknown = null;
    let id: unknown = null;
    const builder = {
      select: () => {
        selects.push(table);
        return builder;
      },
      update: (value: unknown) => {
        patch = value;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        if (column === 'id') id = value;
        return builder;
      },
      in: () => builder,
      then: (resolve: (result: DbResult) => unknown) => {
        if (patch !== null) {
          updates.push({ table, patch, id });
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        const result =
          (table === 'items' ? answers.items : answers.products) ??
          ({ data: [], error: null } satisfies DbResult);
        return Promise.resolve(result).then(resolve);
      },
    };
    return builder;
  }

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = { db: { from }, log } as unknown as Pick<WorkerDeps, 'db' | 'log'>;
  return { deps, selects, updates, log };
}

const receipt = { id: 'R1', store: 'Rewe' };

describe('enrichSavedImportTaxonomy', () => {
  it('fills empty product attributes and unclassified items from merged suggestions', async () => {
    const fake = createFakeDb({
      items: {
        data: [
          {
            id: 'I1',
            product_id: 'P1',
            product_name: 'Milch',
            store_product_code: '123',
            product_family_id: null,
            product_variant_id: null,
          },
          {
            id: 'I2',
            product_id: 'P1',
            product_name: 'Milch 2',
            store_product_code: '123',
            product_family_id: 'milk',
            product_variant_id: null,
          },
        ],
        error: null,
      },
      products: {
        data: [
          {
            id: 'P1',
            product_family_id: null,
            product_variant_id: null,
            brand: null,
            is_organic: null,
          },
        ],
        error: null,
      },
    });

    await enrichSavedImportTaxonomy(fake.deps, receipt, [
      {
        product_name: 'Milch',
        store_product_code: '123',
        product_family_id: 'milk',
        product_variant_id: 'whole',
        brand: 'Weihenstephan',
        is_organic: true,
      },
      {
        product_name: 'Milch 2',
        store_product_code: '123',
        product_family_id: 'milk',
        product_variant_id: 'whole',
        brand: null,
        is_organic: null,
      },
    ]);

    expect(fake.updates).toEqual([
      {
        table: 'products',
        id: 'P1',
        patch: {
          product_family_id: 'milk',
          product_variant_id: 'whole',
          brand: 'Weihenstephan',
          is_organic: true,
        },
      },
      {
        table: 'items',
        id: 'I1',
        patch: { product_family_id: 'milk', product_variant_id: 'whole' },
      },
    ]);
  });

  it('keeps existing product values and drops disagreeing suggestions', async () => {
    const fake = createFakeDb({
      items: {
        data: [
          {
            id: 'I1',
            product_id: 'P1',
            product_name: 'Brot',
            store_product_code: null,
            product_family_id: null,
            product_variant_id: null,
          },
        ],
        error: null,
      },
      products: {
        data: [
          {
            id: 'P1',
            product_family_id: 'bread',
            product_variant_id: 'rye',
            brand: null,
            is_organic: false,
          },
        ],
        error: null,
      },
    });

    await enrichSavedImportTaxonomy(fake.deps, receipt, [
      {
        product_name: 'Brot',
        store_product_code: '  ',
        product_family_id: 'toast',
        product_variant_id: null,
        brand: 'Harry',
        is_organic: true,
      },
      {
        product_name: 'Brot',
        store_product_code: null,
        product_family_id: 'toast',
        product_variant_id: null,
        brand: 'Lieken',
        is_organic: true,
      },
    ]);

    expect(fake.updates).toEqual([
      {
        table: 'items',
        id: 'I1',
        patch: { product_family_id: 'bread', product_variant_id: 'rye' },
      },
    ]);
  });

  it('does not touch the database without a usable suggestion', async () => {
    const fake = createFakeDb({});

    await enrichSavedImportTaxonomy(fake.deps, receipt, [
      { product_name: 'Wasser', product_family_id: null, brand: '  ', is_organic: null },
    ]);
    await enrichSavedImportTaxonomy(fake.deps, { id: null, store: 'Rewe' }, [
      { product_name: 'Wasser', product_family_id: 'water' },
    ]);

    expect(fake.selects).toEqual([]);
    expect(fake.updates).toEqual([]);
  });

  it('stops with a warning when a lookup fails', async () => {
    const itemsFailure = createFakeDb({ items: { data: null, error: { message: 'down' } } });
    await enrichSavedImportTaxonomy(itemsFailure.deps, receipt, [
      { product_name: 'Milch', product_family_id: 'milk' },
    ]);
    expect(itemsFailure.selects).toEqual(['items']);
    expect(itemsFailure.log.warn).toHaveBeenCalledWith(
      '[process-receipt-imports] taxonomy item lookup failed',
      'R1',
    );

    const productsFailure = createFakeDb({
      items: {
        data: [
          {
            id: 'I1',
            product_id: 'P1',
            product_name: 'Milch',
            store_product_code: null,
            product_family_id: null,
            product_variant_id: null,
          },
        ],
        error: null,
      },
      products: { data: null, error: { message: 'down' } },
    });
    await enrichSavedImportTaxonomy(productsFailure.deps, receipt, [
      { product_name: 'Milch', product_family_id: 'milk' },
    ]);
    expect(productsFailure.updates).toEqual([]);
    expect(productsFailure.log.warn).toHaveBeenCalledWith(
      '[process-receipt-imports] taxonomy product lookup failed',
      'R1',
    );
  });
});

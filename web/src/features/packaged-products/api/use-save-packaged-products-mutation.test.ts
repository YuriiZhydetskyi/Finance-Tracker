import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePackagingImport } from '../utils/packaging-import';
import { createPackagingSavePlan, savePackagingPlan } from './use-save-packaged-products-mutation';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  tables: new Map<string, Row[]>(),
  objects: new Set<string>(),
  failUpload: false,
  losePhotoReply: false,
  uploads: 0,
}));

vi.mock('@/shared/lib/dependencies', () => ({
  authService: { getCurrentUser: () => Promise.resolve({ email: 'test@example.com' }) },
  packagingPhotoStorage: {
    uploadToPath: (_blob: Blob, path: string) => {
      state.uploads++;
      if (state.failUpload) return Promise.reject(new Error('Upload failed'));
      if (state.objects.has(path)) return Promise.reject(new Error('Object already exists'));
      state.objects.add(path);
      return Promise.resolve();
    },
    getSignedUrl: (path: string) => {
      if (!state.objects.has(path)) return Promise.reject(new Error('Missing'));
      return Promise.resolve('https://storage.test/photo');
    },
  },
}));

// Model the external PostgREST contract, including a committed write whose reply
// was lost. Assertions below observe user records, not builder call ordering.
vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      let action = 'select';
      let body: Row = {};
      let conflict = 'id';
      let single = false;
      const filters: [string, unknown][] = [];
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return builder;
        },
        is: (key: string, value: unknown) => {
          filters.push([key, value]);
          return builder;
        },
        single: () => {
          single = true;
          return builder;
        },
        maybeSingle: () => {
          single = true;
          return builder;
        },
        upsert: (value: Row, options: { onConflict: string }) => {
          action = 'upsert';
          body = value;
          conflict = options.onConflict;
          return builder;
        },
        update: (value: Row) => {
          action = 'update';
          body = value;
          return builder;
        },
        then: (resolve: (value: { data: Row | Row[] | null; error: Error | null }) => unknown) => {
          const rows = state.tables.get(table) ?? [];
          state.tables.set(table, rows);
          const matches = rows.filter((row) => filters.every(([key, value]) => row[key] === value));
          if (action === 'upsert' && !rows.some((row) => row[conflict] === body[conflict]))
            rows.push({ ...body });
          if (action === 'update') for (const row of matches) Object.assign(row, body);
          if (table === 'packaged_product_photos' && action === 'upsert' && state.losePhotoReply) {
            state.losePhotoReply = false;
            return resolve({ data: null, error: new Error('Reply lost after commit') });
          }
          return resolve({ data: single ? (matches[0] ?? null) : matches, error: null });
        },
      };
      return builder;
    },
  },
}));

function plan() {
  const batch = parsePackagingImport(
    JSON.stringify({
      name: 'Pringles',
      category: 'Снеки',
      source_pages: [{ page: 2, kind: 'front' }],
    }),
    {
      categories: ['Снеки'],
      taxonomy: { families: [], variants: [] },
      existing: [],
    },
  );
  const product = batch.products[0];
  if (!product) throw new Error('Fixture');
  product.link_product_ids = ['store-row'];
  return createPackagingSavePlan(batch.products, {
    file_name: 'shopping.pdf',
    fingerprint: 'sha',
    receipt_pages: [1],
    pages: new Map([[2, new Blob(['jpeg'], { type: 'image/jpeg' })]]),
  });
}

beforeEach(() => {
  state.tables.clear();
  state.objects.clear();
  state.uploads = 0;
  state.failUpload = false;
  state.losePhotoReply = false;
  state.tables.set('products', [{ id: 'store-row', packaged_product_id: null }]);
});

describe('saving packaging evidence', () => {
  it('does not remove a store label from the queue before requested photos are saved, and retry creates no duplicates', async () => {
    const pending = plan();
    state.failUpload = true;
    await expect(savePackagingPlan(pending)).rejects.toThrow('Upload failed');
    expect(state.tables.get('products')?.[0]?.packaged_product_id).toBeNull();
    state.failUpload = false;
    await savePackagingPlan(pending);
    await savePackagingPlan(pending);
    expect(state.tables.get('packaged_products')).toHaveLength(1);
    expect(state.tables.get('packaged_product_photos')).toHaveLength(1);
    expect(state.objects.size).toBe(1);
    expect(state.tables.get('products')?.[0]?.packaged_product_id).toBe(pending[0]?.id);
  });
  it('recovers a lost database reply without deleting the uploaded photo', async () => {
    const pending = plan();
    state.losePhotoReply = true;
    await expect(savePackagingPlan(pending)).rejects.toThrow();
    expect(state.objects.size).toBe(1);
    await savePackagingPlan(pending);
    expect(state.uploads).toBe(1);
    expect(state.tables.get('packaged_product_photos')).toHaveLength(1);
    expect(state.tables.get('products')?.[0]?.packaged_product_id).toBe(pending[0]?.id);
  });
  it('never overwrites a store mapping changed by somebody else during review', async () => {
    const pending = plan();
    state.tables.set('products', [{ id: 'store-row', packaged_product_id: 'other-card' }]);
    await expect(savePackagingPlan(pending)).rejects.toThrow('іншої картки');
    expect(state.tables.get('products')?.[0]?.packaged_product_id).toBe('other-card');
  });
  it('does not overwrite existing nutrition when adding PDF photos', async () => {
    const pending = plan();
    const entry = pending[0];
    if (!entry) throw new Error('Fixture');
    state.tables.set('packaged_products', [{ id: entry.id, energy_kcal: 123 }]);
    entry.row = null;
    await savePackagingPlan(pending);
    expect(state.tables.get('packaged_products')).toEqual([{ id: entry.id, energy_kcal: 123 }]);
    expect(state.tables.get('packaged_product_photos')).toHaveLength(1);
  });
});

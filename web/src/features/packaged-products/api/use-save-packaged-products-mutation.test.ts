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

function plan(extra: Record<string, unknown> = {}) {
  const batch = parsePackagingImport(
    JSON.stringify({
      name: 'Pringles',
      category: 'Снеки',
      source_pages: [{ page: 2, kind: 'front' }],
      ...extra,
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

  describe('review notes', () => {
    function reuseCard(stored: Record<string, unknown>, incoming: string[]) {
      const pending = plan({ review_notes: incoming });
      const entry = pending[0];
      if (!entry) throw new Error('Fixture');
      state.tables.set('packaged_products', [{ id: entry.id, ...stored }]);
      entry.row = null;
      return pending;
    }

    it('stores the notes with a new card', async () => {
      const pending = plan({ review_notes: ['  Штрихкод розмитий ', 'Немає звороту'] });
      await savePackagingPlan(pending);
      expect(state.tables.get('packaged_products')?.[0]?.review_notes).toEqual([
        'Штрихкод розмитий',
        'Немає звороту',
      ]);
    });
    it('merges new notes into a reused card without duplicates and keeps nutrition and name', async () => {
      const pending = reuseCard(
        { name: 'Стара назва', energy_kcal: 123, review_notes: ['Штрихкод розмитий'] },
        ['штрихкод  розмитий', 'Немає звороту'],
      );
      await savePackagingPlan(pending);
      expect(state.tables.get('packaged_products')).toEqual([
        {
          id: pending[0]?.id,
          name: 'Стара назва',
          energy_kcal: 123,
          review_notes: ['Штрихкод розмитий', 'Немає звороту'],
        },
      ]);
    });
    it('adds notes to a reused card that had none', async () => {
      const pending = reuseCard({ energy_kcal: 123, review_notes: [] }, ['Немає звороту']);
      await savePackagingPlan(pending);
      expect(state.tables.get('packaged_products')?.[0]?.review_notes).toEqual(['Немає звороту']);
    });
    it('does not touch a reused card when the import has no notes', async () => {
      const pending = reuseCard({ energy_kcal: 123, review_notes: ['Стара'] }, []);
      await savePackagingPlan(pending);
      expect(state.tables.get('packaged_products')).toEqual([
        { id: pending[0]?.id, energy_kcal: 123, review_notes: ['Стара'] },
      ]);
    });
    it('is idempotent when the same save is replayed', async () => {
      const pending = reuseCard({ review_notes: ['Стара'] }, ['Нова']);
      await savePackagingPlan(pending);
      await savePackagingPlan(pending);
      expect(state.tables.get('packaged_products')?.[0]?.review_notes).toEqual(['Стара', 'Нова']);
    });
    it('refuses to drop a note when the card would exceed the per-card limit', async () => {
      const stored = Array.from({ length: 49 }, (_, i) => `Стара ${String(i)}`);
      const pending = reuseCard({ review_notes: stored }, ['Нова 1', 'Нова 2']);
      await expect(savePackagingPlan(pending)).rejects.toThrow('максимум 50');
      expect(state.tables.get('packaged_products')?.[0]?.review_notes).toEqual(stored);
      expect(state.tables.get('packaged_product_photos') ?? []).toHaveLength(0);
    });
  });

  describe('attributes («Інше»)', () => {
    function reuseCardWithAttributes(
      stored: Record<string, unknown>,
      incoming: Record<string, unknown>,
      extra: Record<string, unknown> = {},
    ) {
      const pending = plan({ attributes: incoming, ...extra });
      const entry = pending[0];
      if (!entry) throw new Error('Fixture');
      state.tables.set('packaged_products', [{ id: entry.id, ...stored }]);
      entry.row = null;
      return pending;
    }

    it('stores the pairs with a new card', async () => {
      const pending = plan({ attributes: { ' Сорт ': ' Jonagold ', Калібр: '65–70 мм' } });
      await savePackagingPlan(pending);
      expect(state.tables.get('packaged_products')?.[0]?.attributes).toEqual({
        Сорт: 'Jonagold',
        Калібр: '65–70 мм',
      });
    });
    it('stores an empty object when the import has no attributes', async () => {
      await savePackagingPlan(plan());
      expect(state.tables.get('packaged_products')?.[0]?.attributes).toEqual({});
    });
    it('adds new keys to a reused card and never overwrites a value already there', async () => {
      const pending = reuseCardWithAttributes(
        { name: 'Стара назва', energy_kcal: 123, attributes: { Сорт: 'Jonagold (виправлено)' } },
        { сорт: 'Gala', Калібр: '65–70 мм' },
      );
      await savePackagingPlan(pending);
      expect(state.tables.get('packaged_products')).toEqual([
        {
          id: pending[0]?.id,
          name: 'Стара назва',
          energy_kcal: 123,
          attributes: { Сорт: 'Jonagold (виправлено)', Калібр: '65–70 мм' },
        },
      ]);
    });
    it('adds pairs to a reused card that had none', async () => {
      const pending = reuseCardWithAttributes({ attributes: {} }, { Клас: 'I' });
      await savePackagingPlan(pending);
      expect(state.tables.get('packaged_products')?.[0]?.attributes).toEqual({ Клас: 'I' });
    });
    it('does not touch a reused card when every key is already there', async () => {
      const pending = reuseCardWithAttributes(
        { energy_kcal: 123, attributes: { Сорт: 'Jonagold' } },
        { Сорт: 'Gala' },
      );
      await savePackagingPlan(pending);
      expect(state.tables.get('packaged_products')).toEqual([
        { id: pending[0]?.id, energy_kcal: 123, attributes: { Сорт: 'Jonagold' } },
      ]);
    });
    it('does not touch a reused card when the import has no attributes', async () => {
      const pending = reuseCardWithAttributes({ attributes: { Сорт: 'Jonagold' } }, {});
      await savePackagingPlan(pending);
      expect(state.tables.get('packaged_products')).toEqual([
        { id: pending[0]?.id, attributes: { Сорт: 'Jonagold' } },
      ]);
    });
    it('reads a reused card without the column as having no pairs', async () => {
      const pending = reuseCardWithAttributes({ energy_kcal: 123 }, { Сорт: 'Gala' });
      await savePackagingPlan(pending);
      expect(state.tables.get('packaged_products')?.[0]?.attributes).toEqual({ Сорт: 'Gala' });
    });
    it('is idempotent when the same save is replayed', async () => {
      const pending = reuseCardWithAttributes({ attributes: { Сорт: 'Jonagold' } }, { Клас: 'I' });
      await savePackagingPlan(pending);
      await savePackagingPlan(pending);
      expect(state.tables.get('packaged_products')?.[0]?.attributes).toEqual({
        Сорт: 'Jonagold',
        Клас: 'I',
      });
    });
    it('merges notes and pairs into the same card', async () => {
      const pending = reuseCardWithAttributes(
        { review_notes: ['Стара'], attributes: { Сорт: 'Jonagold' } },
        { Клас: 'I' },
        { review_notes: ['Нова'] },
      );
      await savePackagingPlan(pending);
      expect(state.tables.get('packaged_products')?.[0]).toMatchObject({
        review_notes: ['Стара', 'Нова'],
        attributes: { Сорт: 'Jonagold', Клас: 'I' },
      });
    });
    it('refuses to drop a pair when the card would exceed the per-card limit', async () => {
      const stored = Object.fromEntries(
        Array.from({ length: 29 }, (_, i) => [`Стара ${String(i)}`, 'значення']),
      );
      const pending = reuseCardWithAttributes({ attributes: stored }, { Нова1: 'a', Нова2: 'b' });
      await expect(savePackagingPlan(pending)).rejects.toThrow('максимум 30');
      expect(state.tables.get('packaged_products')?.[0]?.attributes).toEqual(stored);
      expect(state.tables.get('packaged_product_photos') ?? []).toHaveLength(0);
    });
    it('leaves the notes alone when the pairs overflow, so the card is never half merged', async () => {
      const stored = Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [`Стара ${String(i)}`, 'значення']),
      );
      const pending = reuseCardWithAttributes(
        { review_notes: ['Стара'], attributes: stored },
        { Нова: 'a' },
        { review_notes: ['Нова причина'] },
      );
      await expect(savePackagingPlan(pending)).rejects.toThrow('максимум 30');
      expect(state.tables.get('packaged_products')?.[0]?.review_notes).toEqual(['Стара']);
    });
  });
});

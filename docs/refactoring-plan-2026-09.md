# План рефакторингу (вересень 2026)

> Виконавчий план для coding-агента. Кожен крок самодостатній: мета, файли,
> що саме змінити, як перевірити, коли вважати готовим. Кроки виконуються
> по одному, кожен — окремий PR. Підстава: code review від 2026-09-19
> (842 тести зелені, 0 порушень boundary, але 12 слабких місць в архітектурі
> та коді).

## 0. Правила для виконавця

1. Перед стартом прочитай `CLAUDE.md` (розділи «Ports & adapters», «Before
   declaring code changes done», «Schema evolution rule») і `AGENTS.md`
   (порядок довіри при розбіжностях між docs і кодом).
2. Один крок = одна гілка = один PR. Назви гілок: `refactor/<крок>` (напр.
   `refactor/save-receipt-rpc`). Не змішуй кроки.
3. Після кожного кроку обовʼязково запусти з кореня репо:

   ```powershell
   npm run lint
   npm run typecheck
   npm run test
   ```

   Усі три мають бути зеленими. Для Edge Functions додатково:

   ```powershell
   deno check supabase/functions/parse-receipt/index.ts
   deno check supabase/functions/process-receipt-imports/index.ts
   deno lint supabase/functions
   ```

4. Не змінюй закомічені міграції. Нова поведінка БД = новий файл у
   `supabase/migrations/` з іменем `YYYYMMDDHHMMSS_<name>.sql`.
5. Не редагуй `web/src/shared/types/database.types.ts` вручну. Якщо крок
   потребує регенерації типів, він містить позначку **[CHECKPOINT: власник]** —
   зупинись і попроси власника виконати `npx supabase db push` та регенерацію
   типів (рецепт у `docs/deploy.md`, розділ «Common operations»).
6. Коментарі в коді лише про «чому», не про «що». Мова коду, комітів та
   ідентифікаторів — англійська; документації — українська.
7. Якщо тест починає падати і причина неочевидна, не «підганяй» очікування
   тесту. Зупинись і опиши, що саме змінилось у поведінці.
8. Порядок кроків нижче — рекомендований. Крок 1 має найбільшу цінність, але
   потребує checkpoint власника, тому розумно спочатку зробити Крок 6.1/6.4/
   6.7/6.8 (розминка) та Крок 4.

Рекомендований порядок PR: 6.1 + 6.4 + 6.7 + 6.8 → 4 → 1 → 2 → 3 → 6.2 + 6.3 →
6.5 → 6.6 → 5 → 6.9.

---

## Крок 1. Атомарне збереження чека через RPC `save_receipt_bundle`

### Мета

Зараз [use-save-receipt-mutation.ts](../web/src/features/receipts/api/use-save-receipt-mutation.ts)
робить 5–7 послідовних записів із ручним відкатом, а
[use-update-receipt-mutation.ts](../web/src/features/receipts/api/use-update-receipt-mutation.ts)
виконує `UPDATE receipts → DELETE items → DELETE product_prices → INSERT items`
без жодного відкату. Обидва хуки дублюють ~70 рядків (fetch products →
`resolveProducts` → insert new → backfills → enrichments → price snapshots).

Після кроку: увесь запис іде однією plpgsql-функцією в одній транзакції.
Логіка вибору продукту (`resolveProducts`) лишається у TS, бо вона чиста і вже
покрита тестами. Публічні інтерфейси обох хуків (`SaveReceiptVars`,
`UpdateReceiptVars`, результати, invalidation) НЕ змінюються, тому
`PhotoReviewForm`, `ManualReceiptForm`, `EditReceiptForm`,
`use-save-photo-receipt-mutation`, `use-save-pending-receipt-mutation` не
чіпаються.

### Файли

Створити:

- `supabase/migrations/20260922100000_save_receipt_bundle.sql`
- `web/src/features/receipts/api/receipt-bundle.ts`
- `web/src/features/receipts/api/use-update-receipt-mutation.test.tsx`
- `scripts/test-save-receipt-bundle-sql.mjs`

Змінити:

- `web/src/features/receipts/api/use-save-receipt-mutation.ts`
- `web/src/features/receipts/api/use-update-receipt-mutation.ts`
- `web/src/features/receipts/api/use-save-receipt-mutation.test.tsx`
- `package.json` (корінь) — скрипти `test:*`
- `docs/data-model.md` — розділ про RPC
- `docs/architecture.md` — потік «Save receipt»

### 1.1. Міграція

Файл `supabase/migrations/20260922100000_save_receipt_bundle.sql`. Функція
`security invoker` (RLS застосовується до викликача, як у `stats_*`),
`set search_path = ''`, усі імена таблиць з префіксом `public.`.

```sql
create or replace function public.save_receipt_bundle(
  p_receipt jsonb,
  p_items jsonb,
  p_new_products jsonb default '[]'::jsonb,
  p_product_backfills jsonb default '[]'::jsonb,
  p_product_enrichments jsonb default '[]'::jsonb,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_receipt_id text := p_receipt ->> 'id';
  v_currency text := p_receipt ->> 'currency';
  v_date date := (p_receipt ->> 'date')::date;
  v_enrichment jsonb;
  v_items_count integer;
begin
  if v_receipt_id is null then
    raise exception 'save_receipt_bundle: receipt id is required';
  end if;

  -- 1. Products first: items reference them by id.
  insert into public.products (
    id, name, store, store_product_code, category, unit, unit_size, notes,
    product_family_id, product_variant_id, brand, is_organic, created_at, updated_at
  )
  select p.id, p.name, p.store, p.store_product_code, p.category,
         p.unit::public.product_unit, p.unit_size, p.notes,
         p.product_family_id, p.product_variant_id, p.brand, p.is_organic,
         coalesce(p.created_at, now()), coalesce(p.updated_at, now())
    from jsonb_to_recordset(p_new_products) as p(
      id text, name text, store text, store_product_code text, category text,
      unit text, unit_size numeric, notes text, product_family_id text,
      product_variant_id text, brand text, is_organic boolean,
      created_at timestamptz, updated_at timestamptz
    );

  update public.products p
     set store_product_code = b.store_product_code
    from jsonb_to_recordset(p_product_backfills) as b(id text, store_product_code text)
   where p.id = b.id;

  -- A key present with null value means "set null"; an absent key means "keep".
  for v_enrichment in select value from jsonb_array_elements(p_product_enrichments) loop
    update public.products
       set product_family_id = case when v_enrichment ? 'product_family_id'
             then v_enrichment ->> 'product_family_id' else product_family_id end,
           product_variant_id = case when v_enrichment ? 'product_variant_id'
             then v_enrichment ->> 'product_variant_id' else product_variant_id end,
           brand = case when v_enrichment ? 'brand'
             then v_enrichment ->> 'brand' else brand end,
           is_organic = case when v_enrichment ? 'is_organic'
             then (v_enrichment ->> 'is_organic')::boolean else is_organic end
     where id = v_enrichment ->> 'id';
  end loop;

  -- 2. Receipt row. Replace mode must update the receipt BEFORE items are
  --    inserted: trigger apply_product_match_rule() reads receipts.source.
  if p_replace then
    update public.receipts set
      date = v_date,
      time = nullif(p_receipt ->> 'time', '')::time,
      store = p_receipt ->> 'store',
      store_address = p_receipt ->> 'store_address',
      currency = v_currency,
      total_orig = (p_receipt ->> 'total_orig')::numeric,
      fx_rate_eur = (p_receipt ->> 'fx_rate_eur')::numeric,
      total_eur = (p_receipt ->> 'total_eur')::numeric,
      paid_by = p_receipt ->> 'paid_by',
      photo_url = p_receipt ->> 'photo_url',
      photo_path = p_receipt ->> 'photo_path',
      merchant_order_id = p_receipt ->> 'merchant_order_id',
      source = (p_receipt ->> 'source')::public.receipt_source,
      raw_ocr_json = p_receipt ->> 'raw_ocr_json',
      note = p_receipt ->> 'note',
      updated_at = coalesce((p_receipt ->> 'updated_at')::timestamptz, now())
    where id = v_receipt_id;
    if not found then
      raise exception 'save_receipt_bundle: receipt % not found', v_receipt_id;
    end if;
    delete from public.product_prices where receipt_id = v_receipt_id;
    delete from public.items where receipt_id = v_receipt_id;
  else
    insert into public.receipts (
      id, date, time, store, store_address, currency, total_orig, fx_rate_eur,
      total_eur, paid_by, photo_url, photo_path, merchant_order_id, source,
      raw_ocr_json, note, created_at, updated_at
    ) values (
      v_receipt_id, v_date, nullif(p_receipt ->> 'time', '')::time,
      p_receipt ->> 'store', p_receipt ->> 'store_address', v_currency,
      (p_receipt ->> 'total_orig')::numeric, (p_receipt ->> 'fx_rate_eur')::numeric,
      (p_receipt ->> 'total_eur')::numeric, p_receipt ->> 'paid_by',
      p_receipt ->> 'photo_url', p_receipt ->> 'photo_path',
      p_receipt ->> 'merchant_order_id',
      (p_receipt ->> 'source')::public.receipt_source,
      p_receipt ->> 'raw_ocr_json', p_receipt ->> 'note',
      coalesce((p_receipt ->> 'created_at')::timestamptz, now()),
      coalesce((p_receipt ->> 'updated_at')::timestamptz, now())
    );
  end if;

  -- 3. Items, then price snapshots from the rows as actually inserted
  --    (BEFORE triggers may rewrite product_id via product_match_rules).
  with inserted as (
    insert into public.items (
      id, receipt_id, product_id, product_name, raw_product_name, store_product_code,
      product_url, product_image_url, product_family_id, product_variant_id, category,
      qty, unit_price_orig, discount_orig, total_orig, total_eur, consumed_by, note,
      wasted_qty, wasted_at, created_at, updated_at
    )
    select i.id, v_receipt_id, i.product_id, i.product_name, i.raw_product_name,
           i.store_product_code, i.product_url, i.product_image_url,
           i.product_family_id, i.product_variant_id, i.category,
           i.qty, i.unit_price_orig, i.discount_orig, i.total_orig, i.total_eur,
           i.consumed_by, i.note, i.wasted_qty, i.wasted_at,
           coalesce(i.created_at, now()), coalesce(i.updated_at, now())
      from jsonb_to_recordset(p_items) as i(
        id text, product_id text, product_name text, raw_product_name text,
        store_product_code text, product_url text, product_image_url text,
        product_family_id text, product_variant_id text, category text,
        qty numeric, unit_price_orig numeric, discount_orig numeric,
        total_orig numeric, total_eur numeric, consumed_by text, note text,
        wasted_qty numeric, wasted_at timestamptz,
        created_at timestamptz, updated_at timestamptz
      )
    returning id, product_id, unit_price_orig, discount_orig
  )
  insert into public.product_prices (
    id, product_id, receipt_id, price_orig, price_net, currency, date
  )
  select src.price_id, ins.product_id, v_receipt_id, ins.unit_price_orig,
         round(ins.unit_price_orig - ins.discount_orig, 2), v_currency, v_date
    from inserted ins
    join jsonb_to_recordset(p_items) as src(id text, price_id text) on src.id = ins.id
   where ins.product_id is not null and src.price_id is not null;

  select count(*) into v_items_count from public.items where receipt_id = v_receipt_id;
  return jsonb_build_object('receipt_id', v_receipt_id, 'items_count', v_items_count);
end;
$$;

revoke execute on function public.save_receipt_bundle(jsonb, jsonb, jsonb, jsonb, jsonb, boolean)
  from public, anon;
grant execute on function public.save_receipt_bundle(jsonb, jsonb, jsonb, jsonb, jsonb, boolean)
  to authenticated, service_role;

comment on function public.save_receipt_bundle is
  'Atomic insert (p_replace=false) or full replace (p_replace=true) of a receipt with its items, product side-effects and price snapshots. Product resolution happens client-side (resolve-products.ts); this function only writes.';
```

Звір список колонок із `web/src/shared/types/database.types.ts` (Row-типи
`receipts`, `items`, `products`, `product_prices`) перед комітом: якщо в
`items` чи `receipts` зʼявились нові колонки після 2026-09-12, додай їх.

### 1.2. Спільний модуль `receipt-bundle.ts`

Файл `web/src/features/receipts/api/receipt-bundle.ts`. Сюди переїжджає все,
що зараз дубльовано в save/update:

```ts
import { makeItem, ulid, type Item, type Receipt } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import type { ProductRow } from '@/features/products/api/use-products';
import { resolveProducts, type ItemKey, type ResolveProductsResult } from './resolve-products';
import type { SaveItemInput } from './use-save-receipt-mutation';

export type BundleItem = Item & { price_id: string };

export type ReceiptBundle = {
  items: BundleItem[];
  newProducts: ResolveProductsResult['newProducts'];
  backfills: ResolveProductsResult['backfills'];
  enrichments: ResolveProductsResult['enrichments'];
};

const PRODUCT_COLUMNS =
  'id, name, store, store_product_code, category, product_family_id, product_variant_id, brand, is_organic';

export async function fetchStoreProducts(store: string): Promise<ProductRow[]> {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('store', store);
  if (error) throw wrapError('Products fetch failed', error);
  return data ?? [];
}

// Was inlined identically in both mutations.
export function toItemKey(it: SaveItemInput): ItemKey {
  /* the 8-field mapping */
}

export function buildReceiptBundle(args: {
  receipt_id: string;
  store: string;
  fx_rate_eur: number;
  items: SaveItemInput[];
  existingProducts: ProductRow[];
}): ReceiptBundle {
  const resolution = resolveProducts({
    store: args.store,
    items: args.items.map(toItemKey),
    existingProducts: args.existingProducts,
  });
  const items = args.items.map((it, idx) => ({
    ...makeItem({
      ...it,
      receipt_id: args.receipt_id,
      product_id: resolution.productIdByIndex[idx] ?? null,
      fx_rate_eur: args.fx_rate_eur,
    }),
    price_id: ulid(),
  }));
  return {
    items,
    newProducts: resolution.newProducts,
    backfills: resolution.backfills,
    enrichments: resolution.enrichments,
  };
}

export async function saveReceiptBundle(args: {
  receipt: Receipt;
  bundle: ReceiptBundle;
  replace: boolean;
}): Promise<{ receipt_id: string; items_count: number }> {
  const { data, error } = await supabase.rpc('save_receipt_bundle', {
    p_receipt: args.receipt,
    p_items: args.bundle.items,
    p_new_products: args.bundle.newProducts,
    p_product_backfills: args.bundle.backfills,
    p_product_enrichments: args.bundle.enrichments,
    p_replace: args.replace,
  });
  if (error) throw wrapError(args.replace ? 'Receipt update failed' : 'Receipt save failed', error);
  // data is jsonb; narrow defensively (see use-stats.ts asNumber pattern).
  return { receipt_id: args.receipt.id, items_count: /* Number(data.items_count) */ 0 };
}
```

Якщо `supabase.rpc` скаржиться на тип аргументів (`Json`), приведи обʼєкти
через `JSON.parse(JSON.stringify(x)) as Json` в одному місці всередині
`saveReceiptBundle`, не в хуках.

### 1.3. Хуки

`use-save-receipt-mutation.ts` → `mutationFn`:

1. `fx_rate_eur = await fxRateProvider.getRateLive(...)` (як зараз).
2. `receipt = makeReceipt({...receiptInput, fx_rate_eur, total_orig: computeGrandTotal(itemInputs)})`.
3. `existing = await fetchStoreProducts(receipt.store)`.
4. `bundle = buildReceiptBundle({ receipt_id: receipt.id, store: receipt.store, fx_rate_eur, items: itemInputs, existingProducts: existing })`.
5. `return saveReceiptBundle({ receipt, bundle, replace: false })`.

Видалити: усі `supabase.from('products').insert/update`, `supabase.from('receipts')`,
`supabase.from('items')`, `supabase.from('product_prices')`, ручні `delete` для
відкату, JSDoc-блок «Rollback: …» (замінити на два речення про атомарний RPC).
`onSuccess` не міняти.

`use-update-receipt-mutation.ts` → те саме, але:

- `fx_rate_eur` рефетчиться тільки якщо змінились `currency`/`date` (як зараз);
- `patched = applyReceiptPatch(existing, {... source: 'edit' ...})` (як зараз);
- `bundle = buildReceiptBundle({ receipt_id: id, store: patched.store, ... })`;
- `return saveReceiptBundle({ receipt: patched, bundle, replace: true })`.

Прибрати коментар «No DB transaction (Supabase JS doesn't expose them)…» —
він більше не правдивий.

### 1.4. Тести

`use-save-receipt-mutation.test.tsx` — переписати mock `supabase`: лишити
`from('products').select().eq()` (через `productsSelectMock`) і додати
`rpc: (name, args) => rpcMock(name, args)`. Усі інші per-table mock прибрати.
Сценарії, які мають лишитись/зʼявитись:

1. Новий продукт → `rpcMock` викликано один раз з `p_replace: false`,
   `p_new_products.length === 1`, `p_items[0].product_id === p_new_products[0].id`,
   у кожного `p_items[i]` є `price_id` (26 символів).
2. Існуючий продукт без коду + item з кодом → `p_product_backfills` містить
   `{ id, store_product_code }`, `p_new_products` порожній.
3. Enrichment (існуючий продукт без family, item з family) →
   `p_product_enrichments[0]` має `product_family_id`.
4. `rpcMock` повертає `{ error }` → mutation reject-иться з повідомленням, що
   починається з `Receipt save failed:`, `invalidateQueries` не викликано.
5. Успіх → `invalidateQueries` для `receiptsQueryKey` і `productsQueryKey`.
6. FX: для `UAH` `fxRateMock` викликано з `('UAH', date)`; `p_receipt.fx_rate_eur`
   дорівнює тому, що повернув mock.

`use-update-receipt-mutation.test.tsx` — новий, за тим самим шаблоном:

1. `p_replace: true`, `p_receipt.id === vars.id`, `p_receipt.source === 'edit'`.
2. Валюта і дата не змінились → `fxRateMock` не викликано, `p_receipt.fx_rate_eur === existing.fx_rate_eur`.
3. Дата змінилась → `fxRateMock` викликано один раз.
4. Помилка RPC → reject із `Receipt update failed:`.
5. Успіх → invalidation `receiptsQueryKey`, `receiptQueryKey(id)`, `productsQueryKey`.

`scripts/test-save-receipt-bundle-sql.mjs` — SQL-тест на PGlite за зразком
`scripts/test-purchase-correction-rules.mjs`:

- bootstrap: `create schema auth; create role anon/authenticated/service_role;
auth.jwt()` stub; DDL таблиць `categories`, `products` (з партіальними
  унікальними індексами), `receipts`, `items`, `product_prices`, enum
  `receipt_source`, `product_unit`, функція `set_updated_at` і тригери
  `updated_at`. Візьми DDL із міграцій `20260507000001_initial_schema.sql` та
  тієї, де створюється `product_prices` (`grep -l "create table public.product_prices" supabase/migrations/*.sql`).
- завантажити файл нової міграції через `readFile` і `db.exec`.
- assert-и:
  1. insert: чек + 2 позиції, одна з `product_id`, одна без → `product_prices`
     має 1 рядок, `price_net = unit_price_orig - discount_orig`.
  2. replace: той самий `receipt_id`, 1 нова позиція → у `items` рівно 1 рядок,
     у `product_prices` рядки старого чека видалені.
  3. атомарність insert: другий item посилається на неіснуючий `product_id`
     (FK) → `assert.rejects`, після чого `select count(*) from receipts` = 0.
  4. атомарність replace: та сама помилка → старі items лишились на місці.
  5. enrichment: ключ із `null` → колонка стала `null`; відсутній ключ →
     значення збереглось.
  6. backfill: `store_product_code` проставлено.
- зареєструвати в кореневому `package.json`:
  `"test:save-receipt-bundle-sql": "node scripts/test-save-receipt-bundle-sql.mjs"`
  і додати в кінець скрипта `"test"`.

### 1.5. [CHECKPOINT: власник]

Після того, як міграція і TS-код готові, але ДО запуску `npm run typecheck`:
власник має виконати `npx supabase db push` і регенерувати
`database.types.ts` (рецепт у `docs/deploy.md`). Без цього
`supabase.rpc('save_receipt_bundle')` не типізований і typecheck впаде.
Альтернатива без live-доступу: `npx supabase start` (Docker) →
`npx supabase db reset` → `npx supabase gen types typescript --local`.

### 1.6. Документація

- `docs/data-model.md`: новий підрозділ «RPC `save_receipt_bundle`» (контракт
  параметрів, режими insert/replace, чому product resolution на клієнті).
- `docs/architecture.md`: у потоці «Manual save» / «Edit» замінити
  послідовність запитів на один RPC.
- `docs/project-status.md`: короткий запис «2026-09: збереження чека атомарне».

### Критерії готовності

- У `use-save-receipt-mutation.ts` і `use-update-receipt-mutation.ts` немає
  жодного `supabase.from(...)` крім читання products (через `fetchStoreProducts`).
- `grep -n "from('items')\|from('product_prices')" web/src/features/receipts/api/*.ts`
  повертає лише `use-receipt.ts`/`use-delete-receipt-mutation.ts` (читання/видалення).
- Гейти зелені, SQL-тест зелений, ручний smoke: `/manual` зберегти, `/edit/$id`
  змінити магазин, переконатись що позиції та ціни на місці.

---

## Крок 2. `_shared` для Edge Functions + `receipt-evidence` у домені

### Мета

`process-receipt-imports` імпортує провайдери, типи, промпти і таксономію з
`../parse-receipt/` — спільний код живе всередині чужої функції. Окремо,
хелпери перевірки доказів (`amountAppearsInText`, `hasExplicitMultiplier`,
`hasWeightOrVolume`, `normalize`, злиття пар) існують у двох копіях:
[validate-manual-json.ts:327-413](../web/src/features/photo/utils/validate-manual-json.ts)
і [domain.ts:674-830](../supabase/functions/process-receipt-imports/domain.ts).

Після кроку: спільний AI-код лежить у `supabase/functions/_shared/receipt-ai/`
(офіційна конвенція Supabase), хелпери доказів — у `packages/domain`, а їхня
копія для Deno генерується скриптом із перевіркою дріфту в CI.

### 2.1. Перенесення у `_shared/receipt-ai`

Перемістити (git mv) з `supabase/functions/parse-receipt/` у
`supabase/functions/_shared/receipt-ai/`:

| Було                                             | Стало                                                         |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `types.ts`                                       | `_shared/receipt-ai/types.ts`                                 |
| `taxonomy.ts`, `taxonomy.test.ts`                | `_shared/receipt-ai/taxonomy.ts`, `.test.ts`                  |
| `time-evidence.ts`, `time-evidence.test.ts`      | `_shared/receipt-ai/time-evidence.ts`, `.test.ts`             |
| `providers/ai-provider.ts`                       | `_shared/receipt-ai/providers/ai-provider.ts`                 |
| `providers/gemini-provider.ts` (+ `.test.ts`)    | `_shared/receipt-ai/providers/gemini-provider.ts` (+ test)    |
| `providers/anthropic-provider.ts` (+ `.test.ts`) | `_shared/receipt-ai/providers/anthropic-provider.ts` (+ test) |
| `prompts/receipt-prompt.ts` (+ `.test.ts`)       | `_shared/receipt-ai/prompts/receipt-prompt.ts` (+ test)       |
| `prompts/bulk-import-prompt.ts`                  | `_shared/receipt-ai/prompts/bulk-import-prompt.ts`            |
| `prompts/bulk-import-wire.ts`                    | `_shared/receipt-ai/prompts/bulk-import-wire.ts`              |

У `parse-receipt/` лишаються: `index.ts`, `config.ts`, `handler.ts`,
`handler.test.ts`, `README.md`, `deno.json`, `deno.lock`, `package.json`,
`vitest.config.ts`.

Оновити імпорти (усі з розширенням `.ts`, як зараз):

- `parse-receipt/handler.ts`, `parse-receipt/config.ts`:
  `./types.ts` → `../_shared/receipt-ai/types.ts`,
  `./providers/...` → `../_shared/receipt-ai/providers/...`,
  `./taxonomy.ts`, `./time-evidence.ts` → `../_shared/receipt-ai/...`.
- `process-receipt-imports/{index,domain,long-receipt,receipt-reconciliation}.ts`
  та їхні `*.test.ts`: `../parse-receipt/X` → `../_shared/receipt-ai/X`.
- Внутрішні імпорти всередині переміщених файлів (`../types.ts`,
  `./receipt-prompt.ts`) лишаються відносними і не змінюються.

Створити у `supabase/functions/_shared/`:

- `package.json`:
  ```json
  {
    "name": "@finance-tracker/edge-shared-fn",
    "version": "0.2.7",
    "private": true,
    "type": "module",
    "scripts": { "test": "vitest run" },
    "devDependencies": { "vitest": "^4.1.5" }
  }
  ```
- `vitest.config.ts` — копія з `parse-receipt/vitest.config.ts`
  (`include: ['**/*.test.ts']`).
- `deno.json` — копія з `parse-receipt/deno.json`.

Кореневий `package.json` уже має workspace-glob `supabase/functions/*`, тож
`_shared` підхопиться автоматично після `npm install`. У
`parse-receipt/vitest.config.ts` нічого не змінювати (тести провайдерів
тепер запускає `_shared`).

Оновити `parse-receipt/README.md` (структура папок) і `CLAUDE.md` (розділ
«Folder structure», рядок про `supabase/functions/`).

### 2.2. `packages/domain/src/receipt-evidence.ts`

Новий файл у домені. Основа — версія з Edge Function (вона акуратніша:
`groupItemIndices` пропускає порожні ключі, є `isPairCandidate`), але
округлення через `roundMoney` / `roundQty` з `./money`:

```ts
export type AccountingLine = {
  product_name: string;
  qty: number;
  unit_price_orig: number;
  discount_orig?: number | undefined;
};

export function normalizeReceiptText(value: string): string;
export function amountAppearsInText(text: string, amount: number): boolean;
export function integerAppearsInText(text: string, value: number): boolean;
export function hasExplicitMultiplier(text: string, qty: number): boolean;
export function hasWeightOrVolume(text: string): boolean;
/** Cancellation pairs first, then partial discounts; returns a new array. */
export function mergeAccountingPairs<T extends AccountingLine>(items: T[]): T[];
```

Додати `export * from './receipt-evidence';` у `packages/domain/src/index.ts`.

Тести `receipt-evidence.test.ts`: перенести кейси, що стосуються цих функцій,
з `web/src/features/photo/utils/validate-manual-json.test.ts` та
`supabase/functions/process-receipt-imports/domain.test.ts` (шукай за
`describe`/`it` зі словами `pair`, `multiplier`, `weight`, `amount`,
`cancellation`, `discount`). Оригінальні тести НЕ видаляти: вони тепер
перевіряють інтеграцію через імпорт.

Замінити локальні копії:

- `web/src/features/photo/utils/validate-manual-json.ts`: видалити
  `mergeAccountingPairs`, `claimPairs`, `normalize`, `amountAppearsInText`,
  `integerAppearsInText`, `hasExplicitMultiplier`, `hasWeightOrVolume`;
  імпортувати з `@finance-tracker/domain` (`normalize` → `normalizeReceiptText`).
- `supabase/functions/process-receipt-imports/domain.ts`: видалити
  `mergePairs`, `groupItemIndices`, `claimPairPass`, `isPairCandidate`,
  `grossLineTotal`, `isSignedPrice`, `normalize`, `INVISIBLE_CHARS`,
  `amountAppearsInText`, `integerAppearsInText`, `hasExplicitMultiplier`,
  `hasWeightOrVolume`; імпортувати з `../_shared/domain/receipt-evidence.ts`
  (зʼявиться після 2.3). Локальний `round(value, decimals)` та
  `checkReceiptArithmetic` лишити як є.

**Увага на округлення.** Edge-версія `round` додає `Number.EPSILON`, доменна
`roundMoney` — ні. На межі `x.xx5` результати можуть відрізнятись. Якщо після
заміни падає тест у `domain.test.ts` саме через це — не змінюй очікування
тесту, а залиш у `domain.ts` локальний `round` для `checkReceiptArithmetic`
і опиши розбіжність у PR. Спільні хелпери використовують `roundMoney`.

### 2.3. Скрипт синхронізації `scripts/sync-edge-domain.mjs`

Deno не резолвить workspace-пакет, тому копія доменних файлів генерується.

```js
// scripts/sync-edge-domain.mjs
// Usage: node scripts/sync-edge-domain.mjs        (write)
//        node scripts/sync-edge-domain.mjs --check (exit 1 on drift)
const SOURCE = 'packages/domain/src';
const TARGET = 'supabase/functions/_shared/domain';
const FILES = ['money.ts', 'receipt-evidence.ts'];
const HEADER = (file) =>
  `// GENERATED by scripts/sync-edge-domain.mjs from ${SOURCE}/${file}. Do not edit.\n\n`;
// transform: HEADER + source with relative imports given a `.ts` extension:
//   from './money'  -> from './money.ts'
//   regex: /from '(\.\.?\/[^']+?)'(?!\.ts)/g  (skip paths that already end in .ts)
// --check: compare transformed content with existing target; list drift; exit 1.
```

- Кореневий `package.json`:
  `"sync:edge-domain": "node scripts/sync-edge-domain.mjs"`,
  `"check:edge-domain": "node scripts/sync-edge-domain.mjs --check"`,
  і додати `&& npm run check:edge-domain` у кінець скрипта `"test"`.
- `.prettierignore`: додати `supabase/functions/_shared/domain`.
- Запустити `npm run sync:edge-domain`, закомітити згенеровані файли.
- CI (Крок 5) додає `npm run check:edge-domain` окремим кроком.

### Перевірка

```powershell
npm install
npm run lint; npm run typecheck; npm run test
deno check supabase/functions/parse-receipt/index.ts
deno check supabase/functions/process-receipt-imports/index.ts
deno lint supabase/functions
npm run check:edge-domain
```

### Критерії готовності

- `grep -rn "parse-receipt/" supabase/functions/process-receipt-imports` порожній.
- `grep -n "function amountAppearsInText" -r web/src supabase/functions/process-receipt-imports` порожній.
- `supabase/functions/_shared/domain/*.ts` ідентичні джерелу за
  `npm run check:edge-domain`.
- Кількість тестів не зменшилась (було 842 + нові).

---

## Крок 3. Розріз воркера `process-receipt-imports`

### Мета

[index.ts](../supabase/functions/process-receipt-imports/index.ts) має 1164
рядки, side-effects на рівні модуля (`createClient`, `Deno.env` при імпорті),
`processJob` на ~330 рядків і нуль тестів на оркестрацію. Повторити розріз,
який уже є в `parse-receipt`: portable handler з інʼєкцією залежностей +
`config.ts` для Deno.

### Цільова структура `supabase/functions/process-receipt-imports/`

| Файл                     | Що містить (перенести з `index.ts`)                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`               | `Job`, `ImportFile`, `AttemptStage`, `AttemptStatus`, `AttemptHandle`, `BulkProvider`, `ChunkedBulkProvider`, `ProviderInvocation`, `ChunkInvocation`, `StoredVerificationSeed`, `RetryableImportError`, новий `WorkerDeps`           |
| `config.ts`              | `requiredEnv`, константи `BULK_PROVIDER_TIMEOUT_MS`, `BULK_ANTHROPIC_MAX_TOKENS`, `FALLBACK_MODEL`, `BUCKET`; `export function loadWorkerDeps(): WorkerDeps` (створює `db`, `primary`, `fallback`, читає `RECEIPT_IMPORT_CRON_TOKEN`) |
| `encoding.ts`            | `bytesToBase64`, `ulid` (+ `ALPHABET`)                                                                                                                                                                                                |
| `fx.ts`                  | `getFxRate(fetchImpl, currency, dateIso)`                                                                                                                                                                                             |
| `messages.ts`            | `providerPublicMessage`, `joinReviewMessages`, `publicError`                                                                                                                                                                          |
| `attempts.ts`            | `createAttemptLog(db)` → `{ nextAnalysisRun, startAttempt, finishAttempt }`; окремо `traceFields`, `providerResultFields`, `logReconciliation`                                                                                        |
| `parsing.ts`             | `parseForDelivery`, `shouldUseLongReceiptChunks`, `parseLongReceipt`, `loadStoredReceiptChunks`, `invokeChunkProvider`, `independentlyVerify`, `invokeProvider`, `loadStoredVerificationSeed`, `anthropicSettings`                    |
| `taxonomy-enrichment.ts` | `enrichSavedImportTaxonomy`, `productKey`, `hasTaxonomySuggestion`, `mergeSuggestion`, `mergeScalar`, тип `PreparedProductSuggestion`                                                                                                 |
| `exceptions.ts`          | `completeException`, `completeManualException`                                                                                                                                                                                        |
| `job-processor.ts`       | `processJob(deps, job)`                                                                                                                                                                                                               |
| `handler.ts`             | `createHandler(deps, processJobImpl = processJob)` → `(req: Request) => Promise<Response>`; `json()`                                                                                                                                  |
| `index.ts`               | три рядки: `Deno.serve(createHandler(loadWorkerDeps()))`                                                                                                                                                                              |

`WorkerDeps`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
export type WorkerDeps = {
  db: SupabaseClient;
  primary: BulkProvider;
  fallback: ChunkedBulkProvider;
  cronToken: string;
  fetch: typeof fetch;
  log: Pick<Console, 'info' | 'warn' | 'error'>;
};
```

Правила перенесення:

1. Кожна функція, що зараз використовує модульні `db`, `primary`, `fallback`,
   `console`, `fetch`, отримує `deps: WorkerDeps` (або конкретно `db`)
   першим параметром. Логіку не змінювати.
2. `console.*` → `deps.log.*`. `fetch(` у `getFxRate` → `deps.fetch(`.
3. `processJob` розбити на кроки-функції всередині `job-processor.ts`, щоб
   тіло `processJob` стало «сценарієм» з ~40 рядків:
   `loadJobContext(deps, job)` (file + categories + taxonomy + document
   download → `ctx`, `base64`, прапорці), `obtainParsedDocument(...)` (гілки
   manual / long / seed / normal), `rejectForReview(...)` (спільний код трьох
   `needs_review` виходів: `completeException`/`completeManualException` +
   `finishAttempt`), `finalize(...)` (RPC `finalize_*` + enrichment),
   `handleFailure(...)` (весь `catch`-блок із рішенням про retry).
4. `handler.ts` не знає про Deno. `index.ts` — єдине місце з `Deno.serve`,
   `config.ts` — єдине з `Deno.env`.

### Тести

`vitest.config.ts` → `include: ['**/*.test.ts']`.

`handler.test.ts` (за зразком `parse-receipt/handler.test.ts`):

1. `GET` → 405.
2. `POST` з неправильним `Authorization` → 401, `db.rpc` не викликано.
3. Валідний токен → `db.rpc` викликано з `'expire_stale_receipt_import_uploads'`,
   потім `'claim_receipt_import_jobs'` з `{ p_limit: 1 }`; для кожного job
   викликано інʼєктований `processJobImpl`; відповідь `{ claimed, results }`.
4. `claim_receipt_import_jobs` повертає `error` → 500.

`job-processor.test.ts` — мінімум два сценарії з fake `db` (chain-builder,
де кожен метод повертає той самий обʼєкт, а `then` резолвить заготовлену
відповідь по імені таблиці/rpc; зразок такого підходу є в
`web/src/features/receipts/api/use-save-receipt-mutation.test.tsx`):

1. `manual_json` невалідний (наприклад `{}`) → викликано rpc
   `complete_manual_receipt_import_exception`, результат `needs_review`,
   провайдери не викликались.
2. Звичайний файл, `primary.parseBulkDetailed` повертає валідний документ
   (візьми фікстуру з `domain.test.ts`, де `checkReceiptArithmetic(...).matches === true`)
   → викликано rpc `finalize_receipt_import` з `p_items.length` = кількість
   позицій, результат `saved`.

`fx.test.ts`: EUR → 1 без fetch; UAH з fetch-стабом → `1/rate` округлено до 6 знаків;
відповідь `!ok` 7 разів → throw `NBU rate unavailable`.

### Критерії готовності

- `index.ts` ≤ 10 рядків; жоден файл у папці не більший за 400 рядків.
- `grep -n "Deno\." supabase/functions/process-receipt-imports/*.ts` знаходить
  лише `index.ts` і `config.ts`.
- `deno check` обох функцій зелений; існуючі `domain/long-receipt/reconciliation`
  тести не змінені.
- README функції оновлено (карта модулів).

---

## Крок 4. Pathless layout `_authed` замість `<RequireAuth>` у кожному роуті

### Мета

`<RequireAuth>` вручну обгортає 13 роутів. Нову сторінку легко забути
захистити. TanStack Router має pathless layout route.

### Зміни

1. Створити `web/src/routes/_authed.tsx`:

   ```tsx
   import { createFileRoute, Outlet } from '@tanstack/react-router';
   import { RequireAuth } from '@/features/auth';

   export const Route = createFileRoute('/_authed')({
     component: () => (
       <RequireAuth>
         <Outlet />
       </RequireAuth>
     ),
   });
   ```

2. Перемістити роути (git mv) у `web/src/routes/_authed/` і змінити перший
   аргумент `createFileRoute`:

   | Було                         | Стало                                | `createFileRoute(...)`              |
   | ---------------------------- | ------------------------------------ | ----------------------------------- |
   | `index.tsx`                  | `_authed/index.tsx`                  | `'/_authed/'`                       |
   | `manual.tsx`                 | `_authed/manual.tsx`                 | `'/_authed/manual'`                 |
   | `recent.tsx`                 | `_authed/recent.tsx`                 | `'/_authed/recent'`                 |
   | `photo.tsx`                  | `_authed/photo.tsx`                  | `'/_authed/photo'`                  |
   | `pending.tsx`                | `_authed/pending.tsx`                | `'/_authed/pending'`                |
   | `stats.tsx`                  | `_authed/stats.tsx`                  | `'/_authed/stats'`                  |
   | `waste.tsx`                  | `_authed/waste.tsx`                  | `'/_authed/waste'`                  |
   | `reconcile.tsx`              | `_authed/reconcile.tsx`              | `'/_authed/reconcile'`              |
   | `imports.tsx`                | `_authed/imports.tsx`                | `'/_authed/imports'`                |
   | `imports_.$id.tsx`           | `_authed/imports_.$id.tsx`           | `'/_authed/imports_/$id'`           |
   | `packaged-products.tsx`      | `_authed/packaged-products.tsx`      | `'/_authed/packaged-products'`      |
   | `packaged-products_.$id.tsx` | `_authed/packaged-products_.$id.tsx` | `'/_authed/packaged-products_/$id'` |
   | `edit.$id.tsx`               | `_authed/edit.$id.tsx`               | `'/_authed/edit/$id'`               |

   `__root.tsx` і `auth.callback.tsx` лишаються на місці.

3. У кожному переміщеному файлі: прибрати `import { RequireAuth }`, прибрати
   компонент-обгортку (`StatsPage`, `PhotoPage`, `EditPage`, `HomePage` …) і
   передати в `component` внутрішній компонент напряму. Приклад для stats:
   було `component: StatsPage` (який рендерив `<RequireAuth><StatsDashboard/></RequireAuth>`),
   стало `component: StatsDashboard`. Якщо обгортка читала `Route.useParams()`
   / `Route.useSearch()` і передавала пропсами (як `EditPage` → `EditView`),
   перенеси виклик усередину внутрішнього компонента.

4. URL-и (`navigate({ to: '/recent' })`, `<Link to="/edit/$id">`,
   `useNavigate({ from: Route.fullPath })`) НЕ змінюються: pathless-сегмент
   не входить у шлях. Після `tsr generate` typecheck сам покаже, якщо десь
   лишилось посилання на старий route id.

5. Тести `web/src/routes/-imports-routing.test.tsx` та `-stats.test.tsx` мокають
   `@/features/auth` → `RequireAuth` як passthrough; `_authed.tsx` імпортує
   звідти ж, тож мок продовжує працювати. Запусти їх окремо:
   `npx vitest run --root web src/routes`.

6. `CLAUDE.md` → «Folder structure» і «Architecture in one paragraph»: список
   роутів + речення «усі роути крім `/auth/callback` живуть під `_authed`».
   `docs/extending.md` рецепт «add a new route»: нові захищені роути
   створюються у `routes/_authed/`.

### Критерії готовності

- `grep -rn "RequireAuth" web/src/routes --include=*.tsx | grep -v test | grep -v _authed.tsx` порожній.
- `npm run typecheck`, `npm run test` зелені; ручний smoke: відкрити `/stats`
  без сесії → форма входу; `/auth/callback` працює.

---

## Крок 5. CI: Deno-перевірки, дріфт-гард; актуалізація CLAUDE.md

### 5.1. Workflows

У `.github/workflows/pr-checks.yml` і `.github/workflows/deploy.yml` після
кроку `Install` додати:

```yaml
- name: Setup Deno
  uses: denoland/setup-deno@v2
  with:
    deno-version: v2.x

- name: Typecheck Edge Functions
  run: |
    deno check supabase/functions/parse-receipt/index.ts
    deno check supabase/functions/process-receipt-imports/index.ts

- name: Lint Edge Functions
  run: deno lint supabase/functions

- name: Check vendored domain copy
  run: npm run check:edge-domain
```

Автодеплой міграцій та функцій (`supabase db push`, `supabase functions deploy`)
у `deploy.yml` потребує секретів `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`,
`SUPABASE_DB_PASSWORD`. Це рішення власника (див. розділ 7); у цьому кроці
НЕ додавати, лише залишити TODO-коментар у `deploy.yml` з переліком секретів.

### 5.2. CLAUDE.md

Переписати такі розділи, звіряючись із кодом, а не з `project-status.md`:

- «Where to start»: прибрати «13 MADR ADRs» → «28 ADR, останні 0016–0028 про
  фоновий імпорт, верифікацію, таксономію, пакований товар».
- «Common commands»: додати `npm run test:purchase-correction-sql`,
  `test:packaged-products-sql`, `test:save-receipt-bundle-sql`,
  `sync:edge-domain`, `check:edge-domain`; deno-команди для обох функцій.
- «Architecture in one paragraph»: дві Edge Functions (`parse-receipt` —
  синхронний OCR; `process-receipt-imports` — PGMQ + pg*cron воркер із
  service-role, cron-token auth), спільний код у `_shared/`, статистика через
  RPC `stats*\*`, `\_authed` layout.
- «Folder structure»: 12 features (перелічити), 15 роутів, `_shared/`,
  `migrations/` («40+ файлів, дивись папку; ключові: initial_schema,
  background_receipt_imports, multilingual_product_taxonomy,
  purchase_correction_rules, packaged_products»), `scripts/`.
- «Testing strategy»: 4 Vitest-workspace (web, domain, parse-receipt,
  process-receipt-imports, + `_shared`) і 3 PGlite SQL-скрипти; актуальну
  кількість тестів взяти з `npm run test` на момент PR.
- Прибрати згадки «Phase 10», «3 міграції», «one Edge Function».

### 5.3. project-status.md

Додати зверху розділ «Рефакторинг 2026-09» з переліком виконаних кроків і
посиланням на цей файл. Блок «TL;DR» переписати: прибрати «10 з 11 фаз»,
«Усі 3 міграції», лишити актуальний стан.

---

## Крок 6. Дрібні правки

Кожна — окремий коміт; 6.1/6.4/6.7/6.8 можна обʼєднати в один PR.

### 6.1. Мертва перевірка retry у `query-client.ts`

`PostgrestError` не має поля `status`, тому умова на 401/403 ніколи не
спрацьовує. Замінити в
[query-client.ts](../web/src/shared/lib/query-client.ts):

```ts
function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  if (status === 401 || status === 403) return true; // FunctionsHttpError / fetch
  return code === '42501' || code === 'PGRST301' || code === 'PGRST302'; // RLS / JWT
}
```

і використати в `retry`. Додати `query-client.test.ts` з трьома кейсами
(PostgrestError з `code: '42501'` → false; `{ status: 401 }` → false;
звичайна помилка, `failureCount 0` → true).

### 6.2. Хук `useDebouncedUrlDraft`

Один і той самий патерн «локальний draft → debounce → navigate» скопійовано у
`RecentFiltersBar` (1 поле) та `WasteFiltersBar` (2 поля), з
`eslint-disable react-hooks/exhaustive-deps`.

Створити `web/src/shared/hooks/use-debounced-url-draft.ts`:

```ts
export function useDebouncedUrlDraft(opts: {
  /** Current value from the URL (search param). */
  value: string | undefined;
  delayMs?: number;
  /** Called with the debounced draft (empty string → undefined). */
  onCommit: (next: string | undefined) => void;
}): [draft: string, setDraft: (next: string) => void];
```

Реалізація: `useState(draft)`, `useDebounce(draft, delayMs)`, `ownPushRef`
(як зараз), плюс `valueRef`/`onCommitRef` через `useRef`, які оновлюються
кожен рендер. Ефект синхронізації з зовнішнім `value` залежить від `[value]`;
ефект коміту залежить лише від `[debounced]` і читає `valueRef.current` та
`onCommitRef.current`. Так `exhaustive-deps` задоволений без suppression.

Замінити в `RecentFiltersBar.tsx`:

```ts
const [storeDraft, setStoreDraft] = useDebouncedUrlDraft({
  value: search.q,
  onCommit: (q) => void navigate({ to: '/recent', search: { ...search, q, saved: undefined } }),
});
```

і аналогічно двічі в `WasteFiltersBar.tsx` (`q` і `store`). Видалити обидва
`useRef`, три `useEffect` і всі `eslint-disable` у цих файлах.

Тест `use-debounced-url-draft.test.ts` з `vi.useFakeTimers()`: (1) setDraft
→ через `delayMs` викликано `onCommit` один раз; (2) зовнішня зміна `value`
оновлює draft і НЕ викликає `onCommit`; (3) порожній рядок → `onCommit(undefined)`.

### 6.3. Зайвий mount-ефект у `StatsPeriodPicker`

Батько (`routes/stats.tsx`) уже ініціалізує `dateRange` через
`loadStatsDateRange()`, яка обчислює те саме, що ефект у
[StatsPeriodPicker.tsx:34-46](../web/src/features/stats/components/StatsPeriodPicker.tsx).
Видалити цей `useEffect` разом із `eslint-disable`. Переконатись, що
`web/src/routes/-stats.test.tsx` зелений (він перевіряє відновлення періоду).

### 6.4. Дублі стилів

`ItemRow.tsx:19-22` і `CreateCategoryDialog.tsx:13-16` оголошують власні
`SELECT_CLASS` / `FIELD_LABEL_CLASS`. Видалити і імпортувати з
`@/shared/ui/select-classes`.

### 6.5. Прибрати widening у фабриках через `default(null)`

`makeItem`, `makeProduct`, `makePackagedProduct` повертають
`Item & { product_family_id: string | null; ... }`, бо в
`ProductClassificationSchema` поля `.nullable().optional()`.

1. У `packages/domain/src/product-taxonomy.ts` додати:

   ```ts
   // For persisted entities: the columns always exist and are null when unset.
   export const ProductClassificationColumnsSchema = z.object({
     product_family_id: TAXONOMY_ID_SCHEMA.nullable().default(null),
     product_variant_id: TAXONOMY_ID_SCHEMA.nullable().default(null),
   });
   ```

   `ProductClassificationSchema` (optional) лишається для input/parsed-схем.

2. У `schemas.ts` замінити `...ProductClassificationSchema.shape` на
   `...ProductClassificationColumnsSchema.shape` ТІЛЬКИ в `ItemSchema`,
   `ProductSchema`, `PackagedProductSchema`. У `ProductSchema` також
   `brand: z.string().trim().min(1).nullable().default(null)`,
   `is_organic: z.boolean().nullable().default(null)`. `superRefine`/`refine`
   про «variant requires family» лишити.

3. У `factories.ts`: у кандидатах замість `...ProductClassificationSchema.parse(input)`
   писати явно `product_family_id: input.product_family_id ?? null`,
   `product_variant_id: input.product_variant_id ?? null` (для `makeProduct`
   ще `brand: input.brand ?? null`, `is_organic: input.is_organic ?? null`).
   Повернений тип — просто `Item` / `Product` / `PackagedProduct`; видалити
   `return { ...item, product_family_id: item.product_family_id ?? null, ... }`
   і коментар про `exactOptionalPropertyTypes` над `makePackagedProduct`.

4. `npm run typecheck` покаже споживачів, які покладались на optional
   (ймовірно `ReturnType<typeof makeProduct>` у `resolve-products.ts`,
   `use-save-packaged-products-mutation.ts`). Замінити на `Product` /
   `PackagedProduct`.

Критерій: у `factories.ts` немає жодного `& {` у типах повернення; тести
домену зелені без змін очікувань.

### 6.6. Подвійний `select` у `apply_product_match_rule()`

Нова міграція `20260922100001_apply_product_match_rule_single_lookup.sql` з
`create or replace function public.apply_product_match_rule()` — тіло як у
`20260908160458_purchase_correction_rules.sql:75-121`, але один запит:

```sql
  select rule.* into v_rule
    from public.product_match_rules rule
    join public.products p on p.id = rule.product_id
   where rule.store_key = v_store_key
     and rule.raw_product_name_key = public.normalize_product_match_key(new.raw_product_name);
  if found then
    new.product_id := v_rule.product_id;
    new.product_name := v_rule.product_name;
    new.category := v_rule.category;
    new.product_family_id := v_rule.product_family_id;
    new.product_variant_id := v_rule.product_variant_id;
  end if;
```

(`v_product` більше не потрібна.) У `scripts/test-purchase-correction-rules.mjs`
після завантаження старої міграції завантажити нову; асерти не міняти.
**[CHECKPOINT: власник]** — `npx supabase db push`.

### 6.7. Один Supabase-клієнт на запит у `parse-receipt/config.ts`

`isAllowed` і `loadTaxonomy` кожен створюють `createClient(...)`. Винести
`function callerClient(authHeader: string)` і використати в обох. Поведінка
не змінюється; `handler.test.ts` не чіпати.

### 6.8. Уніфікувати ключ запиту `useStatsByStore`

У [use-stats.ts](../web/src/features/stats/api/use-stats.ts) ключ
`[...statsByStoreQueryKey, { ...range, ...filters, limit }]` → привести до
форми решти хуків: `[...statsByStoreQueryKey, range, filters, limit]`.
Перевірити `-stats.test.tsx`.

### 6.9. Видалити `legacy/apps-script/`

Вікно відкату (90 днів від 2026-05-07) вийшло 2026-08-05.

1. `git rm -r legacy`.
2. `.prettierignore`: видалити рядок `legacy`.
3. `grep -rn "legacy/" CLAUDE.md README.md docs/*.md` → у кожному місці
   замінити посилання на речення «Legacy Apps Script app removed 2026-09
   (last commit with it: `<hash>`)», де `<hash>` — коміт перед видаленням.
   ADR-файли (`docs/decisions/0001…0013`) не редагувати: вони історичні.
4. `CLAUDE.md`: видалити абзац «The legacy Apps Script app is archived…» і
   рядок `legacy/apps-script/` у дереві.

---

## 7. Питання до власника (не блокують кроки 2–4, 6.x)

1. Untracked у робочому дереві: `output/`, `AGENTS.md`, `CONTEXT.md`,
   `scripts/product-taxonomy/generate-rebuild-backfill.mjs`,
   `scripts/product-taxonomy/rebuild-live-inventory.mjs`. Закомітити чи додати
   в `.gitignore`? (`output/` виглядає як артефакти аудиту таксономії.)
2. Автодеплой міграцій і Edge Functions з CI: додати секрети
   `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD` у
   GitHub і дозволити `deploy.yml` робити `db push` + `functions deploy`?
   Без цього фронт на `main` може випереджати схему.
3. Крок 1 і 6.6 потребують `npx supabase db push` + регенерації типів між
   написанням коду і зеленим typecheck.

## 8. Чеклист PR (копіювати в опис кожного PR)

- [ ] Гілка `refactor/<крок>`, один крок.
- [ ] `npm run lint` / `npm run typecheck` / `npm run test` зелені.
- [ ] `deno check` обох функцій + `deno lint supabase/functions` зелені (якщо крок торкався `supabase/functions`).
- [ ] Нові міграції — новими файлами; `database.types.ts` регенеровано (якщо торкались схеми).
- [ ] `CLAUDE.md` / `docs/` оновлені там, де змінилась структура.
- [ ] Кількість тестів не зменшилась; нові тести з розділу «Тести» кроку додані.
- [ ] Ручний smoke описаний у PR (які сторінки відкривали, що перевіряли).

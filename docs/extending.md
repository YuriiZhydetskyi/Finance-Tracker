# Extending — рецепти на розширення

> Кожен рецепт — нумерований чеклист. Виконуй кроки в порядку — це гарантує що схема, типи, хуки, ESLint і тести лишаються синхронізованими.

Перш ніж щось додати — переконайся, що:

- Зміна не порушує [schema-evolution rule](data-model.md#schema-evolution-rule) (forward-only migrations, не редагувати committed).
- Якщо рішення нетривіальне — створи новий ADR у [decisions/](decisions/) **перед** кодом.

---

## Рецепт 1: Додати категорію

**Сценарій:** Помічаєш що "Інше" має забагато записів — потрібна нова категорія "Тварини".

1. Відкрий Studio → SQL editor.
2. Виконай:
   ```sql
   insert into public.categories (name, group_name)
     values ('Тварини', 'Побут');
   ```
3. Готово. Frontend підхопить наступним `useCategories()` refetch (через 5 хв) або immediate refresh браузера (`/manual` чи `/photo` отримають оновлений список з бази).

**Не треба:** змінювати код, deploy-ити, міграції, типи. `categories` — read-only через RLS, тому frontend ніколи не пише; AI промпт читає список з контексту через `useCategories` hook → передає у `parseReceiptService.parse({ categories })`.

> **Корисно для німецьких чеків:** додай `('Pfand', 'Інше')` — Gemini промпт автоматично присвоюватиме її depositним рядкам.

---

## Рецепт 2: Додати нову таблицю

**Сценарій:** Хочеш окремо відстежувати підписки з періодичністю (місячні / річні).

1. **ADR.** Якщо рішення нетривіальне (наприклад, як модельувати recurring vs. one-time) — створи ADR `XXXX-subscriptions.md`. Інакше можна без ADR.

2. **Міграція.** Створи `supabase/migrations/<YYYYMMDDHHMMSS>_add_subscriptions.sql`:

   ```sql
   create type public.subscription_period as enum ('monthly', 'yearly');

   create table public.subscriptions (
     id            text primary key,                          -- ULID
     name          text not null,
     amount_eur    numeric(12, 2) not null,
     period        public.subscription_period not null,
     paid_by       text not null check (paid_by like '%@%'),
     started_at    date not null,
     canceled_at   date,
     note          text,
     created_at    timestamptz not null default now(),
     updated_at    timestamptz not null default now()
   );

   create index idx_subscriptions_paid_by on public.subscriptions (paid_by);

   create trigger trg_subscriptions_updated_at
     before update on public.subscriptions
     for each row execute function public.set_updated_at();

   alter table public.subscriptions enable row level security;
   create policy "allowlist_all_subscriptions" on public.subscriptions
     for all using (public.is_allowed_user()) with check (public.is_allowed_user());
   ```

3. **Apply і regen types:**

   ```powershell
   npx supabase db push
   $out = npx supabase gen types typescript --linked
   [System.IO.File]::WriteAllText("$PWD\web\src\shared\types\database.types.ts", ($out -join "`n"), [System.Text.UTF8Encoding]::new($false))
   ```

4. **Domain (Zod schema + factory).** Додай у `packages/domain/src/schemas.ts`:

   ```ts
   export const SubscriptionSchema = z.object({
     id: ULID_SCHEMA,
     name: z.string().min(1),
     amount_eur: z.number().finite().positive(),
     period: z.enum(['monthly', 'yearly']),
     paid_by: EMAIL_LIKE_SCHEMA,
     started_at: ISO_DATE_SCHEMA,
     canceled_at: ISO_DATE_SCHEMA.nullable(),
     note: z.string().nullable(),
     created_at: z.string(),
     updated_at: z.string(),
   });
   export type Subscription = z.infer<typeof SubscriptionSchema>;
   ```

   Додай factory у `packages/domain/src/factories.ts`:

   ```ts
   export function makeSubscription(input: SubscriptionInput): Subscription { ... }
   ```

   Domain unit-тести.

5. **Feature folder.** Створи `web/src/features/subscriptions/` за патерном існуючих:

   ```
   features/subscriptions/
   ├── api/
   │   ├── subscriptions-query-keys.ts
   │   ├── use-subscriptions.ts
   │   ├── use-save-subscription-mutation.ts
   │   └── use-delete-subscription-mutation.ts
   ├── components/
   │   ├── SubscriptionsList.tsx
   │   └── SubscriptionForm.tsx
   ├── schemas/subscription-form.ts        (Zod + RHF resolver)
   └── index.ts                            (barrel)
   ```

6. **Route.** Створи `web/src/routes/subscriptions.tsx` за патерном `recent.tsx`:

   ```tsx
   export const Route = createFileRoute('/subscriptions')({
     component: SubscriptionsPage,
     validateSearch: z.object({}).optional(),
   });
   ```

7. **Home button.** Додай `<Link to="/subscriptions">` у `web/src/routes/index.tsx`.

8. **Тести.** Vitest для query hooks (`vi.mock('@/shared/lib/supabase-client')`), для mutations, для form component.

9. **Stats integration (опційно).** Якщо хочеш чарт — додай view у нову міграцію:

   ```sql
   create view public.v_stats_subscriptions_monthly with (security_invoker = on) as
   select sum(case when period = 'monthly' then amount_eur
                   when period = 'yearly' then amount_eur / 12.0 end)::numeric(14,2)
            as monthly_burden,
          count(*) as count
   from public.subscriptions
   where canceled_at is null;
   ```

   Хук + chart-component у `features/stats/`.

10. `npm run lint && typecheck && test && build` → все зелене → commit + push.

---

## Рецепт 3: Замінити AI-провайдера (Gemini → новий)

**Сценарій:** OpenAI випустив model 5.0 і ти хочеш спробувати її замість Gemini для парсингу чеків.

Reference implementation — [`supabase/functions/parse-receipt/providers/anthropic-provider.ts`](../supabase/functions/parse-receipt/providers/anthropic-provider.ts).

1. **Створи provider-файл** у `supabase/functions/parse-receipt/providers/openai-provider.ts`:

   ```ts
   import type { IAiProvider } from './ai-provider.ts';
   import type { ParsedReceipt, AiContext } from '../types.ts';
   import { buildPrompt, buildSchema } from '../prompts/receipt-prompt.ts';

   const MODEL = 'gpt-5-vision'; // або інший

   export class OpenAiProvider implements IAiProvider {
     name = 'openai';
     constructor(private apiKey: string) {}
     async parse(imageBase64: string, mimeType: string, ctx: AiContext): Promise<ParsedReceipt> {
       const prompt = buildPrompt(ctx);
       const schema = buildSchema(ctx);
       const response = await fetch('https://api.openai.com/v1/chat/completions', {
         method: 'POST',
         headers: {
           Authorization: `Bearer ${this.apiKey}`,
           'Content-Type': 'application/json',
         },
         body: JSON.stringify({
           model: MODEL,
           messages: [
             { role: 'system', content: prompt },
             {
               role: 'user',
               content: [
                 {
                   type: 'image_url',
                   image_url: { url: `data:${mimeType};base64,${imageBase64}` },
                 },
               ],
             },
           ],
           response_format: { type: 'json_schema', json_schema: { name: 'receipt', schema } },
         }),
       });
       if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
       const json = await response.json();
       return JSON.parse(json.choices[0].message.content) as ParsedReceipt;
     }
   }
   ```

2. **Зареєструй у `config.ts`** (або `handler.ts` залежно від чого використовуємо):

   ```ts
   export async function loadDeps(): Promise<HandlerDeps> {
     const openaiKey = Deno.env.get('OPENAI_API_KEY');
     // ... existing gemini + anthropic
     return {
       primary: new OpenAiProvider(openaiKey!),       // або swap order
       fallback: new GeminiProvider(geminiKey!),
       isAllowed: ...,
       log: console.log,
     };
   }
   ```

3. **Set secret і deploy:**

   ```powershell
   npx supabase secrets set OPENAI_API_KEY=sk-...
   npx supabase functions deploy parse-receipt
   ```

4. **Тести.** Скопіюй `handler.test.ts` patterns — provider тестується окремо як unit-test з мокнутим `fetch`.

5. **Не треба** чіпати: client-side adapter (`edge-fn-parse-receipt.ts`), domain, UI. Контракт `IParseReceiptService` стабільний; провайдер — деталь Edge Function.

> Існуючий fallback контракт (Gemini → Claude per ADR-0011): primary fails → log warning → try fallback → if both fail throw combined error. Якщо хочеш зробити OpenAI primary — swap у `config.ts`. Хочеш chain з 3+ провайдерами — переходь на reduce-loop у `handler.ts` (наразі hardcoded дві гілки).

---

## Рецепт 4: Додати поле в існуючу таблицю

**Сценарій:** Хочеш додати `tax_amount` колонку у `receipts` (для бухгалтерії в майбутньому).

1. **Schema-evolution rule.** Forward-only migration. Не редагуй committed migration; завжди новий файл.

2. **Міграція** `supabase/migrations/<timestamp>_add_tax_amount.sql`:

   ```sql
   alter table public.receipts
     add column tax_amount numeric(12, 2) check (tax_amount >= 0);
   ```

   (Nullable за замовчуванням; default-фолбек — пусто. Не треба backfill для нової колонки якщо її mean'ing — "невідомо для старих чеків".)

3. **Apply + regen types** (як у Recipe 2 step 3).

4. **Domain.** Додай поле у `ReceiptSchema` (`packages/domain/src/schemas.ts`):

   ```ts
   tax_amount: z.number().finite().nonnegative().nullable().optional(),
   ```

   Якщо це derived поле — додай у factory `makeReceipt`. Інакше — просто прокидати з input.

5. **Form schema.** Якщо UI має заповнювати — додай у [`web/src/features/receipts/schemas/manual-form.ts`](../web/src/features/receipts/schemas/manual-form.ts) і у `<ReceiptFormFields>`.

6. **Mutations.** `useSaveReceiptMutation` приймає `SaveReceiptInput = Omit<ReceiptInput, 'fx_rate_eur' | 'total_orig'>` — нове поле автоматично пропадає у мутацію через type. Перевір mapping у `<ManualReceiptForm>` / `<EditReceiptForm>` `onSubmit`.

7. **AI prompt (якщо AI має заповнювати поле).** Розшир [`supabase/functions/parse-receipt/prompts/receipt-prompt.ts`](../supabase/functions/parse-receipt/prompts/receipt-prompt.ts) — додай поле у JSON schema і у evidence-приклади. Регенерувати types на клієнті.

8. **Tests.** Domain factory test, form-test (якщо required), save-mutation test (опційно).

9. **Backfill (для існуючих рядків).** Якщо потрібно — окрема UPDATE-міграція або Studio SQL editor:
   ```sql
   update public.receipts set tax_amount = round(total_orig * 0.19, 2)
     where tax_amount is null and date >= '2024-01-01';
   ```

> **Приклади з історії:** `items.wasted_qty` (ADR-0009) і `items.discount_orig` (ADR-0012) — обидва додані за цим рецептом: вузька колонка `numeric` з default `0` в кінці таблиці, оновлено `makeItem` + Zod schema + form fields. Решта — без змін.

---

## Рецепт 5: Promote item → product (майбутнє, поки не реалізовано)

**Сценарій (post-MVP):** Помічаєш, що часто купуєш "Помідори чері Aldi 250g" — хочеш почати трекати ціну.

Поки не реалізовано в MVP. Коли робимо:

1. У `<EditReceiptForm>` — додаємо кнопку "Promote to Product" біля item row.
2. На клік — створюється новий `Product` з даних item; `item.product_id` оновлюється.
3. Опційно: fuzzy-search схожих історичних items без `product_id`, пропонує лінкувати партіями.

Створи ADR-XXXX перед реалізацією. Backfill — окрема utility-сторінка `/products/management` (теж out of MVP).

---

## Рецепт 6: Додати нову валюту

**Сценарій:** Поїхали в Польщу, треба підтримка PLN.

> Поточно підтримуються тільки **EUR (база) + UAH (через NBU)**. Це усвідомлене рішення — див. [ADR-0004](decisions/0004-multi-currency-eur-base.md).

1. **Знайди джерело курсу для нової валюти.** Варіанти:
   - **ECB Reference Rates** — `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` (PLN, USD, GBP, JPY, CHF, CZK, HUF, ... ~30 валют). XML, public, CORS-open. Не містить UAH, RUB.
   - **NBU** — тільки UAH.
   - **Інші API** — новий ADR з обґрунтуванням.

2. **Розшир Supported currencies** у `web/src/features/receipts/schemas/manual-form.ts`:

   ```ts
   export const SUPPORTED_CURRENCIES = ['EUR', 'UAH', 'PLN'] as const;
   ```

3. **Розшир `nbu-fx-rate-provider.ts`** ([web/src/shared/lib/fx-rate/nbu-fx-rate-provider.ts](../web/src/shared/lib/fx-rate/nbu-fx-rate-provider.ts)) — або краще створи **окремий ECB adapter**:
   - **Якщо PLN — окремий provider:** sibling файл `ecb-fx-rate-provider.ts`. Реалізуй `IFxRateProvider`. У `web/src/shared/lib/fx-rate/index.ts` обери який експортувати.
   - **Або chain provider:** `chain-fx-rate-provider.ts` що делегує по valcode (UAH→NBU, інші→ECB). Чистіший підхід для multi-currency.

4. **Тести.** `web/src/shared/lib/fx-rate/__fixtures__/ecb-daily-sample.xml` — реальний snapshot ECB feed. Drift contract test переконується що PLN там є і shape матчить (як `nbu-fx-rate-provider.test.ts`).

5. **CancellationCard / форми.** Currency dropdown у `<ReceiptFormFields>` (через `SUPPORTED_CURRENCIES`) автоматично підхопить нову валюту.

6. **Тестовий чек.** Створи manual receipt з `currency: 'PLN'`. Переконайся, що `fx_rate_eur` і `total_eur` коректні.

7. **Update [ADR-0013](decisions/0013-migrate-to-react-supabase.md) Changelog** з новою валютою — або revisit ADR-0004 (multi-currency).

---

## Рецепт 7: Додати новий port (vendor-swap-able adapter)

**Сценарій:** Хочеш замінити Supabase Storage на Cloudflare R2 для photo storage. Або додати порт для нової інтеграції (наприклад, push notifications).

Reference: будь-який існуючий порт у `web/src/shared/lib/<area>/` ([auth/](../web/src/shared/lib/auth/), [fx-rate/](../web/src/shared/lib/fx-rate/), [parse-receipt/](../web/src/shared/lib/parse-receipt/), [photo-storage/](../web/src/shared/lib/photo-storage/)).

1. **Структура** `web/src/shared/lib/<your-port>/`:

   ```
   <your-port>/
   ├── <your-port>.types.ts        — interface IYourService + supporting types
   ├── <vendor>-<your-port>.ts     — adapter (одна на vendor)
   └── index.ts                    — re-export interface + singleton
   ```

2. **Interface.** Тримай мінімальним — тільки те, що app реально використовує. 3–5 методів. Уникай leaky abstractions (vendor-specific параметри, вендор-специфічні error types).

3. **Adapter.** Імпортує `supabase` (або інший vendor SDK) з `../supabase-client`. ESLint exemption через `eslint.config.js` для `**/shared/lib/**/*-*.ts`.

4. **Barrel.**

   ```ts
   export type { IYourService } from './your-port.types';
   export { vendorYourService as yourService } from './vendor-your-port';
   ```

5. **Re-export з `dependencies.ts`:**

   ```ts
   export { yourService } from './<your-port>';
   export type { IYourService } from './<your-port>';
   ```

6. **Routes/components/hooks** імпортують `yourService` з `@/shared/lib/dependencies`. ESLint блокує імпорт vendor-client напряму.

7. **Тести.** Vitest з `vi.mock('../supabase-client')` (або іншого vendor) per [`supabase-photo-storage.test.ts`](../web/src/shared/lib/photo-storage/supabase-photo-storage.test.ts) patterns.

8. **Swap.** Один день: пиши sibling adapter (`r2-your-port.ts`), змінюєш `index.ts` re-export. Все інше app-у не торкається.

---

## Рецепт 8: Додати нову UI сторінку

**Сценарій:** Хочеш окрему сторінку `/products` для пошуку товару у каталозі.

Reference: [`web/src/routes/recent.tsx`](../web/src/routes/recent.tsx) як простий приклад list-сторінки; [`/photo`](../web/src/routes/photo.tsx) як state-machine приклад.

1. **Route file.** TanStack Router file-based — створи `web/src/routes/products.tsx`:

   ```tsx
   import { createFileRoute } from '@tanstack/react-router';
   import { z } from 'zod';
   import { RequireAuth } from '@/features/auth';
   import { ProductsList } from '@/features/products';

   export const Route = createFileRoute('/products')({
     component: ProductsPage,
     validateSearch: z.object({ q: z.string().optional() }).optional(),
   });

   function ProductsPage() {
     return (
       <RequireAuth>
         <ProductsList />
       </RequireAuth>
     );
   }
   ```

   `tsr generate` (запускається через `npm run typecheck` / `build`) автоматично реєструє маршрут у `routeTree.gen.ts`.

2. **Feature folder.** Якщо ще нема `web/src/features/products/components/` — створи. Для `useProducts` хук уже існує.

3. **Home button.** Додай `<Link to="/products">` у [`web/src/routes/index.tsx`](../web/src/routes/index.tsx).

4. **Header nav (опційно).** Якщо хочеш у global nav — `web/src/features/auth/components/Header.tsx` (якщо такий є — поточно sign-out тільки).

5. **Tests.** Component-tests для `<ProductsList>` через testing-library. Mock `useProducts` hook через `vi.mock`.

6. **Type-safe search params.** TanStack Router infer'ить тип `search` з `validateSearch` schema:
   ```tsx
   const { q } = Route.useSearch();
   navigate({ to: '/products', search: { q: 'мол' } });
   ```

---

## Рецепт 9: Додати UI-тест для нової сторінки / компонента

**Сценарій:** Створив `<ProductsList>` (Recipe 8). Хочеш ловити render regressions.

Reference: [`web/src/features/receipts/components/ReceiptCard.test.tsx`](../web/src/features/receipts/components/ReceiptCard.test.tsx) — render-only тест з мокнутим Link; [`web/src/features/photo/api/use-save-photo-receipt-mutation.test.tsx`](../web/src/features/photo/api/use-save-photo-receipt-mutation.test.tsx) — hook тест з QueryClient wrapper.

1. **Pure render тест:**

   ```tsx
   import { describe, it, expect, vi } from 'vitest';
   import { render, screen } from '@testing-library/react';
   import { ProductsList } from './ProductsList';

   vi.mock('@tanstack/react-router', () => ({
     Link: ({ children, to }: any) => <a href={to}>{children}</a>,
   }));

   vi.mock('../api/use-products', () => ({
     useProducts: () => ({
       data: [{ id: '1', name: 'Pesto', category: 'Бакалія' }],
       isLoading: false,
       isError: false,
     }),
   }));

   describe('ProductsList', () => {
     it('renders product names', () => {
       render(<ProductsList />);
       expect(screen.getByText('Pesto')).toBeInTheDocument();
     });
   });
   ```

2. **Hook тест з QueryClient:**

   ```tsx
   import { renderHook, waitFor } from '@testing-library/react';
   import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
   import { useYourMutation } from './use-your-mutation';

   function wrapper({ children }) {
     const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
     return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
   }
   // ... renderHook(() => useYourMutation(), { wrapper });
   ```

3. **Що mock'ати:**
   - `@/shared/lib/supabase-client` — для будь-яких хуків/адаптерів що говорять з БД.
   - `@/shared/lib/dependencies` — для wrapper-mutations що стучать у кілька портів.
   - `@tanstack/react-router` — для render-only тестів компонентів з `<Link>`.

4. **Що jsdom НЕ покриває:**
   - Canvas (Chart.js) — manual smoke або майбутня Playwright.
   - Native `<dialog>` (потрібен stub `HTMLDialogElement.prototype.showModal/close` у `beforeAll`).
   - File input UX, drag-drop, real `URL.createObjectURL` поведінка — manual smoke.

---

## Рецепт 10: Налаштувати custom domain на Cloudflare Pages

**Сценарій:** Хочеш `finance.example.com` замість `finance-tracker.pages.dev`.

1. У Cloudflare dashboard → Workers & Pages → finance-tracker → Settings → Custom domains → Add domain.

2. Якщо домен вже у Cloudflare DNS — Cloudflare автоматично додасть CNAME запис. Якщо ні — додай вручну `CNAME finance → finance-tracker.pages.dev`.

3. Підтверди — SSL cert згенерується автоматично за 1–2 хвилини.

4. **Update Supabase Auth URL Configuration:**
   - Studio → Authentication → URL Configuration
   - Site URL: `https://finance.example.com`
   - Redirect URLs: додати `https://finance.example.com/auth/callback` (старий `pages.dev` залиш для preview deploys)

5. (Опційно) Update [docs/project-status.md](project-status.md) з новим URL.

---

## Out of MVP — потенційні майбутні фічі

Перелічуємо, щоб майбутній-ти не починав з нуля. **НЕ** реалізовуй це поки не з'явиться явна потреба:

- **Settlements** (хто кому винен) — окрема таблиця, новий ADR. Бере дані з `items.consumed_by` для агрегації.
- **Bulk історичний імпорт** з банківських виписок CSV/PDF.
- **Promote item → product** з backfill схожих історичних items (Recipe 5).
- **Products management** сторінка для merge duplicates, rename canonical names.
- **Multi-event spoilage** (заміна `wasted_qty` колонки на таблицю `spoilage`).
- **product_prices** матеріалізована таблиця (тільки якщо аналітика стане повільною; поки що `v_stats_*` views достатньо).
- **Audit log** — `audit_log` таблиця з тригерами на receipts/items.
- **Soft-delete** з `deleted_at` (тільки якщо знайдемо use-case).
- **Daily AI cost cap** — counter у Postgres / KV з invocation rate-limit у Edge Function (поточно нема, free tier покриває).
- **PWA / offline** — `vite-plugin-pwa`, sync queue для offline saves. Корисно якщо часто фотографуємо без зв'язку.
- **E2E тести (Playwright)** — реальний браузер + supabase start локально.
- **Custom domain + CDN-кеш стратегія** — якщо переходимо у платний tier для більшого scale.

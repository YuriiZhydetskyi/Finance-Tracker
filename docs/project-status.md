# Project Status

> Точка входу для нової сесії. Коротко: що є, що далі, на що дивитись першим. Оновлюється у кінці кожної фази.

**Останнє оновлення:** 2026-05-07 (Phase 7 — `parse-receipt` Edge Function написана; production deploy + інтеграція з реальним фото deferred до Phase 8)

---

## TL;DR

- **Старий стек (Apps Script + Sheets + Alpine.js)** заархівовано в [`legacy/apps-script/`](../legacy/apps-script/) — досі білдиться (164 тести), залишається для emergency rollback.
- **Новий стек:** React 19 + Vite 8 + Tailwind 4 + TanStack Query 5 + TanStack Router + Supabase (Postgres + Auth + Storage + Edge Functions) + Cloudflare Pages (deploy у Phase 10). $0/місяць.
- **Архітектура:** Ports & Adapters lite — vendor-coupled код тільки у `web/src/shared/lib/<area>/` адаптерах і `supabase/functions/<fn>/providers/`. Domain-логіка — окремий vendor-free TS пакет `packages/domain/` (порт `Domain.js`).
- **Прогрес:** 7 з 11 фаз готові. Auth + `/manual` + `/recent` + `/edit/$id` працюють end-to-end (тести зелені, окремі manual-smoke кроки deferred). `parse-receipt` Edge Function написана + перевірена через `deno check` / `deno lint` локально, але ще не задеплоєна і ще немає UI що її викликає.
- **Наступне:** Phase 8 — `/photo` сторінка (uploader + клієнт resize + виклик Edge Function + `<CancellationCard>` per ADR-0012 + Supabase Storage адаптер).

Повний план з SOLID/GRASP/DRY обґрунтуванням, версіями і фазами — `~/.claude/plans/modular-swinging-blossom.md` (на машині розробника).

---

## Стек (актуальні версії, May 2026)

### Frontend (`web/`)

| Пакет                                                  | Версія                  | Роль                                                           |
| ------------------------------------------------------ | ----------------------- | -------------------------------------------------------------- |
| react / react-dom                                      | 19.2.6                  | UI                                                             |
| vite                                                   | 8.0.11                  | dev server + build (Rolldown bundler)                          |
| @tailwindcss/vite + tailwindcss                        | 4.2.4                   | CSS-first без `tailwind.config.js`                             |
| @tanstack/react-query                                  | 5.100.9                 | server state                                                   |
| @tanstack/react-router                                 | 1.169.2                 | type-safe routing, file-based                                  |
| @tanstack/router-plugin / -cli                         | 1.167.x / 1.166.x       | route generation                                               |
| @supabase/supabase-js                                  | 2.105.3                 | Auth + DB + Storage клієнт                                     |
| zod                                                    | 4.4.3                   | runtime validation + TS types                                  |
| react-hook-form + @hookform/resolvers                  | 7.75.0 / 5.2.2          | форми                                                          |
| chart.js + react-chartjs-2                             | 4.5.1 / 5.3.1           | дашборди (Phase 9)                                             |
| typescript                                             | 6.0.3                   | strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes |
| vitest + @testing-library/react + jsdom                | 4.1.5 / 16.3.2 / 29.1.1 | тести                                                          |
| eslint + typescript-eslint + react/react-hooks plugins | 9.39.4 / 8.59.2 / ...   | lint                                                           |
| prettier + lint-staged + husky                         | 3.8.3 / 17.0.2 / 9.1.7  | format + pre-commit                                            |

ESLint 9.x (не 10) — `eslint-plugin-react@7.37.5` ще не оновився під ESLint 10 peer dep. Як тільки оновиться — перейдемо.

### Backend / платформа

| Сервіс           | Налаштування                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Supabase project | `<your-project-ref>` (eu-west-2 за замовчуванням; перевірити у Settings → Infrastructure) |
| Supabase CLI     | 2.98.x як devDep, для `db push` / `gen types` / `functions deploy`                          |
| AI               | Gemini Flash primary + Claude Sonnet 4.6 fallback (порт ADR-0011) — реалізація Phase 7      |
| FX               | NBU live rates для UAH — клієнт-сайд (CORS-open public API) — Phase 5                       |
| Hosting (план)   | Cloudflare Pages для frontend, Supabase Edge Functions для AI proxy — Phase 10              |

---

## Структура репо

```
finance-tracker/
├── legacy/apps-script/         ← старий додаток, frozen (164 тести зелені)
├── docs/                       ← ADR-и + цей файл
├── web/                        ← React + Vite + Tailwind app
│   ├── src/
│   │   ├── routes/             ← TanStack Router file-based (__root, index, manual, recent, edit.$id, auth.callback)
│   │   ├── features/           ← vertical slices (auth, receipts, categories, products)
│   │   │   ├── auth/{api,components,guards,index.ts}
│   │   │   ├── receipts/{api,components,hooks,schemas,utils,index.ts}
│   │   │   ├── categories/{api,index.ts}
│   │   │   └── products/{api,index.ts}
│   │   ├── shared/
│   │   │   ├── lib/            ← порти + адаптери (auth/, fx-rate/, parse-receipt/, supabase-client, dependencies, query-client, env)
│   │   │   ├── ui/             ← design system (Button, Input, cn)
│   │   │   ├── utils/          ← format-money, format-date
│   │   │   └── types/          ← згенеровані Supabase types
│   │   ├── styles/tailwind.css ← @import "tailwindcss";
│   │   ├── main.tsx            ← QueryClientProvider + RouterProvider
│   │   └── router.ts
│   ├── .env.example            ← committed, шаблон
│   ├── .env.local              ← gitignored, реальні URL+anon-key
│   ├── eslint.config.js        ← flat, з no-restricted-imports для supabase-client
│   ├── tsconfig.{json,app,node} ← project references
│   └── vite.config.ts          ← + tanstackRouter() + tailwindcss() + react()
├── packages/domain/            ← @finance-tracker/domain workspace (vendor-free)
│   ├── src/                    ← {money,ulid,time,consumed-by,schemas,factories,pair-detector}.ts + tests
│   ├── eslint.config.js        ← блокує imports react/supabase/vite
│   └── tsconfig.json
├── supabase/
│   ├── config.toml             ← supabase init defaults; edge_runtime deno_version=2
│   ├── migrations/20260507000001_initial_schema.sql
│   ├── seed.sql                ← 20 категорій
│   ├── functions/parse-receipt/ ← Phase 7: AI OCR Edge Function (Deno)
│   │   ├── index.ts            ← Deno entry (3 рядки)
│   │   ├── handler.ts          ← portable (Request) => Response
│   │   ├── config.ts           ← Deno-only: env + Supabase client + isAllowed
│   │   ├── types.ts            ← ParsedReceipt mirror (vendored ~25 LOC)
│   │   ├── providers/{ai-provider,gemini-provider,anthropic-provider}.ts
│   │   ├── prompts/receipt-prompt.ts ← buildPrompt + buildSchema (verbatim port)
│   │   ├── deno.json           ← imports map: @supabase/supabase-js → npm:
│   │   └── README.md           ← deploy, auth model, drift discipline
│   └── README.md               ← інструкції local + remote
├── package.json                ← npm workspaces root, scripts
├── tsconfig.base.json          ← shared compiler options
└── .husky/pre-commit           ← lint-staged
```

---

## Що зроблено (Phases 0–7)

### ✅ Phase 0 — Archive (2026-05-07)

- Перенесено `src/`, `tests/`, `.clasp.json`, `eslint.config.mjs`, `package*.json`, `tsconfig.json` у [`legacy/apps-script/`](../legacy/apps-script/) через `git mv` (історія збережена як `R` rename).
- Старий `node_modules` видалено з кореня.
- Legacy досі білдиться: `npm --prefix legacy/apps-script run lint && typecheck && test` → 164/164 зелені.
- Створено [`legacy/apps-script/README.md`](../legacy/apps-script/README.md) з інструкцією, як reactivate.

### ✅ Phase 1 — Scaffold (2026-05-07)

- Корінь: `package.json` з `"workspaces": ["web", "packages/*"]`, root scripts (`dev`, `build`, `lint`, `typecheck`, `test`, `format`).
- `tsconfig.base.json` з strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`.
- `web/`: Vite 8 + React 19 + Tailwind 4 + TS strict.
- `packages/domain/`: workspace package, source-as-package (`main: ./src/index.ts`), без build step.
- Prettier + lint-staged + husky pre-commit.
- ESLint flat config з port discipline (`no-restricted-imports` блокує `supabase-client` за межами адаптерів і `features/**/api/**`).
- **Verified:** `npm run lint`, `typecheck`, `test`, `build` зелені; `npm run dev` стартує за 343ms.

### ✅ Phase 2 — Domain port (2026-05-07)

- Перенесено `legacy/apps-script/src/Domain.js` → `packages/domain/src/{money,ulid,time,consumed-by,schemas,factories,pair-detector}.ts`.
- Zod schemas заміняють імперативні validate-функції; `z.infer` дає TS-типи: `Receipt`, `Item`, `Product`, `ParsedReceipt`, `ParsedItem`, `ReceiptInput`, `ItemInput`, `ProductInput`.
- Cross-field invariants (`wasted_qty <= qty`, `discount_orig <= unit_price_orig` коли positive) через `superRefine`.
- Factories (`makeReceipt`, `makeItem`, `makeProduct`) — єдине sanctioned API для створення entities. Patch helpers (`applyReceiptPatch`, `applyItemPatch`).
- Pair detector (ADR-0012) — повний порт `pairDetector.html`.
- **Tests:** 69 (port усіх 33 Domain unit + 16 pair-detector + додаткові).
- **Verified:** workspace-import з `web/` (`import { ulid } from '@finance-tracker/domain'`) працює end-to-end через Vite resolution.

### ✅ Phase 3 — Supabase schema (2026-05-07)

- `supabase/migrations/20260507000001_initial_schema.sql`:
  - 4 таблиці (`categories`, `products`, `receipts`, `items`) з ULID-text PK, `numeric(12,2)` гроші, `numeric(10,3)` qty, `numeric(14,6)` fx_rate.
  - Enums `receipt_source`, `product_unit`.
  - FK + `on delete cascade` (items → receipts), `on delete set null` (items → products).
  - Indexes: `receipts(date desc)`, `receipts(paid_by, date desc)`, `items(receipt_id)`, `items(category)`, `items(product_id)`.
  - Triggers `set_updated_at()` на 3 таблицях.
  - **RLS allowlist** через `public.app_users` + `public.is_allowed_user()` helper. Policies для `receipts/items/products` — повний доступ allowlisted users; `categories` — read-only; `app_users` — self-read.
- `supabase/seed.sql` — 20 категорій з [`docs/data-model.md`](data-model.md).
- **Applied to remote project** `<your-project-ref>` через `npx supabase db push`.
- `web/src/shared/types/database.types.ts` згенеровано з `npx supabase gen types typescript --linked` (UTF-8, no-BOM).
- `web/src/shared/lib/env.ts` — Zod-validated reader для `import.meta.env.VITE_SUPABASE_*`.
- `web/src/shared/lib/supabase-client.ts` — typed Supabase client singleton (приватний; ESLint блокує імпорт за межами адаптерів).
- **Verified:** REST `GET /rest/v1/categories` з anon key → `200 []` (RLS блокує не-allowlisted user як очікується).

### ✅ Phase 4 — Auth shell (2026-05-07)

- TanStack Router file-based роути: `__root.tsx` (header + outlet), `index.tsx` (`/` через `<RequireAuth>`), `auth.callback.tsx` (magic link landing).
- `web/src/router.ts` — router instance + module augmentation для type safety.
- `web/src/main.tsx` — `<QueryClientProvider>` + `<RouterProvider>`.
- `web/src/shared/lib/query-client.ts` — QueryClient з staleTime 60s, retry-skip на 401/403.
- **Auth port** (плану §0.3): `auth.types.ts` (`IAuthService`), `supabase-auth-service.ts` (адаптер), `auth/index.ts` (export `authService`). Swap до Clerk = одна змінена строка.
- `web/src/shared/lib/dependencies.ts` — barrel для всіх портів.
- Hooks: `useCurrentUser` (subscribed на `onAuthStateChange`), `useSignInMutation` (magic link), `useSignOutMutation`, `useAllowlistCheck` (читає `app_users` per RLS).
- `<SignInForm>` — react-hook-form + zod email validator + success state.
- `<Header>` — email + "Вийти".
- `<RequireAuth>` guard — 4 стани: loading / unauth / unauth-but-not-allowlisted / authed-and-allowlisted.
- Design primitives: `<Button>` (primary/secondary/ghost/danger), `<Input>`, `cn()` (clsx + tailwind-merge).
- **Tests:** 4 web (cn helper) + 69 domain = 73 зелені. Build 285ms (248KB main + 380KB auth chunk gzipped 78KB + 107KB).
- **Verified end-to-end (manually):** sign-in → magic link → `/auth/callback` → redirect → "Готово до роботи" → "Вийти" → форма входу. RLS правильно блокує не-allowlisted users.

### ✅ Phase 5 — `/manual` page (2026-05-07)

- **FX port** (`web/src/shared/lib/fx-rate/`): `IFxRateProvider` interface + `nbu-fx-rate-provider.ts` (порт `legacy/Fx.js` — fetch до `bank.gov.ua`, інверсія EUR-to-UAH → UAH-to-EUR через `roundFxRate`, 7-day walk-back для weekends/свят). Викликається напряму з браузера (NBU CORS-open). Drift contract test проти pinned fixture у `__fixtures__/nbu-uah-sample.json`.
- **Categories + Products read hooks** (`features/categories/`, `features/products/`): `useCategories()` / `useProducts()` через Supabase REST з `staleTime: 5 хв`. RLS-aware (повертають `[]` поки користувач не у `app_users`).
- **`useSaveReceiptMutation`** (`features/receipts/api/use-save-receipt-mutation.ts`):
  1. `fxRateProvider.getRateLive(currency, date)` → `fx_rate_eur`.
  2. `total_orig` обчислюється з items на льоту (DRY: одна формула, не дрейфить між UI і mutation).
  3. `makeReceipt({ ...input, fx_rate_eur, total_orig })` — domain factory генерує id, округляє, валідує.
  4. `items.map(it => makeItem({ ...it, receipt_id, fx_rate_eur }))`.
  5. `supabase.from('receipts').insert(receipt)` → throw on error.
  6. `supabase.from('items').insert(items)` → on error: best-effort `delete from receipts where id = ?` (RLS дозволяє користувачу видаляти свій рядок) → throw з оригінальним повідомленням. Минімізує орфани без транзакції.
  7. `qc.invalidateQueries({ queryKey: ['receipts'] })`.
- **Form schema + hook** (`features/receipts/schemas/manual-form.ts`, `hooks/use-receipt-form.ts`): Zod схема дзеркалить mutation input (без `fx_rate_eur` і `total_orig` — derived). Currency narrowed до `['EUR', 'UAH']` enum на UI шарі. Defaults: `todayIso()`, EUR, paid_by = current user email, single empty row, `consumed_by: 'shared'`. RHF + `zodResolver` + `useFieldArray` для items.
- **Pure utils** (`features/receipts/utils/totals.ts`): `computeRowTotal`, `computeGrandTotal`, `computeCategoryBreakdown` — спільні для UI display і майбутніх pre-save валідаторів. Використовують `roundMoney` з `@finance-tracker/domain` — той же формула як у factory.
- **UI components** (`features/receipts/components/`):
  - `<ItemRow>` — editable row через `useFormContext`. Колонки: товар (datalist autocomplete), категорія (select), к-сть (number step 0.001 min 0), ціна (number step 0.01 **без min** — негативи дозволені per ADR-0012, поле підсвічується червоним якщо < 0). Extras: consumed_by select (6 пресетів — shared/his/hers/custom:30/70/custom:70/30), знижка, зіпсовано, нотатка. Per-row total (червоний якщо negative).
  - `<ItemsList>` — рендерить рядки через `useFieldArray`, datalist `<option>` для product autocomplete, кнопка "+ Додати товар".
  - `<SummaryFooter>` — grand total + per-category breakdown через `useWatch` + `useMemo`. Сортування категорій per `localeCompare('uk')`.
  - `<ManualReceiptForm>` — обгортає форму у `<FormProvider>`, рендерить header card (дата, магазин, валюта, paid_by, нотатка) + ItemsList + SummaryFooter + submit.
- **Page** (`routes/manual.tsx`): `<RequireAuth>` + `<ManualReceiptForm>`. На save success — `navigate({ to: '/', search: { saved: receipt_id } })`.
- **`routes/index.tsx`** оновлено: success-banner для `?saved=<id>` + кнопка "Додати чек вручну" → `/manual`.
- **Tests:** 24 web (cn helper + FX provider + drift fixture + totals utils) + 69 domain = **93 тести зелені**. Build 358ms; manual chunk 11KB (3.6KB gzip) завдяки TanStack Router auto-code-splitting.
- **Verified автоматично:** lint + typecheck + test + build чисті. `/manual` page-load smoke у браузері — рендериться.
- **НЕ верифіковано вручну** (deferred до першого реального чека): EUR і UAH save flow з реальною вставкою у Supabase. Якщо при першому реальному використанні щось зламається — найімовірніше місце: form values → mutation input mapping (ManualReceiptForm.onSubmit), Supabase insert RLS, або NBU walk-back на свято.

### ✅ Phase 6 — `/recent` + `/edit/$id` + delete (2026-05-07)

- **Read hooks** (`features/receipts/api/`): `useReceipts(limit=30)` сортує `date desc, created_at desc`, `staleTime: 30s`. `useReceipt(id)` робить дві паралельні запити (receipt + items) через `Promise.all`, повертає `null` якщо чек не знайдено / RLS приховує (для клієнта це одне і те ж).
- **`useUpdateReceiptMutation`**: re-fetch FX тільки якщо `currency` або `date` змінилися (інакше зберігається оригінальний `fx_rate_eur` для аудиту); `applyReceiptPatch` форсує `source: 'edit'`; items wholesale-replace (`UPDATE receipts → DELETE items → INSERT items`). Без транзакцій — Supabase JS їх не підтримує; failure після DELETE залишає видимий пустий чек, документується у README як Studio-cleanup path. RLS-allowed users можуть видаляти власні рядки, тому самовідновлення не потрібне для delete-mutation.
- **`useDeleteReceiptMutation`**: один `delete from receipts where id = ?`; FK `on delete cascade` забирає items.
- **Refactor** (`<ReceiptFormFields>`): з `<ManualReceiptForm>` витягнуто внутрішній JSX (header card + items + summary + error block + actions slot) у спільний компонент. `<ManualReceiptForm>` і `<EditReceiptForm>` тепер тонкі обгортки що володіють FormProvider + submit handler + actions. Save mutation перевикористовує `computeGrandTotal` (DRY: формула для grand total одна — для display і для mutation).
- **`<EditReceiptForm>`**: ініціалізується з `Receipt + Item[]`, мапить через `toFormCurrency` і `toFormRow`. Save / Cancel / Delete actions; Delete відкриває `<DeleteConfirmDialog>`. На success — `navigate({ to: '/recent', search: { saved: id } })`.
- **`<DeleteConfirmDialog>`**: native `<dialog>` + `showModal`/`close` через `useRef` + `useEffect`. Backdrop через `::backdrop` Tailwind selector.
- **`<ReceiptCard>`** + **`<EmptyReceiptsState>`**: list-view tile (store, EUR total, secondary line: date + non-EUR original + note); empty card з кнопкою → `/manual`. Negatives червоніють.
- **Routes**: `routes/recent.tsx` (loading / error / empty / list states + `?saved=<id>` banner) і `routes/edit.$id.tsx` (loading / error / not-found / form). Save flow тепер навігує на `/recent?saved=<id>` (раніше було `/`).
- **Util** (`shared/utils/format-date.ts`): `formatDate(iso, locale)` через cached `Intl.DateTimeFormat`. UTC parsing; ніколи не кидає помилку — повертає оригінальний рядок при невдачі.
- **Index page**: додано кнопку "Останні чеки" → `/recent`.
- **Tests:** 37 web (cn + FX + dates + totals + DeleteConfirmDialog + ReceiptCard) + 69 domain = **106 тести зелені**. Mutation glue не покрито Vitest — TS catches API misuse, manual smoke catches behavior. Domain-level логіка (factories, schemas) перекривається через 69 domain тестів.
- **Verified автоматично:** lint + typecheck + test + build чисті.
- **НЕ верифіковано вручну**: edit / delete flow у браузері з реальною Supabase інстансом.

### ✅ Phase 7 — `parse-receipt` Edge Function (2026-05-07)

- **Структура** (`supabase/functions/parse-receipt/`):
  - `index.ts` — Deno entry, 3 рядки. Swap до Cloudflare Worker = переписати тільки цей файл + `config.ts`.
  - `handler.ts` — pure `(Request) => Promise<Response>`, deps DI через `HandlerDeps`. CORS, 401/403/400/502 paths, primary→fallback orchestration.
  - `config.ts` — Deno-only: env loading через `Deno.env.get`, конструювання Supabase client, `isAllowed` callback (виклик `is_allowed_user()` RPC під JWT користувача — RLS робить роботу).
  - `types.ts` — `ParsedReceipt` + `AiContext` (mirror з `@finance-tracker/domain`, vendored-inline, ~25 LOC).
  - `providers/ai-provider.ts` — `IAiProvider { name, parse(image, ctx): Promise<ParsedReceipt> }` strategy interface.
  - `providers/gemini-provider.ts` — `gemini-3-flash-preview` через `responseJsonSchema`. Temperature 0.1.
  - `providers/anthropic-provider.ts` — `claude-sonnet-4-6` через forced `tool_use` (tool name `record_receipt`, schema той самий що у Gemini).
  - `prompts/receipt-prompt.ts` — `buildPrompt(ctx)` + `buildSchema(ctx)`. **Verbatim port** з legacy `Gemini._buildPrompt` / `_buildSchema` — драйф ловиться вручну при майбутніх змінах (документовано у README → "Drift discipline").
  - `deno.json` — imports map (тільки `@supabase/supabase-js` через `npm:`).
  - `README.md` — local serve, deploy, auth model, drift discipline.
- **AI fallback contract** (mirror ADR-0011): `primary.parse` → catch → log → `fallback.parse` → catch → throw combined message. Fallback rate видно у Supabase function logs через `console.warn`.
- **Auth model**: `verify_jwt = true` (Supabase platform default) блокує un-authed callers перед нашим кодом. Далі `is_allowed_user()` RPC під JWT користувача → ~10ms перевірка через RLS-protected select. Якщо JWT валідний але email не у `app_users` → 403.
- **Client port** (`web/src/shared/lib/parse-receipt/`): `IParseReceiptService { parse(input): Promise<ParsedReceipt> }` interface; `edgeFunctionParseReceiptService` адаптер викликає `supabase.functions.invoke('parse-receipt', { body })` і валідує відповідь через `ParsedReceiptSchema` (Zod з `@finance-tracker/domain`). Re-export через `shared/lib/dependencies.ts`.
- **Архітектурні рішення**:
  1. **Edge Function НЕ імпортує `@finance-tracker/domain`.** Vite-style workspace package не cleanly resolves з Deno; вендоринг 25 LOC `ParsedReceipt` types — pragmatic. Client side валідує через canonical `ParsedReceiptSchema` (Zod). Drift discipline у README.
  2. **NO server-side Zod.** Both providers enforce JSON schema natively (Gemini: `responseJsonSchema`; Claude: `tool_use input_schema`). Client validates on receipt — single source of truth.
  3. **Allowlist через існуючий `is_allowed_user()` RPC** замість service-role keys у функції.
- **Tests:** 42 web (+5: edge-fn-parse-receipt: invoke shape, valid response, error path, Zod-fail path, default products) + 69 domain = **111 тести зелені**.
- **Server-side checks:** `deno check` (7 файлів) + `deno lint` (8 файлів) — обидва зелені. Handler unit тести у Deno deferred — логіка shallow, prompt+schema це byte-equal copies legacy коду.
- **НЕ зроблено**: `supabase secrets set GEMINI_API_KEY=... ANTHROPIC_API_KEY=...` + `supabase functions deploy parse-receipt`. Інтеграційний smoke з реальним JPEG → реальною Gemini call deferred до Phase 8 (потрібен photo UI що годує функцію, або manual `curl`).

---

## Що далі (Phases 8–10)

| Фаза   | Скоуп                                                                                                                                                                 | Естімейт | Статус  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| **8**  | `/photo`: file upload + клієнт resize до 1600px JPEG q=0.8, виклик Edge Function, `<CancellationCard>` per ADR-0012, photo-storage адаптер для Supabase Storage       | ~4h      | ⏳ next |
| **9**  | `/stats` сторінка: 4 чарти (по місяцях, категоріях, користувачах, магазинах) через Postgres views або grouped queries                                                 | ~4h      | pending |
| **10** | Polish + Cloudflare Pages deploy (production env vars, Supabase production redirect URLs, deploy `parse-receipt` + secrets) + manual end-to-end з обома користувачами | ~3h      | pending |

Загальний core MVP: **~11h залишилось** (з ~33h оригінального естімейту).

---

## Критичні нюанси для нової сесії

### Якщо плануєш правити схему БД

- Додавай колонки **тільки в кінець** таблиці. Не переставляй / не видаляй / не перейменовуй.
- Кожна зміна = нова міграція у `supabase/migrations/<timestamp>_<name>.sql`. `npx supabase db push` застосує.
- Після зміни схеми: `npm --workspace web run` + `npx supabase gen types typescript --linked > web/src/shared/types/database.types.ts` (через PowerShell з `[System.IO.File]::WriteAllText` бо `>` дає UTF-16 на Windows).

### Якщо плануєш додати vendor-залежний код

- Не імпортуй `supabase` напряму у component / route / hook. Іди через порт у `shared/lib/<area>/`.
- ESLint правило `no-restricted-imports` зловить порушення мобільно. Виключення — `**/api/**` папки фіч (їм можна).
- `packages/domain/` має ZERO vendor-imports. ESLint блокує react/supabase/vite там.

### Якщо плануєш використовувати money / qty / fx

- ВСЕ йде через `roundMoney` / `roundQty` / `roundFxRate` з `@finance-tracker/domain`. Storage / API не округлюють.
- Decimals: money 2dp, qty 3dp, fx 6dp.
- Receipts/Items конструюються тільки через factories (`makeReceipt`, `makeItem`).

### Allowlist

- Будь-який email що пройде magic link → отримає JWT, але дані з БД побачить ТІЛЬКИ якщо є в `public.app_users`.
- Додавання — через Studio SQL editor:
  ```sql
  insert into public.app_users (email) values ('user@example.com');
  ```
- `<RequireAuth>` показує "Доступ заборонено" якщо JWT-email не у `app_users`.

### Тестова матриця

```
npm run lint           # ESLint flat config обох workspaces
npm run typecheck      # tsr generate + tsc -b у обох workspaces
npm run test           # vitest у обох workspaces (зараз 111 тестів — 42 web + 69 domain)
npm run build          # tsr generate + tsc -b + vite build
npm run dev            # vite dev server :5173

# Edge Function (окремий toolchain — Deno)
deno check supabase/functions/parse-receipt/index.ts handler.ts config.ts ...   # type check
deno lint  supabase/functions/parse-receipt                                     # lint
supabase functions serve parse-receipt --env-file supabase/.env.local           # local serve
```

`tsr generate` потрібен перед тестами/typecheck/build бо `routeTree.gen.ts` gitignored.

### Supabase project

- **Ref:** `<your-project-ref>`
- **URL:** `https://<your-project-ref>.supabase.co`
- **anon key:** у `web/.env.local` (gitignored)
- **service_role key:** ніде не зберігати; для майбутніх Edge Function secrets використовувати `npx supabase secrets set ...`
- **Studio:** https://supabase.com/dashboard/project/<your-project-ref>

---

## Знайдені нюанси (lessons learned)

1. **PowerShell `>` редірект → UTF-16 LE з BOM.** Tools (TS / Vite / ESLint) хочуть UTF-8. Для `supabase gen types`: `[System.IO.File]::WriteAllText(path, ($output -join "`n"), [System.Text.UTF8Encoding]::new($false))` — UTF-8 без BOM.
2. **TanStack Router `routeTree.gen.ts` — generated, gitignored.** Будь-який скрипт що тригерить tsc (typecheck, build) має спочатку викликати `tsr generate`. Реалізовано у `web/package.json` scripts.
3. **ESLint 10 ще не сумісний з `eslint-plugin-react@7.37.5`** — peer dep. Сидимо на ESLint 9.39.4.
4. **TypeScript `baseUrl` deprecated у v6, видалиться у v7.** Для path mapping використовуємо лише `paths` (relatively resolved by tsconfig location).
5. **Module augmentation вимагає `interface`, не `type`.** У `router.ts` додаємо `// eslint-disable-next-line @typescript-eslint/consistent-type-definitions`.
6. **Supabase JS `auth.onAuthStateChange` callback може спрацювати кілька разів.** Наша обгортка у `supabase-auth-service.ts` ще додатково форсує initial fire через `getUser()` — гарантує що UI отримає state одразу при mount.
7. **Allowlist check ≠ auth check.** Можна бути signed-in, але не allowed. `<RequireAuth>` має 4 стани, не 2.
8. **`exactOptionalPropertyTypes: true` + `Partial<T>` стрімкий gotcha.** `Partial<{items: T[]}>` НЕ еквівалентно `{items?: T[] | undefined}` — exact-mode не дозволяє `undefined` у властивості якщо тип не містить `undefined` явно. Фікс: завжди передавати масив (порожній або не-порожній), не `undefined`.
9. **`jsdom` не реалізує native `<dialog>`.** Тести `<DeleteConfirmDialog>` стабають `HTMLDialogElement.prototype.showModal/close` у `beforeAll` — інакше `dialog.showModal()` кидає TypeError.
10. **TanStack Router `<Link>` потребує router context.** Render-only тести (наприклад `<ReceiptCard>`) мокають Link через `vi.mock('@tanstack/react-router')` що повертає plain `<a>` з `href` сформованим з `params.id`.
11. **Deno НЕ резолвить Vite-style workspace packages.** `@finance-tracker/domain` має `"main": "./src/index.ts"` + extensionless internal imports, що Deno без додаткового конфігу не розуміє. Phase 7 рішення — vendor 25 LOC `ParsedReceipt` types у функцію + покладатися на client-side Zod validation. Альтернатива (`allowImportingTsExtensions: true` у tsconfig) має занадто великий blast radius.
12. **Supabase Edge Function: одна tooling-інстанція.** Vitest НЕ запускає файли з `.ts`-extensioned imports без додаткового config; Deno вимагає їх. Тому handler unit-тести у Vitest skipped — залишається `deno check` + `deno lint` для server-side, і клієнтський адаптер тестується через Vitest.

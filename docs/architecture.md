# Архітектура

> Цей документ описує **структуру** і **потоки даних**. Схема даних — у [data-model.md](data-model.md). Технологічні рішення — у [decisions/](decisions/) (особливо [ADR-0013](decisions/0013-migrate-to-react-supabase.md), що супергедить 5 legacy-ADR-ів). Operational runbook — у [deploy.md](deploy.md).

## Шари

```
┌────────────────────────────────────────────────────────────────────┐
│ React 19 SPA (web/src)                                             │
│   routes/      TanStack Router file-based                          │
│   features/    vertical slices: auth, receipts, photo, stats,      │
│                  categories, products                              │
│   shared/lib/  PORTS — auth/, fx-rate/, parse-receipt/,            │
│                  photo-storage/ — кожен з адаптером                │
│   shared/ui/   design primitives (Button, Input, cn)               │
│   packages/domain — імпортується як @finance-tracker/domain:       │
│                  Zod schemas, factories, ULID, money/qty/fx,       │
│                  consumed-by, pair-detector                        │
└──────────────────────────┬─────────────────────────────────────────┘
                           │ supabase-js (anon key + JWT)
                           │ NBU fetch (FX, public CORS-open)
                           │
            ┌──────────────┼─────────────────┬────────────────┐
            ▼              ▼                 ▼                ▼
┌────────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐
│ Supabase Auth  │ │ Postgres     │ │ Storage      │ │ Edge Func   │
│ (magic link)   │ │ + RLS +      │ │ (bucket      │ │ parse-      │
│ JWT issued     │ │ 4 v_stats_*  │ │ 'receipts')  │ │ receipt     │
│                │ │ views        │ │              │ │ (Deno)      │
│ verifies email │ │              │ │ RLS via      │ │             │
│                │ │ helper:      │ │ storage.     │ │ Gemini →    │
│                │ │ is_allowed_  │ │ objects      │ │ Claude      │
│                │ │ user()       │ │ policies     │ │ fallback    │
└────────────────┘ └──────────────┘ └──────────────┘ └─────────────┘
                                                            │
                                                            ▼
                                                  ┌──────────────────┐
                                                  │ Gemini 3 Flash   │
                                                  │ Claude Sonnet 4.6│
                                                  └──────────────────┘
```

Деплой:

```
GitHub repo (main)
   │ git push
   ▼
GitHub Actions (.github/workflows/deploy.yml)
   ├─ npm ci
   ├─ npm run lint
   ├─ npm run typecheck
   ├─ npm run test            (~155 тестів, всі workspaces)
   ├─ npm run build           (Vite inline'ить VITE_*)
   └─ wrangler pages deploy   (web/dist → CF static)
   │
   ▼
Cloudflare Pages (statyc CDN)
finance-tracker.pages.dev
   │ браузер
   ▼
React SPA → Supabase
```

## Файлова відповідальність

Один файл / модуль — одна задача.

### Frontend (`web/`)

| Шлях                                           | Що робить                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/main.tsx`                             | Vite entry: ReactDOM.createRoot + `<QueryClientProvider>` + `<RouterProvider>`.                                                                                                                                                                                                                                                             |
| `web/src/router.ts`                            | TanStack Router instance + module augmentation для type-safe routing.                                                                                                                                                                                                                                                                       |
| `web/src/routes/__root.tsx`                    | Layout: header (sign-out), `<Outlet />`.                                                                                                                                                                                                                                                                                                    |
| `web/src/routes/index.tsx`                     | Home — 4 pill-кнопки (Photo / Manual / Recent / Stats).                                                                                                                                                                                                                                                                                     |
| `web/src/routes/photo.tsx`                     | State machine: pick → parsing → review / parse-error.                                                                                                                                                                                                                                                                                       |
| `web/src/routes/manual.tsx`                    | `<RequireAuth>` + `<ManualReceiptForm>`.                                                                                                                                                                                                                                                                                                    |
| `web/src/routes/recent.tsx`                    | List of last 30 receipts (loading / error / empty / list states).                                                                                                                                                                                                                                                                           |
| `web/src/routes/edit.$id.tsx`                  | Param-route: edit one receipt (loading / not-found / form).                                                                                                                                                                                                                                                                                 |
| `web/src/routes/stats.tsx`                     | 4-chart dashboard (2x2 grid on lg).                                                                                                                                                                                                                                                                                                         |
| `web/src/routes/auth.callback.tsx`             | Magic-link landing — Supabase Auth обробляє URL fragment автоматично.                                                                                                                                                                                                                                                                       |
| `web/src/features/auth/*`                      | `SignInForm`, `<RequireAuth>` guard, `useCurrentUser`, `useAllowlistCheck`, `useSignInMutation`, `useSignOutMutation`.                                                                                                                                                                                                                      |
| `web/src/features/receipts/*`                  | CRUD: `useReceipts/useReceipt/useSaveReceiptMutation/useUpdateReceiptMutation/useDeleteReceiptMutation`; форми (`ManualReceiptForm`, `EditReceiptForm`, `ReceiptFormFields`); ItemRow, ItemsList, SummaryFooter; `<ReceiptCard>`, `<DeleteConfirmDialog>`, `<EmptyReceiptsState>`; форм-схема (Zod) + `useReceiptForm` hook + utils/totals. |
| `web/src/features/photo/*`                     | `PhotoPicker`, `PhotoReviewForm`; `useParseReceiptMutation` (виклик Edge Function), `useSavePhotoReceiptMutation` (wrapper навколо save mutation з photoStorage cleanup); `resizeImage`, `blobToBase64`.                                                                                                                                    |
| `web/src/features/stats/*`                     | `useStatsByMonth/Category/User/Store` (4 хуки); 4 chart-компонента + chart-setup.ts (Chart.js registration).                                                                                                                                                                                                                                |
| `web/src/features/categories/*`                | `useCategories` — read-only хук.                                                                                                                                                                                                                                                                                                            |
| `web/src/features/products/*`                  | `useProducts` — read-only хук, lightweight (id, name, category).                                                                                                                                                                                                                                                                            |
| `web/src/shared/lib/auth/`                     | `IAuthService` interface; `supabase-auth-service.ts` адаптер.                                                                                                                                                                                                                                                                               |
| `web/src/shared/lib/fx-rate/`                  | `IFxRateProvider`; `nbu-fx-rate-provider.ts` — fetch до `bank.gov.ua` з 7-day walk-back.                                                                                                                                                                                                                                                    |
| `web/src/shared/lib/parse-receipt/`            | `IParseReceiptService`; `edge-fn-parse-receipt.ts` — invoke Edge Function + Zod-валідація відповіді.                                                                                                                                                                                                                                        |
| `web/src/shared/lib/photo-storage/`            | `IPhotoStorage`; `supabase-photo-storage.ts` — upload/getSignedUrl/remove + path-схема `{email}/{yyyy}/{mm}/{ulid}.{ext}`.                                                                                                                                                                                                                  |
| `web/src/shared/lib/supabase-client.ts`        | Typed Supabase client singleton. **PRIVATE** — ESLint блокує імпорт за межами адаптерів і `**/api/**`.                                                                                                                                                                                                                                      |
| `web/src/shared/lib/dependencies.ts`           | Public barrel: `authService`, `fxRateProvider`, `parseReceiptService`, `photoStorage`. Adapter swap = одна змінена рядок у відповідному `index.ts`.                                                                                                                                                                                         |
| `web/src/shared/lib/query-client.ts`           | TanStack Query config: `staleTime: 60s`, retry-skip на 401/403.                                                                                                                                                                                                                                                                             |
| `web/src/shared/lib/env.ts`                    | Zod-валідатор `import.meta.env.VITE_SUPABASE_*`.                                                                                                                                                                                                                                                                                            |
| `web/src/shared/ui/{Button,Input,cn}.{ts,tsx}` | Design primitives.                                                                                                                                                                                                                                                                                                                          |
| `web/src/shared/utils/format-{date,money}.ts`  | Display formatters (cached `Intl.*Format`).                                                                                                                                                                                                                                                                                                 |
| `web/src/shared/types/database.types.ts`       | **GENERATED** через `supabase gen types typescript`. Не редагувати.                                                                                                                                                                                                                                                                         |

### Domain (`packages/domain/`)

| Файл                                   | Що робить                                                                                                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain/src/schemas.ts`       | Zod schemas: `ReceiptSchema`, `ItemSchema`, `ProductSchema`, `ParsedReceiptSchema`, `ParsedItemSchema` + cross-field invariants (`wasted_qty <= qty`, `discount_orig <= unit_price_orig`). `z.infer` дає TS-типи. |
| `packages/domain/src/factories.ts`     | `makeReceipt`, `makeItem`, `makeProduct`, `applyReceiptPatch`, `applyItemPatch`. Єдина sanctioned API для створення entities — генерує id, обчислює derived fields, валідує через схеми.                          |
| `packages/domain/src/ulid.ts`          | Crockford-Base32 ULID (10-char timestamp + 16-char random).                                                                                                                                                       |
| `packages/domain/src/money.ts`         | `roundMoney(2dp)`, `roundQty(3dp)`, `roundFxRate(6dp)`.                                                                                                                                                           |
| `packages/domain/src/time.ts`          | `nowIso()`, `todayIso()` — Berlin timezone, ISO 8601.                                                                                                                                                             |
| `packages/domain/src/consumed-by.ts`   | Парсер синтаксису `'his' \| 'hers' \| 'shared' \| 'custom:N/M'`.                                                                                                                                                  |
| `packages/domain/src/pair-detector.ts` | `detectPairs(parsedItems)` — групування cancellation/discount-пар (verbatim port з legacy `pairDetector.html`, 16 unit-тестів).                                                                                   |
| `packages/domain/src/index.ts`         | Barrel: re-export з усіх вище.                                                                                                                                                                                    |

### Backend (`supabase/`)

| Шлях                                                               | Що робить                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260507000001_initial_schema.sql`            | 4 таблиці + enums + indexes + triggers + RLS policies + `is_allowed_user()` helper.                                                                                                                               |
| `supabase/migrations/20260507000002_storage_bucket.sql`            | `receipts` bucket + 4 RLS policies на `storage.objects`.                                                                                                                                                          |
| `supabase/migrations/20260507000003_stats_views.sql`               | 4 view-и `v_stats_by_*` з `security_invoker = on`.                                                                                                                                                                |
| `supabase/seed.sql`                                                | 20 категорій.                                                                                                                                                                                                     |
| `supabase/functions/parse-receipt/index.ts`                        | Deno entry — 3 рядки: `Deno.serve(createHandler(loadDeps()))`.                                                                                                                                                    |
| `supabase/functions/parse-receipt/handler.ts`                      | Pure `(Request) => Promise<Response>` з deps DI. CORS, 401/403/400/502 paths, primary→fallback orchestration. **Runtime-portable** — на Cloudflare Worker / Vercel Edge нічого не треба переписувати окрім entry. |
| `supabase/functions/parse-receipt/config.ts`                       | Deno-only: env loading через `Deno.env.get`, конструювання Supabase client, `isAllowed` callback.                                                                                                                 |
| `supabase/functions/parse-receipt/types.ts`                        | Vendored ParsedReceipt + AiContext (~25 LOC) — Deno не резолвить Vite-style workspace packages, тому зберігаємо локально. Client-side Zod валідація покриває runtime safety.                                      |
| `supabase/functions/parse-receipt/providers/ai-provider.ts`        | `IAiProvider { name, parse(image, ctx): Promise<ParsedReceipt> }` — strategy interface.                                                                                                                           |
| `supabase/functions/parse-receipt/providers/gemini-provider.ts`    | Gemini 3 Flash через `responseJsonSchema`. Temperature 0.1.                                                                                                                                                       |
| `supabase/functions/parse-receipt/providers/anthropic-provider.ts` | Claude Sonnet 4.6 через forced `tool_use` (`record_receipt` tool, `disable_parallel_tool_use: true`).                                                                                                             |
| `supabase/functions/parse-receipt/prompts/receipt-prompt.ts`       | `buildPrompt(ctx)` + `buildSchema(ctx)` — verbatim port з legacy `Gemini.js`. Spільні для обох провайдерів.                                                                                                       |
| `supabase/functions/parse-receipt/handler.test.ts`                 | 7 тестів через Vitest у Node (handler-портабельний).                                                                                                                                                              |

## Потоки даних

### Потік 1: photo → save (найскладніший)

```
[1. PhotoPicker]
   │ user picks JPEG → File
   ▼
[2. resizeImage(file)]              web/src/features/photo/utils/resize-image.ts
   │ canvas.toBlob('image/jpeg', 0.8) → Blob (≤1600px)
   ▼
[3. useParseReceiptMutation.mutateAsync({ blob, categories, products })]
   │ blobToBase64(blob) → base64
   │ parseReceiptService.parse({ imageBase64, mimeType, categories, products })
   │   → supabase.functions.invoke('parse-receipt', { body: ... })
   ▼
[4. Edge Function handler.ts]       supabase/functions/parse-receipt/
   │ verify_jwt = true (Supabase platform) → 401 якщо нема JWT
   │ isAllowed(authHeader) → виклик is_allowed_user() RPC під JWT → 403 якщо не allowlisted
   │ primary.parse(image, ctx) → Gemini 3 Flash
   │   if fail → fallback.parse(image, ctx) → Claude Sonnet 4.6
   │ JSON validated by provider-native schemas (Gemini responseJsonSchema, Claude tool input_schema)
   │ Response.json(parsed)
   ▼
[5. Client-side Zod validation]     web/src/shared/lib/parse-receipt/edge-fn-parse-receipt.ts
   │ ParsedReceiptSchema.safeParse(response.data) — canonical schema з @finance-tracker/domain
   │ throw if fail (invalid shape)
   ▼
[6. detectPairs(parsed.items)]      packages/domain/src/pair-detector.ts
   │ Збирає cancellation/discount пари (ADR-0012 + ADR-0014)
   │ → { items: DetectedItem[] } — кожен item опціонально має pair_marker
   │   ('cancelled' = +X/-X пара, унормована до 0-цінового рядка;
   │    'discount-merged' = |neg| < pos, з discount_orig set)
   ▼
[7. <PhotoReviewForm>]              web/src/features/photo/components/PhotoReviewForm.tsx
   │ Pre-fills useReceiptForm({ source: 'photo', ...parsed }) з detected items
   │ ItemRow рендерить бейдж + footer-розклад на основі pair_marker
   │ pair_marker — UI-only hint, не персиститься в БД
   ▼
[8. onSubmit]
   │ Form items + included cancellations → merged into items[]
   │ useSavePhotoReceiptMutation.mutateAsync({ receipt, items, photoBlob })
   ▼
[9. photoStorage.upload(blob)]      web/src/shared/lib/photo-storage/supabase-photo-storage.ts
   │ supabase.storage.from('receipts').upload(`${email}/${yyyy}/${mm}/${ulid}.jpg`, blob)
   │ → createSignedUrl(path, 3600) → { path, signedUrl }
   ▼
[10. saveReceiptMutation.mutateAsync({ receipt: { ..., photo_url: signedUrl }, items })]
   │ fxRateProvider.getRateLive(currency, date) → fx_rate_eur (1.0 для EUR; NBU live для UAH)
   │ computeGrandTotal(items) → total_orig
   │ makeReceipt({ ...input, fx_rate_eur, total_orig }) → factory builds id/total_eur/validates
   │ items.map(it => makeItem({ ...it, receipt_id, fx_rate_eur }))
   │ supabase.from('receipts').insert(receipt) → throw on error
   │ supabase.from('items').insert(items) → on error: best-effort delete receipt
   │ qc.invalidateQueries({ queryKey: receiptsQueryKey })
   ▼
[11. catch path для save failure]
   │ photoStorage.remove(path).catch(noop) — orphan blob cleanup
   │ throw original error
   ▼
[12. navigate({ to: '/recent', search: { saved: receipt_id } })]
   │ Banner "Чек збережено: <id>" на /recent сторінці
```

**Ризики таймауту на цьому потоці:** Gemini call 3–15с, Claude fallback +5–20с при failure. Edge Function default timeout у Supabase free-tier — 25с (платний — більше). Якщо реальний чек з 50+ items + AI спрацював повільно — можна впертись. Mitigation: client-side soft timeout 30с з retry-кнопкою на /photo (наразі не реалізовано, додати у Phase 11+ якщо помітимо).

### Потік 2: stats query

```
[1. /stats route mount]
   │ <RequireAuth> → useStatsByMonth/Category/User/Store (4 хуки паралельно)
   ▼
[2. supabase.from('v_stats_by_month').select('...').limit(12)]
   │ PostgREST → SQL: select * from v_stats_by_month limit 12
   ▼
[3. Postgres view executes з security_invoker = on]
   │ RLS на receipts/items спрацьовує під auth.jwt() користувача
   │ allowlisted user бачить всі чеки → SELECT permitted
   │ aggregate sum(total_eur), count(*) group by month
   ▼
[4. PostgREST returns JSON; numerics як strings (PostgREST quirk)]
   │ Hook coerces з asNumber(v) → number
   ▼
[5. React Query caches з staleTime: 5 min]
   ▼
[6. Chart components consume rows[] via props]
   │ react-chartjs-2 renders <Bar> / <Pie>
```

### Потік 3: edit existing receipt

```
[1. /edit/$id route mount]
   │ Route.useParams() → { id }
   │ useReceipt(id) → Promise.all([
   │     supabase.from('receipts').select('*').eq('id', id).maybeSingle(),
   │     supabase.from('items').select('*').eq('receipt_id', id).order('created_at')
   │   ])
   │   returns { receipt, items } | null
   ▼
[2. <EditReceiptForm receipt items />]
   │ useReceiptForm({ ...receipt, items: items.map(toFormRow) })
   ▼
[3. onSubmit (Save)]
   │ useUpdateReceiptMutation.mutateAsync({ id, existing, receipt, items })
   │   ├─ if currency or date змінилися: fxRateProvider.getRateLive(newCurrency, newDate)
   │   │   else: keep existing.fx_rate_eur (audit trail preserved)
   │   ├─ applyReceiptPatch(existing, { ...input, source: 'edit' })
   │   ├─ supabase.from('receipts').update(...)
   │   ├─ supabase.from('items').delete().eq('receipt_id', id)  ← wholesale replace
   │   └─ supabase.from('items').insert(newItems)
   │ qc.invalidateQueries({ queryKey: [receiptsQueryKey, receiptQueryKey(id)] })
   ▼
[4. navigate({ to: '/recent', search: { saved: id } })]
```

**Items wholesale replace** — UPDATE → DELETE → INSERT, не diff-merge. Простіше, відповідає user mental model ("я редагую цілий чек"), без транзакцій (Supabase JS не підтримує). Failure між DELETE і INSERT → orphan empty receipt; documented як Studio cleanup path.

### Потік 4: delete

```
[1. <EditReceiptForm> Delete button → <DeleteConfirmDialog>]
   ▼
[2. user confirms]
   │ useDeleteReceiptMutation.mutateAsync({ id })
   │ supabase.from('receipts').delete().eq('id', id)
   │   FK on items: ON DELETE CASCADE → items видалені автоматично
   │ qc.removeQueries({ queryKey: receiptQueryKey(id) })
   │ qc.invalidateQueries({ queryKey: receiptsQueryKey })
   ▼
[3. navigate({ to: '/recent' })]
```

Photo не видаляється — orphan у Storage. Periodic Storage sweep deferred (Phase 12).

### Потік 5: auth (magic link)

```
[1. SignInForm → useSignInMutation]
   │ authService.signInWithMagicLink(email, redirectTo)
   │ supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } })
   ▼
[2. User clicks link in email]
   │ Browser → /auth/callback#access_token=...&refresh_token=...
   ▼
[3. Supabase Auth library detects URL fragment, persists session in IndexedDB]
   ▼
[4. <RequireAuth> useCurrentUser() returns { email }]
   │ + useAllowlistCheck() → app_users self-read (RLS)
   │ if allowed → <Outlet />
   │ if not allowed → "Доступ заборонено" page
```

## Точки розширення (ports)

5 ports, кожен — interface + adapter + barrel в `web/src/shared/lib/`:

| Port                 | Interface                               | Поточний adapter                           | Можливий swap                                                        |
| -------------------- | --------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------- |
| Auth                 | `IAuthService` (5 methods)              | `supabase-auth-service.ts`                 | Clerk, Auth0, Firebase Auth                                          |
| FX rate              | `IFxRateProvider` (1 method)            | `nbu-fx-rate-provider.ts`                  | ECB (для не-UAH валют), commercial APIs                              |
| AI parse (client)    | `IParseReceiptService` (1 method)       | `edge-fn-parse-receipt.ts` (Supabase Edge) | Vercel Edge, Cloudflare Worker, AWS Lambda — будь-який HTTP-endpoint |
| Photo storage        | `IPhotoStorage` (3 methods)             | `supabase-photo-storage.ts`                | Cloudflare R2, S3, Backblaze                                         |
| AI provider (server) | `IAiProvider` (всередині Edge Function) | Gemini + Anthropic                         | OpenAI, Mistral — додай файл у `providers/`, register у `handler.ts` |

Adapter swap = sibling файл + одна змінена рядок re-export у відповідному `index.ts`. Тести проходять через mock самого adapter.

## Чому ця архітектура

Три ключові тези:

1. **Vendor swap — це не репозиторії, а ports.** Замість `class ReceiptRepository { list, get, create, update, delete }` ми пишемо запити безпосередньо через PostgREST DSL у `features/<x>/api/*.ts` хуках. PostgREST DSL багатий (`.eq()`, `.gte()`, `.in()`, `.order()`, `.range()`); обгортка стерла би його і зменшила type safety. Якщо колись міняємо БД — знаємо точно які 10–15 хуків переписувати, і використовуємо повний DSL нової бази нативно. Подробиці: ADR-0013 §0.3 "Why no Repository pattern".

2. **Domain — vendor-free workspace package.** `packages/domain` не імпортує жодного vendor-коду; ESLint блокує `react`, `supabase`, `vite` там. Той самий код запускається у браузері (валідація форм) і теоретично у Edge Function (вендорено через obstinate Deno-resolution). Zod schemas як `z.infer` source — TS-типи не дрейфять від validators.

3. **Authorization у Postgres, не у клієнті.** RLS + JWT — справжня авторизація. Anon key public by design; його in-bundle leakage не є дірою. Це і є причина чому в Phase 3 ми вклали час у `app_users` + `is_allowed_user()` helper + RLS policies на кожній таблиці.

## Гострі кути

Адресовано в коді / документації; повний список — у [project-status.md "Знайдені нюанси"](project-status.md#знайдені-нюанси-lessons-learned). Найжорсткіші:

- **`exactOptionalPropertyTypes: true`** робить `Partial<T>` сюрпризним — `undefined` не дозволено для не-undefined-typed properties. Завжди передавай масив (порожній або не), не `undefined`.
- **Deno НЕ резолвить Vite-style workspace packages.** Edge Function вендорить ParsedReceipt типи замість імпорту з `@finance-tracker/domain`.
- **PostgREST повертає numeric як string.** Stats hooks coerce'ять через `asNumber()` — не пропусти при додаванні нової view-колонки.
- **Cloudflare Pages "Connect GitHub" UI має баг.** Bypass через wrangler CLI + GitHub Actions. Documented у [deploy.md](deploy.md).
- **VITE\_\* — build-time, не runtime.** CF dashboard env vars у direct-upload не використовуються.
- **NBU не публікує курси у вихідні/свята.** `nbu-fx-rate-provider.ts` walk-back до 7 днів.
- **TanStack Router `routeTree.gen.ts` gitignored.** Будь-який tsc-trigger має `tsr generate` спершу.
- **jsdom не реалізує canvas і `<dialog>`.** Chart-компоненти не покриті Vitest; `<dialog>` тести стабають prototype-методи.

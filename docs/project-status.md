# Project Status

> Точка входу для нової сесії. Коротко: що є, що далі, на що дивитись першим. Оновлюється у кінці кожної фази.

**Останнє оновлення:** 2026-05-07 (Phases 0–4 завершено)

---

## TL;DR

- **Старий стек (Apps Script + Sheets + Alpine.js)** заархівовано в [`legacy/apps-script/`](../legacy/apps-script/) — досі білдиться (164 тести), залишається для emergency rollback.
- **Новий стек:** React 19 + Vite 8 + Tailwind 4 + TanStack Query 5 + TanStack Router + Supabase (Postgres + Auth + Storage + Edge Functions) + Cloudflare Pages (deploy у Phase 10). $0/місяць.
- **Архітектура:** Ports & Adapters lite — vendor-coupled код тільки у `web/src/shared/lib/<area>/` адаптерах і `supabase/functions/<fn>/providers/`. Domain-логіка — окремий vendor-free TS пакет `packages/domain/` (порт `Domain.js`).
- **Прогрес:** 4 з 11 фаз готові. Auth працює end-to-end (magic link → /auth/callback → RequireAuth з allowlist).
- **Наступне:** Phase 5 — `/manual` сторінка (форма з ItemsTable + збереження чека через TanStack Query mutation).

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
│   │   ├── routes/             ← TanStack Router file-based (__root, index, auth.callback)
│   │   ├── features/           ← vertical slices (зараз: auth/)
│   │   │   └── auth/{api,components,guards,index.ts}
│   │   ├── shared/
│   │   │   ├── lib/            ← порти + адаптери (auth/, env, supabase-client, dependencies, query-client)
│   │   │   ├── ui/             ← design system (Button, Input, cn)
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
│   ├── config.toml             ← supabase init defaults
│   ├── migrations/20260507000001_initial_schema.sql
│   ├── seed.sql                ← 20 категорій
│   └── README.md               ← інструкції local + remote
├── package.json                ← npm workspaces root, scripts
├── tsconfig.base.json          ← shared compiler options
└── .husky/pre-commit           ← lint-staged
```

---

## Що зроблено (Phases 0–4)

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

---

## Що далі (Phases 5–10)

| Фаза   | Скоуп                                                                                                                                                                    | Естімейт | Статус  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------- |
| **5**  | `/manual` сторінка: форма з ItemsTable + Summary, FX-fetch з NBU напряму, `useSaveReceiptMutation`, success → toast + redirect                                           | ~4h      | ⏳ next |
| **6**  | `/recent` (last 30) + `/edit/$id` + delete confirm                                                                                                                       | ~3h      | pending |
| **7**  | `parse-receipt` Edge Function (Deno): `IAiProvider` strategy, Gemini primary + Claude fallback (порт ADR-0011, ADR-0012 prompt verbatim), `verify_jwt + allowlist check` | ~4h      | pending |
| **8**  | `/photo`: file upload + клієнт resize до 1600px JPEG q=0.8, виклик Edge Function, `<CancellationCard>` per ADR-0012, photo-storage адаптер для Supabase Storage          | ~4h      | pending |
| **9**  | `/stats` сторінка: 4 чарти (по місяцях, категоріях, користувачах, магазинах) через Postgres views або grouped queries                                                    | ~4h      | pending |
| **10** | Polish + Cloudflare Pages deploy (production env vars, Supabase production redirect URLs) + manual end-to-end з обома користувачами                                      | ~3h      | pending |

Загальний core MVP: **~22h залишилось** (з ~33h оригінального естімейту).

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
npm run test           # vitest у обох workspaces (зараз 73 теста)
npm run build          # tsr generate + tsc -b + vite build
npm run dev            # vite dev server :5173
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

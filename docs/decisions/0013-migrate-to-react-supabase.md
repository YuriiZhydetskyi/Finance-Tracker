# ADR-0013: Міграція з Google Apps Script + Sheets на React + Supabase + Cloudflare Pages

- Status: accepted
- Date: 2026-05-08
- Supersedes: [ADR-0001](0001-google-sheets-as-storage.md), [ADR-0002](0002-apps-script-runtime-and-clasp.md), [ADR-0005](0005-alpine-for-ui-no-build.md), [ADR-0006](0006-separate-pages-per-mode.md), [ADR-0010](0010-web-app-access-mode.md)

## Context and Problem Statement

Phases 0–3.6 закрилися робочим Apps Script + Sheets + Alpine.js додатком: 113 зелених тестів, ADR-0011 Claude fallback, ADR-0012 pair grouping, [data-model.md](../data-model.md) як sole-source-of-truth схеми. Бізнес-фічі працюють.

Проблема — DX. Розробник (один на проект, senior) витрачав години на платформенне тертя:
- Apps Script editor не auto-refresh'ається після `clasp push`; кожна ітерація вимагає F5.
- HtmlService Java-proxy quirks (HtmlTemplate реалізована як Java proxy, де custom-property assignment у вкладеному template робить методи unreachable — натрапили чотири рази на різних варіаціях).
- Без real types — JSDoc `checkJs` ловить 60% API-misuse, але не структурні баги.
- Без breakpoints — debug через `Logger.log` + редеплой.
- LockService quirks (`getDocumentLock` повертає null для standalone scripts; tutorial-and-error знайдене болем).
- Scriptlets `<? ?>` всередині HtmlTemplate тендітні — порядок eval'ування різний у `createTemplateFromFile().evaluate()` vs `createHtmlOutputFromFile()` (lessons-learned #6 у `legacy/.../README.md`).

Окремий драйвер: ADR-0001 пояснив чому Sheets-as-DB виправдане для першого запуску (zero infra, girlfriend-fluent format, 5-min recovery). Наприкінці Phase 3.6 цей driver втратив вагу — пам'ятка `~/.claude/.../memory/girlfriend-sheets-fluency.md` (2026-05-07): аналітика переїде в `/stats` сторінку всередині додатку (Chart.js), не у директ-shared Sheet; manual fixes — через in-app edit UI або Studio SQL editor; Sheets-fluency другої користувачки **НЕ** є driver-ом для збереження Sheets як storage.

Репо вже містить 12 ADR-ів і повний test-suite — переписувати "з нуля" є коштом, але набутий design-knowledge не втрачається; його достатньо для faithful port.

Питання: переходити чи лишатися?

## Considered Options

1. **Status quo + invest in DX-toolchain поверх Apps Script.** Local-emulator (clasp + якийсь mock Sheets), aggressive JSDoc, custom hot-reload script.
2. **Гібрид:** залишити Apps Script як backend (Sheets + Web endpoints), переписати UI як SPA (React + Vite), деплоїти SPA на Cloudflare Pages, бекенд викликати через `google.script.run` proxy.
3. **Повна міграція:** React + Vite + Tailwind + TanStack Query + TanStack Router у `/web`, Supabase (Postgres + Auth + Storage + Edge Functions) як backend, Cloudflare Pages як frontend host. `parse-receipt` Edge Function (Deno) як AI-key proxy.
4. **Migration "data first":** перенести Sheets → Postgres, переписати backend, лишити Alpine UI. Потім окремою фазою перейти на React.

## Decision Outcome

Обрано **Option 3** — повна міграція single-shot.

Стек і причини:
- **React 19 + Vite 8 + Tailwind 4 + TypeScript 6 strict** — мейнстрим SPA-стек з реальним hot-reload, breakpoints, types. Vite 8 з Rolldown bundler — дев-цикл <500ms.
- **TanStack Query 5** як єдиний data-layer (replace ad-hoc `runServer` wrapper). Query cache + invalidation + optimistic mutations — все що раніше робив Sheet read.
- **TanStack Router** — type-safe routing, file-based, type-safe `<Link>` і search params.
- **Supabase Postgres** — proper RLS, real schema, real indexes. Email-allowlist через `app_users` table + `is_allowed_user()` helper, RLS policies на кожній таблиці.
- **Supabase Auth** з magic link — replace `localStorage` identity toggle (lesson #7 у legacy README — `Session.getActiveUser().getEmail()` повертає `""` для personal Gmail без Workspace-домену; ця bouncing-around логіка йде).
- **Supabase Storage** для фото чеків — приватний бакет `receipts` з RLS-equivalent через `storage.objects` policies.
- **Supabase Edge Functions (Deno)** — лише одна функція `parse-receipt` як AI-key proxy. Gemini-key/Anthropic-key не повинні потрапити у browser bundle.
- **Cloudflare Pages** як static-host для Vite SPA — unlimited bandwidth, free tier, GitHub Actions deploy on push.
- **Architecture: Ports & Adapters lite.** Vendor-coupled код в адаптерах (`web/src/shared/lib/<area>/`); решта app-у залежить від interface'ів. Адаптер swap = одна змінена рядок у barrel. Реалізовано для auth, fx-rate, parse-receipt, photo-storage. RLS через `dependencies.ts` barrel.
- **`packages/domain` workspace** — vendor-free TS пакет з Zod-схемами, factories (makeReceipt/makeItem), pair-detector. Imported і у `web/`, і потенційно у Edge Function (vendored замість import per Phase 7 Deno-resolution gotcha).

**No data migration:** DB був порожній на момент міграції — обидва користувачі починають з чистого аркуша. Це усунуло ризикову частину "переписали кодову базу + переписали дані одночасно".

Cutover виконано як 11 фаз (0–10), кожна окремий PR/коміт:
- 0: archive `src/` → `legacy/apps-script/`
- 1: scaffold workspaces
- 2: domain port (33 unit + 16 pair-detector тестів)
- 3: Postgres schema + RLS
- 4: auth shell
- 5: `/manual` page
- 6: `/recent` + `/edit/$id` + delete
- 7: parse-receipt Edge Function (Gemini primary + Claude fallback з ADR-0011)
- 8: `/photo` page (resize → AI → review з cancellation cards з ADR-0012 → save з фото у Storage)
- 9: `/stats` page (4 чарти через Postgres views + Chart.js)
- 10: Cloudflare Pages + production env vars + `db push` + `functions deploy` + manual smoke з обома користувачами

## Consequences

### Позитивні

- **Real DX.** Vite HMR, React DevTools, Chrome DevTools breakpoints, TypeScript 6 strict (`exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`), ESLint flat + Prettier + Husky + lint-staged. Iteration cycle: edit → save → see (sub-second).
- **Real types.** Supabase generates `Database` type з migrations; кожен `.from('receipts')` typed end-to-end. Zod schemas як `z.infer` source — domain types не дрейфять від validators.
- **Real RLS.** Email-allowlist у одному місці (`is_allowed_user()` SQL helper), policies на чотирьох таблицях + storage.objects. ADR-0010-style server-side allowlist (`Web.doGet` + `parseReceipt` etc) replaced — RLS тепер enforced Postgres-ом, browser клієнт не може обійти.
- **Test surface більше і дешевше.** Vitest + @testing-library/react + jsdom. 135 тестів (66 web + 69 domain) у Phase 9 vs 113 у legacy. Run time: ~4s vs ~6s.
- **Portability.** Ports & Adapters означає що Supabase swap (наприклад на Neon + Clerk) — ~30 LOC на порт, не rewrite. Postgres-rivals (Neon/Turso) — connection-string change. Cloudflare Pages → Vercel — змінити CI deploy step.
- **Cost: $0/місяць.** Supabase free tier (500MB DB, 1GB Storage, 500K Edge invocations) + Cloudflare Pages free + NBU public API + Gemini free tier (15 req/min) — все вкладається.

### Негативні / гострі кути

- **Дві системи на cutover-windowи.** До Phase 10 manual-smoke з обома користувачами legacy лишається daily-driver. Tagged `legacy-final` для emergency rollback (clasp project ID у `legacy/apps-script/.clasp.json` живе ще 90 днів).
- **Duplicate prompts.** `Gemini._buildPrompt` / `_buildSchema` у legacy і у `supabase/functions/parse-receipt/prompts/receipt-prompt.ts` — verbatim port. Drift discipline у README функції; майбутні зміни prompt-у потрібно дзеркалити (хоча legacy frozen, тож drift unilateral).
- **Edge Function без `@finance-tracker/domain` import.** Vite-style workspace package не cleanly resolves з Deno; вендорено 25 LOC `ParsedReceipt` types у `supabase/functions/parse-receipt/types.ts`. Client-side Zod validation покриває runtime safety. Якщо Schema-shape міняється — два місця оновлювати.
- **Signed URLs замість public URLs для фото.** TTL 1 година. Поки UI не показує фото на edit-page (Phase 8 — out of scope), це невидимо. Якщо у Phase 11+ додамо `<ReceiptPhoto>`, треба re-sign on-demand через `photoStorage.getSignedUrl(path)`. Path extract з URL — regex helper, документовано як ризик.
- **Orphan-photo cleanup best-effort.** Якщо upload OK але receipt insert fails, `photoStorage.remove(path).catch(noop)` — мережевий drop між upload-OK і remove-attempt лишає orphan blob. Periodic Storage sweep job — Phase 12 deferred.
- **Manual smoke на live deploy.** Phase 10 включає end-to-end test з обома користувачами проти live Supabase + live Gemini. Без цього є шанс знайти environment-баг (auth redirect URLs, secrets misset, RLS edge-case).
- **`raw_ocr_json` column у Postgres має limit 45,000 chars.** Receipts на ~50 позицій вкладаються; для дуже довгих чеків JSON буде >45KB → graceful-set-null у `<PhotoReviewForm>`. Втрата debug-info, але не блокер save flow.
- **TanStack Router `routeTree.gen.ts` — generated, gitignored.** Будь-який скрипт що тригерить `tsc` має спочатку викликати `tsr generate`. Реалізовано у `web/package.json` scripts; не запам'ятати — отримаєш cryptic typecheck errors.
- **Apps Script knowledge — більше не на критичному шляху.** Але legacy code залишається переглядальним; нові розробники (якщо буде онбординг) не повинні learn'ити Apps Script. Trade-off в нашу користь.

## Pros and Cons of the Options

### 1. Status quo + DX-toolchain поверх Apps Script
- ✅ Нуль ризику міграції; уся business-логіка вже працює.
- ✅ Тести залишаються релевантними.
- ❌ Платформенне тертя — fundamental, не fixable toolchain-ом. HtmlService Java-proxy не змінити; lock-service quirks не fix'iти.
- ❌ Cap'у на користувачів немає, але cap на dev-velocity жорсткий — кожна нова фіча пробивається 2× довше.

### 2. Гібрид (Apps Script backend + React frontend)
- ✅ Backend остається; ризик ділиться навпіл.
- ❌ Найгірше з обох світів: треба підтримувати Apps Script API (HtmlService → JSON endpoints) і React. `google.script.run` через CORS неможливий — потрібен `IFRAME proxy` хак.
- ❌ Auth still на Apps Script Session — magic link і RLS недоступні без бекенд-replace.

### 3. Повна міграція (обрано)
- ✅ Один кодовий стек, один debug-режим.
- ✅ Усе нове — RLS, Storage, Edge Functions, Cloudflare Pages — first-class supported.
- ✅ Майбутні фічі (`/stats`, optimistic-update, мобільний PWA) — built-in.
- ❌ Найбільше work upfront: ~33h estimate (factual: ~30h по факту перших 9 фаз).
- ❌ Cutover ризик. Mitigation: 11 окремих PR-ів, кожен зелений автономно.

### 4. Migration "data first"
- ✅ Зменшує scope-of-change у кожному PR.
- ❌ Створює middle-state де backend Postgres але UI Alpine.js — невластивий artifact, кожна нова інтеграція коштує 2× (write для Alpine, потім переписати під React).
- ❌ Цей гібрид довший за повну міграцію.

---

## Changelog

(Без змін з моменту створення.)

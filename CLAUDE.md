# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Where to start

Before making non-trivial changes, read in order:
1. **[docs/project-status.md](docs/project-status.md)** — current state, what's done, what's next, lessons learned. The handoff doc.
2. **[docs/architecture.md](docs/architecture.md)** — three layers, request flow, extension points.
3. **[docs/data-model.md](docs/data-model.md)** — authoritative Sheet schema and rules. Source of truth for all entity shapes.
4. **[docs/decisions/](docs/decisions/)** — 10 MADR-format ADRs. The "why" for every load-bearing choice.

For history of design decisions: [conversation.md](conversation.md) (long but complete chat log).

## Common commands

```bash
npm run lint         # ESLint (src + tests)
npm run typecheck    # tsc --noEmit, allowJs+checkJs+strict
npm run test         # node --test (Domain unit + Storage/Fx integration + fixtures)
npm run push         # lint + typecheck + test + clasp push  ← always use this for deploy
npm run push:force   # bypass checks (emergency only)
npm run open         # opens Apps Script editor in browser
npm run logs         # tails clasp logs

node --test tests/domain.test.js          # run a single test file
node --test --test-name-pattern='ulid'    # run tests matching a pattern
```

After `npm run push`: **F5 the Apps Script editor tab** — it does not auto-refresh after clasp push.

Smoke tests live in `src/Smoke.js` and run only inside Apps Script (real LockService, real Sheet). Pick `smokeIdentity`, `smokeUlid`, `smokeFxLive`, `smokeReceiptRoundtrip`, `smokeLockService`, `smokeCategoriesRead`, `smokeGeminiParse`, `smokeWebRoutes` from the function picker.

Web UI deploy is a separate step from `clasp push`: in the Apps Script editor → **Deploy → New deployment → Type: Web app → Execute as: User accessing → Who has access: Anyone with a Google account**. The deployed URL is the entry point for both users; share it privately. Real authorization is server-side: `Web.doGet` and every `google.script.run` endpoint compare `Session.getEffectiveUser().getEmail()` against `Config.ALLOWED_EMAILS`. Anyone else gets a denied page. See [ADR-0010](docs/decisions/0010-web-app-access-mode.md).

## Architecture in one paragraph

Standalone Google Apps Script web app, deployed via `clasp` from `./src`. Four sheets in one Google Sheet (Receipts / Items / Products / Categories) are the storage. Apps Script V8 executes all `src/*.js` files in **one shared global scope** — each module is `const Module = {...}` and is referenced as a global from every other file. `Web.js` ✅ routes UI sub-pages (`doGet` switches on `?page=...` to one of `index/photo/manual/edit/recent` HTML templates under `src/ui/`) and exposes JSON endpoints called via `google.script.run`: `parseReceipt`, `saveReceipt`, `updateReceipt`, `getReceipt`, `deleteReceipt`, `listRecent`, `getCategories`, `listProducts`, `whoAmI`. `Storage.js` is the only Sheet-touching layer; `AiClient.js` switches between provider files — `Gemini.js` ✅ implements `gemini-3-flash-preview` via `responseJsonSchema`, OpenAi/Anthropic are stubs with the same signature. `Domain.js` owns types, ULID generation, money rounding, validators, factories, and `ParsedReceipt`/`ParsedItem` (in-memory transit shape between AI and UI). `Fx.js` provides `getRateLive(currency, date)` — live NBU lookup for UAH (only non-base currency supported); rates are stored on the receipt itself, no separate FxRates table. `Config.js` reads secrets and resource IDs from Apps Script Properties at runtime; nothing sensitive lives in code. UI is Alpine.js from CDN with a small `runServer(fn, args) → Promise` wrapper over `google.script.run` (see `src/ui/shared/webapp.html`).

## Cross-file globals — non-obvious

Apps Script's single-global-scope is mimicked in three places that all stay in sync:

- **Source files** end with `if (typeof module !== 'undefined') module.exports = { ModuleName };` so Node tests can `require()` them. The `typeof` guard makes the line a no-op under Apps Script.
- **`src/globals.d.ts`** declares `Config`, `Domain`, `Storage`, `Fx`, `Smoke`, `AiClient`, `Gemini`, `OpenAi`, `Anthropic`, `Web` as ambient `any` so `tsc` does not flag cross-file references. Same for entity types (`Receipt`, `Item`, `Product`, `ParsedReceipt`, `ParsedItem`).
- **`eslint.config.mjs`** lists those names as `writable` globals (writable, not readonly — otherwise `const Module = {...}` trips no-redeclare). `no-redeclare` is disabled with a rationale comment.
- **`tests/bootstrap.js`** explicitly assigns each module onto `global` after requiring, so integration tests run with the same cross-file resolution as Apps Script.

Top-level entry-point functions (Apps Script triggers, editor Run dropdown items) are marked with `/* exported foo */` so ESLint doesn't flag them as unused. Example: `smokeIdentity`, etc.

## Four-tier testing

- **Level 1 — TypeScript checkJs** (`npm run typecheck`): catches API misuse against `@types/google-apps-script`. Limited where the types do not model runtime quirks.
- **Level 2 — Integration tests with fakes** (`tests/storage.test.js`, `tests/fx.test.js`, `tests/web.test.js`): exercise Storage CRUD, Fx live-fetch, and Web endpoints against in-memory fakes in `tests/fakes/`. The HtmlService fake processes Apps Script scriptlets (`<? ?>`, `<?= ?>`, `<?!= ?>`) for real, so `Web.doGet` tests can assert on rendered HTML — including the "no `<?` residue" regression check that catches scriptlet-evaluation bugs before deploy. Use `tests/bootstrap.js`, not `tests/setup.js` (the latter is minimal and only for pure Domain tests).
- **Level 3 — Drift detection** (`tests/fixtures.test.js`): pins NBU JSON response shape (field names, DD.MM.YYYY date format, plausible rate range). If NBU changes its response format, this test breaks first. Refresh fixture: `curl 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&date=YYYYMMDD&json' > tests/fixtures/nbu-uah-sample.json`.
- **Level 4 — JSDOM UI tests** (`tests/ui.test.js`): boots each page through `tests/uiHarness.js` — renders HTML via `Web.doGet`, drops it into JSDOM, evals the local Alpine.js source, and stubs `google.script.run`. Catches: x-data factory throwing, missing helper from `webapp.html`, broken click handlers, missing `<base target="_top">` (the iframe-navigation bug). JSDOM is not a real browser — file inputs, layout, and `URL.createObjectURL` are not simulated; we stub `runServer`. For real-Apps-Script behavior (Java-proxy quirks of HtmlTemplate, real iframe sandbox), run `smokeWebRoutes` from the editor.

## Schema evolution rule

Sheet columns are referenced by **header name**, not position. Therefore: add new columns only at the end of a sheet, never reorder, never rename, never delete during MVP. If you must rename, add a new column and migrate. Storage code reads the header row at start of execution to build a name→index map.

## Conventions worth knowing

- **Money rounding** happens at write time in `Domain.makeReceipt` / `Domain.makeItem` / `Domain.applyReceiptPatch`. `Storage.js` only validates and writes; never rounds. Decimals: money 2dp, qty 3dp, fx 6dp.
- **IDs** are ULIDs generated in `Domain.ulid()` (Crockford Base32, time-sortable). Never use sheet row index as identity.
- **Dates** are `'YYYY-MM-DD'` strings. Timestamps are ISO 8601 with offset (e.g. `2026-05-04T14:30:00+02:00`). Plain-text format on date columns prevents Sheet from auto-converting to its locale.
- **Concurrency**: every multi-row write goes through `Storage._withLock` which uses `LockService.getScriptLock()` (NOT `getDocumentLock` — that returns null for standalone scripts).
- **Multi-currency**: only EUR (base) and UAH are supported. Receipts/Items store `currency`, `total_orig`, `fx_rate_eur`, `total_eur` as audit trail. Rate is fetched live from NBU at save time (`Fx.getRateLive`), frozen on the receipt, never recomputed. There is **no `FxRates` sheet** — see ADR-0004 changelog. NBU walk-back: 7 days for weekends/holidays.
- **Documentation language**: Ukrainian. Code, JSDoc, comments, commit messages: English.

## Things that bit us — see project-status.md §10 for the full list

The most expensive lessons:
- `LockService.getDocumentLock()` returns `null` for standalone web apps. Use `getScriptLock()`.
- `globals.googleappsscript` is **not** a real preset in the npm `globals` package despite many tutorials saying otherwise. Apps Script API globals are listed manually in `eslint.config.mjs`.
- ECB Reference Rates does **not** include UAH (28 currencies, no UAH). For our scope (EUR + UAH only) we removed ECB integration entirely and use NBU live; see ADR-0004 changelog.
- `*/` inside a JSDoc block (e.g. `Domain.make*/applyPatch`) closes the comment early and breaks the parser. ESLint catches this.
- `Session.getActiveUser().getEmail()` returns `""` for personal Gmail without a Google Workspace domain. Phase 3 UI handles this with a `localStorage` toggle modal in `src/ui/index.html` (`identityOptions` array — edit the two emails to your real ones).
- Apps Script editor function picker shows only top-level `function` declarations. Methods inside `const Module = {}` are invisible — that is why Smoke.js and Fx.js have top-level wrappers.
- `HtmlService.createHtmlOutputFromFile(name)` returns RAW file content (no scriptlet evaluation), while `createTemplateFromFile(name).evaluate()` does evaluate. Apps Script's HtmlTemplate is a Java-backed proxy whose methods can become unreachable when custom properties are set on it inside another template's evaluation context — so `Web.include` uses `createHtmlOutputFromFile` and shared files (`shared/styles.html`, `shared/webapp.html`, etc.) have NO scriptlets. Per-page scriptlets (`<base href>`, `finance-query-params` meta) live in each page's own `<head>` block where they evaluate as part of the top-level template.
- IDE-friendly rule: keep Apps Script scriptlets in **HTML attribute values**, not inside `<script>` blocks. Pages read SCRIPT_URL from `<base href>` and QUERY_PARAMS from `<meta name="finance-query-params">` via DOM at runtime.

## When extending

`docs/extending.md` has numbered recipes for: add a category, add a sheet, swap LLM provider, add a field, add a currency, add a fake for a new Apps Script API, replace `any` with proper types in `globals.d.ts`. Use the recipes — they encode the order of operations that keeps schema, code, types, and tests in sync.

## Acting on Apps Script Properties

Required properties (set via Apps Script editor → Project Settings → Script Properties): `SHEET_ID`, `DRIVE_FOLDER_ID` (Phase 3+), `GEMINI_API_KEY` (Phase 2+). Code reads them lazily through `Config.SHEET_ID` etc. — accessing one whose property is unset throws a clear error.

Never put these values in source. Never echo them into chat logs (history: a previous Gemini API key leaked into chat and had to be revoked).

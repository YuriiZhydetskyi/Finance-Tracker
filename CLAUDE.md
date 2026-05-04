# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Where to start

Before making non-trivial changes, read in order:
1. **[docs/project-status.md](docs/project-status.md)** — current state, what's done, what's next, lessons learned. The handoff doc.
2. **[docs/architecture.md](docs/architecture.md)** — three layers, request flow, extension points.
3. **[docs/data-model.md](docs/data-model.md)** — authoritative Sheet schema and rules. Source of truth for all entity shapes.
4. **[docs/decisions/](docs/decisions/)** — 9 MADR-format ADRs. The "why" for every load-bearing choice.

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

Smoke tests live in `src/Smoke.js` and run only inside Apps Script (real LockService, real Sheet). Pick `smokeIdentity`, `smokeUlid`, `smokeFxBackfill`, `smokeFxLookup`, `smokeReceiptRoundtrip`, `smokeLockService`, `smokeCategoriesRead` from the function picker.

## Architecture in one paragraph

Standalone Google Apps Script web app, deployed via `clasp` from `./src`. Five sheets in one Google Sheet (Receipts / Items / Products / Categories / FxRates) are the storage. Apps Script V8 executes all `src/*.js` files in **one shared global scope** — each module is `const Module = {...}` and is referenced as a global from every other file. `Web.js` (Phase 3+) routes UI sub-pages and exposes JSON endpoints; `Storage.js` is the only Sheet-touching layer; `AiClient.js` switches between provider files (`Gemini.js`, stubs for OpenAI/Anthropic); `Domain.js` owns types, ULID generation, money rounding, validators, and factories; `Fx.js` pulls ECB Reference Rates plus NBU (UAH only — ECB does not publish UAH). `Config.js` reads secrets and resource IDs from Apps Script Properties at runtime; nothing sensitive lives in code.

## Cross-file globals — non-obvious

Apps Script's single-global-scope is mimicked in three places that all stay in sync:

- **Source files** end with `if (typeof module !== 'undefined') module.exports = { ModuleName };` so Node tests can `require()` them. The `typeof` guard makes the line a no-op under Apps Script.
- **`src/globals.d.ts`** declares `Config`, `Domain`, `Storage`, `Fx`, `Smoke`, `AiClient`, `Gemini`, `OpenAi`, `Anthropic` as ambient `any` so `tsc` does not flag cross-file references. Same for entity types (`Receipt`, `Item`, `Product`, `ParsedReceipt`, `ParsedItem`).
- **`eslint.config.mjs`** lists those names as `writable` globals (writable, not readonly — otherwise `const Module = {...}` trips no-redeclare). `no-redeclare` is disabled with a rationale comment.
- **`tests/bootstrap.js`** explicitly assigns each module onto `global` after requiring, so integration tests run with the same cross-file resolution as Apps Script.

Top-level entry-point functions (Apps Script triggers, editor Run dropdown items) are marked with `/* exported foo */` so ESLint doesn't flag them as unused. Examples: `fxDailyTriggerHandler`, `smokeIdentity`, etc.

## Three-tier testing

- **Level 1 — TypeScript checkJs** (`npm run typecheck`): catches API misuse against `@types/google-apps-script`. Limited where the types do not model runtime quirks.
- **Level 2 — Integration tests with fakes** (`tests/storage.test.js`, `tests/fx.test.js`): exercise Storage CRUD and Fx parsing against in-memory fakes in `tests/fakes/`. Use `tests/bootstrap.js`, not `tests/setup.js` (the latter is minimal and only for pure Domain tests).
- **Level 3 — Drift detection** (`tests/fixtures.test.js`): asserts ECB feed contains expected currencies and does NOT contain UAH. If ECB changes its currency list, this test breaks first. Refresh fixtures by re-fetching `tests/fixtures/ecb-daily-sample.xml` from `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`.

## Schema evolution rule

Sheet columns are referenced by **header name**, not position. Therefore: add new columns only at the end of a sheet, never reorder, never rename, never delete during MVP. If you must rename, add a new column and migrate. Storage code reads the header row at start of execution to build a name→index map.

## Conventions worth knowing

- **Money rounding** happens at write time in `Domain.makeReceipt` / `Domain.makeItem` / `Domain.applyReceiptPatch`. `Storage.js` only validates and writes; never rounds. Decimals: money 2dp, qty 3dp, fx 6dp.
- **IDs** are ULIDs generated in `Domain.ulid()` (Crockford Base32, time-sortable). Never use sheet row index as identity.
- **Dates** are `'YYYY-MM-DD'` strings. Timestamps are ISO 8601 with offset (e.g. `2026-05-04T14:30:00+02:00`). Plain-text format on date columns prevents Sheet from auto-converting to its locale.
- **Concurrency**: every multi-row write goes through `Storage._withLock` which uses `LockService.getScriptLock()` (NOT `getDocumentLock` — that returns null for standalone scripts).
- **Multi-currency**: receipts store `currency`, `total_orig`, `fx_rate_eur`, `total_eur`. Rate is frozen on the receipt and never recomputed retroactively. Fallback: latest available rate ≤ requested date.
- **Documentation language**: Ukrainian. Code, JSDoc, comments, commit messages: English.

## Things that bit us — see project-status.md §10 for the full list

The most expensive lessons:
- `LockService.getDocumentLock()` returns `null` for standalone web apps. Use `getScriptLock()`.
- `globals.googleappsscript` is **not** a real preset in the npm `globals` package despite many tutorials saying otherwise. Apps Script API globals are listed manually in `eslint.config.mjs`.
- ECB Reference Rates does **not** include UAH (verified, 28 currencies). NBU API integration in `Fx.js` covers UAH only.
- `*/` inside a JSDoc block (e.g. `Domain.make*/applyPatch`) closes the comment early and breaks the parser. ESLint catches this.
- `Session.getActiveUser().getEmail()` returns `""` for personal Gmail without a Google Workspace domain. Phase 3 will need a `localStorage` fallback toggle if smokeIdentity confirms this.
- Apps Script editor function picker shows only top-level `function` declarations. Methods inside `const Module = {}` are invisible — that is why Smoke.js and Fx.js have top-level wrappers.

## When extending

`docs/extending.md` has numbered recipes for: add a category, add a sheet, swap LLM provider, add a field, add a currency, add a fake for a new Apps Script API, replace `any` with proper types in `globals.d.ts`. Use the recipes — they encode the order of operations that keeps schema, code, types, and tests in sync.

## Acting on Apps Script Properties

Required properties (set via Apps Script editor → Project Settings → Script Properties): `SHEET_ID`, `DRIVE_FOLDER_ID` (Phase 3+), `GEMINI_API_KEY` (Phase 2+). Code reads them lazily through `Config.SHEET_ID` etc. — accessing one whose property is unset throws a clear error.

Never put these values in source. Never echo them into chat logs (history: a previous Gemini API key leaked into chat and had to be revoked).

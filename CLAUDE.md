# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Where to start

Before making non-trivial changes, read in order:

1. **[docs/project-status.md](docs/project-status.md)** — current state, pending deploy steps, lessons learned. The handoff doc.
2. **[docs/architecture.md](docs/architecture.md)** — layers, request flows, ports & adapters, extension points.
3. **[docs/data-model.md](docs/data-model.md)** — authoritative Postgres schema, RLS rules, RPC contracts, money/qty/fx conventions.
4. **[docs/decisions/](docs/decisions/)** — 28 MADR ADRs (index in its `README.md`). ADR-0013 covers the Apps Script → React/Supabase migration; 0016–0028 cover durable background imports, receipt verification, product taxonomy, store-scoped product rules and the packaged-product catalogue. Superseded ADRs are marked in the index.
5. **[docs/deploy.md](docs/deploy.md)** — operational runbook: secrets, env vars, deploy procedure, troubleshooting.
6. **[docs/extending.md](docs/extending.md)** — numbered recipes for common extensions (add category, swap AI provider, add column, etc.).
7. **[docs/refactoring-plan-2026-09.md](docs/refactoring-plan-2026-09.md)** — September 2026 refactoring plan and its status.

The legacy Apps Script app was removed from the repo in September 2026 (last commit containing it: `875bb9b`).

## Common commands

From repo root (npm workspaces: `web/`, `packages/*`, `supabase/functions/*`):

```powershell
npm run dev                          # Vite dev server on :5173 (web workspace)
npm run build                        # tsr generate + tsc -b + vite build (web workspace)
npm run preview                      # serve the production build
npm run lint                         # ESLint across all workspaces (lint:fix to autofix)
npm run typecheck                    # tsr generate + tsc -b --noEmit across all workspaces
npm run test                         # all Vitest workspaces + PGlite SQL scripts + check:edge-domain
npm run test:purchase-correction-sql # PGlite: purchase correction rules
npm run test:packaged-products-sql   # PGlite: packaged products constraints, RLS, queue
npm run test:save-receipt-bundle-sql # PGlite: save_receipt_bundle RPC
npm run sync:edge-domain             # regenerate supabase/functions/_shared/domain from packages/domain
npm run check:edge-domain            # fail if that generated copy drifted
npm run format                       # Prettier --write (format:check to verify)
```

Single-test runs:

```powershell
npx vitest run --root web src/features/photo                    # one folder
npx vitest run --root packages/domain src/pair-detector.test.ts # one file
npx vitest run -t 'cancellation'                                # by test name
```

Edge Functions (Deno toolchain for type/lint; their logic is tested by the Vitest workspaces above):

```powershell
deno check supabase/functions/parse-receipt/index.ts             # typecheck
deno check supabase/functions/process-receipt-imports/index.ts   # typecheck
deno lint  supabase/functions                                    # lint (incl. _shared)
npx supabase functions serve parse-receipt --env-file ...        # local serve
npx supabase functions deploy parse-receipt                      # production
npx supabase functions deploy process-receipt-imports            # production
```

Database (Supabase CLI):

```powershell
npx supabase db push                                            # apply migrations to linked project
npx supabase gen types typescript --linked                      # regenerate database.types.ts
npx supabase db reset                                           # local-only reset + reseed
```

For the gen-types command on Windows use the UTF-8 helper, since PowerShell `>` produces UTF-16 LE with BOM that Vite/TS reject — see [docs/deploy.md](docs/deploy.md) "Common operations".

## Before declaring code changes done

After editing TS/TSX (or any file ESLint covers), run the same gates CI runs **before** committing — never assume "looks fine" is enough. The order is:

1. `npm run lint` — must pass with zero errors. The pre-commit hook only runs Prettier; ESLint is NOT enforced locally, so CI is the first place push-only checks fire. Failures here block deploy.
2. `npm run typecheck` — required after touching types, schemas, generated files, or any cross-workspace import.
3. `npm run test` — required after touching `packages/domain/`, migrations covered by the PGlite scripts, or any file with neighboring `*.test.ts`. For a single touched area, prefer `npx vitest run --root <ws> <path>` (see "Single-test runs" above) to keep the loop fast.
4. After touching `supabase/functions/**` or `packages/domain/src/{money,receipt-evidence}.ts`: the Deno checks above plus `npm run check:edge-domain` (run `npm run sync:edge-domain` first if the domain source changed).

Scope shortcuts when only one workspace changed:

- domain only: `npm run lint --workspace @finance-tracker/domain && npx vitest run --root packages/domain`
- web only: `npm run lint --workspace @finance-tracker/web && npm run typecheck --workspace @finance-tracker/web`
- Edge Functions only: `deno check supabase/functions/parse-receipt/index.ts && deno check supabase/functions/process-receipt-imports/index.ts && deno lint supabase/functions`

Skip these only for doc-only changes (`*.md` outside `CLAUDE.md`/`docs/`-referenced sources).

## Architecture in one paragraph

React 19 SPA built with Vite 8 + Tailwind 4 + TanStack Query 5 + TanStack Router (file-based routes), deployed as static files to **Cloudflare Pages**. Backend is **Supabase end-to-end**: Postgres + Auth (magic link) + Storage + PGMQ/`pg_cron` + two Edge Functions. The browser talks **directly** to Supabase via supabase-js — Postgres RLS does authorization (allowlist via `app_users` table, helper `is_allowed_user()`). Multi-table writes and aggregates go through RPCs: receipt save/edit via `save_receipt_bundle` (receipt, items, products and price snapshots in one transaction), `/stats` via `stats_*` RPCs. Edge Functions: **`parse-receipt`** — synchronous OCR for `/photo`, runs under the caller's JWT and exists only because Gemini/Anthropic keys can't be scoped for the browser; **`process-receipt-imports`** — background worker for `/imports`, invoked by `pg_cron` with a Vault-stored cron token (`Authorization: Bearer <token>`), takes one PGMQ message per call and writes with the service-role key. Code shared by both functions lives in `supabase/functions/_shared/` (`receipt-ai/` — providers, prompts, types; `domain/` — a generated copy of selected `packages/domain` files). Vendor-coupled browser code lives in **adapters** at `web/src/shared/lib/<area>/` (one folder per port: auth, fx-rate, parse-receipt, photo-storage); routes/components depend on the singletons from `dependencies.ts` or on feature `api/` hooks, never on supabase-js directly. Domain logic — Zod schemas, ULID, money/qty/fx rounding, factories, pair-detector, taxonomy, receipt evidence — lives in **`packages/domain/`**, a vendor-free TypeScript workspace package. All app routes sit under the pathless `_authed` layout (which mounts `<RequireAuth>` once): `/`, `/photo`, `/imports`, `/imports/$id`, `/pending`, `/manual`, `/recent`, `/edit/$id`, `/stats`, `/waste`, `/reconcile`, `/packaged-products`, `/packaged-products/$id`; `/auth/callback` is public. CI/CD: GitHub Actions runs Deno checks + lint + typecheck + test + build, then `wrangler pages deploy` — see [.github/workflows/deploy.yml](.github/workflows/deploy.yml). Migrations and Edge Functions are deployed manually. FX rates for UAH come live from NBU via direct browser fetch (CORS-open public API). Cost target: $0/month.

## Folder structure

```
finance-tracker/
├── web/src/
│   ├── routes/                    # TanStack Router file-based
│   │   ├── __root.tsx, auth.callback.tsx
│   │   ├── _authed.tsx            # pathless layout: wraps children in <RequireAuth>
│   │   └── _authed/               # index, photo, imports, imports_.$id, pending, manual, recent,
│   │                              # edit.$id, stats, waste, reconcile, packaged-products, packaged-products_.$id
│   ├── features/                  # 12 vertical slices (api/ + components/ + index.ts barrel):
│   │                              # auth, categories, imports, packaged-products, pending-parses, photo,
│   │                              # product-corrections, products, receipts, reconcile, stats, waste
│   ├── shared/
│   │   ├── lib/                   # PORTS — see below
│   │   │   ├── auth/              # IAuthService + supabaseAuthService
│   │   │   ├── fx-rate/           # IFxRateProvider + nbuFxRateProvider
│   │   │   ├── parse-receipt/     # IParseReceiptService + edgeFunctionParseReceiptService
│   │   │   ├── photo-storage/     # IPhotoStorage + supabasePhotoStorage
│   │   │   ├── pdf/               # packaging PDF page rendering
│   │   │   ├── supabase-client.ts # PRIVATE — only adapters and feature api/ import it
│   │   │   ├── dependencies.ts    # public barrel: re-exports all singletons
│   │   │   ├── query-client.ts    # TanStack Query config
│   │   │   └── env.ts             # Zod-validated import.meta.env
│   │   ├── ui/                    # design primitives
│   │   ├── utils/                 # formatting helpers
│   │   └── types/database.types.ts # GENERATED via supabase gen types — do not edit manually
│   └── styles/tailwind.css
├── packages/domain/src/           # vendor-free domain logic + tests
├── supabase/
│   ├── migrations/                # 42 timestamped SQL files (see folder); key ones: initial_schema,
│   │                              # background_receipt_imports, multilingual_product_taxonomy,
│   │                              # purchase_correction_rules, packaged_products, save_receipt_bundle
│   ├── functions/
│   │   ├── _shared/               # receipt-ai/ (providers, prompts, types) + domain/ (GENERATED copy)
│   │   ├── parse-receipt/         # sync OCR: index + handler + config
│   │   └── process-receipt-imports/ # PGMQ worker: index, handler, job-processor, attempts, parsing, ...
│   └── seed.sql
├── scripts/                       # sync-edge-domain, PGlite SQL tests, product-taxonomy tooling
├── .github/workflows/             # pr-checks.yml, deploy.yml, codeql.yml
└── docs/                          # architecture, data-model, deploy, ADRs, etc.
```

## Ports & adapters — discipline

The vendor swap is mechanical because we wired it that way. Five rules:

1. **No `import { supabase } from '@/shared/lib/supabase-client'`** outside `web/src/shared/lib/**/supabase-*.ts` adapters and `web/src/features/**/api/**`. ESLint `no-restricted-imports` blocks the alias path everywhere else (`web/eslint.config.js`); adapters inside `shared/lib/` import the client relatively (`../supabase-client`). The exemption for `api/` is intentional — Supabase REST + RLS query DSL is rich and we'd lose more than we gain by wrapping it. See ADR-0013 §0.3 "Why no Repository pattern".
2. **Each port = one folder under `web/src/shared/lib/`**: an `*.types.ts` interface, a `*-<vendor>-*.ts` adapter (one per vendor), and an `index.ts` barrel that exports the singleton.
3. **`packages/domain/` is vendor-free.** No `supabase`, no `react`, no `vite`. ESLint blocks those imports there.
4. **Routes import hooks; hooks import services; services know about the vendor.** Routes never see supabase-js types.
5. **One singleton per port** in [`web/src/shared/lib/dependencies.ts`](web/src/shared/lib/dependencies.ts). Adapter swap = change one re-export line in the port's `index.ts`. No DI container, no service locator.

## Authorization model

Real authorization happens in Postgres. The pieces:

- **Anon key** is **public by design** — it's in the bundle, visible in DevTools. By itself it gets the `anon` role; RLS blocks all reads/writes on RLS-protected tables.
- **Magic link sign-in** issues a JWT for the user. supabase-js auto-attaches it. RLS policies inspect `auth.jwt() ->> 'email'`.
- **Allowlist** lives in `public.app_users` (one column, `email`). Helper `public.is_allowed_user()` returns `true` iff the JWT email is in that table. RLS policies on the app tables and storage buckets are gated by it.
- **service_role key** bypasses RLS and NEVER appears in the frontend. `parse-receipt` does not use it (it calls the `is_allowed_user()` RPC under the caller's JWT). `process-receipt-imports` reads it via `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` and is guarded by the pg_cron token instead of a user JWT.
- **`<RequireAuth>` has 4 states**: loading / unauthenticated / authenticated-but-not-allowlisted / authenticated-and-allowlisted. Sign-in is no guarantee of access. It is mounted once, in `routes/_authed.tsx`.

When a user reports "I can sign in but see no data" — the answer is almost always: their email is not in `app_users`. SQL fix: `insert into public.app_users (email) values ('user@example.com');` from Studio.

## Schema evolution rule

Postgres tables are accessed by column name (not position) via PostgREST. The plan-file rule was "add columns at end only". Postgres is more forgiving than Sheets, but we keep the discipline:

- Migrations live in [`supabase/migrations/`](supabase/migrations/) as `YYYYMMDDHHMMSS_<name>.sql`. Forward-only; never edit a committed migration.
- After every migration: `npx supabase db push` (apply to live), then **regenerate** `web/src/shared/types/database.types.ts` via `npx supabase gen types typescript --linked`. The generated file is the source of truth for typed queries; manual edits drift.
- Renames go in two migrations: add new column (with backfill or default), update reads/writes to dual-source, then drop the old one. Never rename in one shot — it breaks anything still reading the old name.
- For destructive schema changes during MVP, do NOT use `db reset` against the live project; always go through migrations.

## Money / qty / fx — invariants

These rules live in `packages/domain/`:

- **Money** rounding: 2dp via `roundMoney(value)` in [`packages/domain/src/money.ts`](packages/domain/src/money.ts). Used at write time inside `makeReceipt` / `makeItem` / `applyReceiptPatch`. Hooks/components NEVER round before passing to factories.
- **Quantity** rounding: 3dp via `roundQty`. Allows `0.350 kg`.
- **FX rate** rounding: 6dp via `roundFxRate`. Stored on the Receipt as audit trail; never recomputed.
- **Total invariant**: `total_orig = round(qty * (unit_price_orig - discount_orig), 2)`. Enforced by `makeItem`. `total_eur = round(total_orig * fx_rate_eur, 2)`.
- **Negative line items**: `unit_price_orig` may be negative (cancellation, Pfand refund, Rabatt). `qty` always positive. See ADR-0012 + ADR-0014 + ADR-0015 + `pair-detector.ts` for client-side grouping logic. The detector runs in three passes: (1) exact `±X` cancellation pairs (works for 3+ groups, e.g. cashier-punched-twice-then-voided) → single 0-priced row, `pair_marker.kind = 'cancelled'`; (2) partial discounts (`|neg| < pos`) → single row with `discount_orig` set, `pair_marker.kind = 'discount-merged'`; (3) orthogonal aggregation by `(name, unit_price, discount, marker.kind)` → identical rows merge into one with summed `qty`, `pair_marker.kind = 'aggregated'`. All markers carry `count` (number of source rows merged); marker is a UI-only hint (drives ItemRow badge + footer breakdown), never persisted.

## Testing strategy

Vitest everywhere; Deno only for type/lint gates. `npm run test` runs (counts as of 2026-09-22 — 890 Vitest tests in 98 files):

- **Domain unit** (`packages/domain`, 263 tests) — pure TS: schemas, factories, pair-detector, money, ulid, time, taxonomy, receipt evidence, bank statements, reconciliation.
- **Web** (`web`, 528 tests) — adapters mocked via `vi.mock`; hooks via `renderHook` + QueryClient wrapper; components via `@testing-library/react`; route tests in `routes/-*.test.tsx`. Chart components NOT tested (Chart.js needs canvas, jsdom doesn't implement it).
- **Edge Functions in Node** — `supabase/functions/_shared` (29), `parse-receipt` (20), `process-receipt-imports` (50). Each is its own workspace with a `vitest.config.ts`; handlers take injected dependencies, so only Web Fetch is needed.
- **SQL on PGlite** — `scripts/test-purchase-correction-rules.mjs`, `scripts/test-packaged-products-sql.mjs`, `scripts/test-save-receipt-bundle-sql.mjs` run migrations in in-process Postgres and assert constraints, RLS and RPC behavior.
- **Drift guard** — `npm run check:edge-domain` fails if `_shared/domain` differs from `packages/domain`.

CI (`pr-checks.yml` on PRs to `main`, `deploy.yml` on push to `main`) additionally runs `deno check` for both functions and `deno lint supabase/functions`; `pr-checks.yml` also verifies the frozen taxonomy backfill.

What's NOT covered automatically:

- Real-vendor smoke (real Gemini call, real RLS denial, real magic-link round-trip, real pg_cron/PGMQ delivery) — done manually.
- Visual / layout / canvas-rendering — manual browser check.
- E2E (Playwright is deferred).

## Conventions worth knowing

- **Files:** `kebab-case.ts` for utilities/data, `PascalCase.tsx` for components, `use-<name>.ts` for hooks.
- **Types:** `PascalCase`. Avoid `IFoo` Hungarian prefix in new code; we kept it on existing port interfaces (`IAuthService` etc) for clarity at the boundary.
- **Hooks:** `use<Verb><Noun>` for queries (`useReceipts`, `useReceipt`), `use<Action>Mutation` for mutations (`useSaveReceiptMutation`, `useDeleteReceiptMutation`).
- **Types over enums.** `type Source = 'photo' | 'manual' | 'edit'` — string-literal types tree-shake; TS `enum` does not.
- **`snake_case` end-to-end.** Postgres columns are `snake_case`; supabase-js returns them as `snake_case`; we do NOT add a camelCase mapping layer. Reduces drift, matches the DB.
- **No abbreviations** in new names. `paid_by`, `total_orig`, `discount_orig` — full and explicit.
- **No barrels inside features.** Only at feature boundaries (`features/receipts/index.ts`); never inside `features/receipts/components/`.
- **Documentation language:** Ukrainian. Code, comments, commit messages: English.
- **Comments:** by default no comments. Add only when WHY is non-obvious (a hidden constraint, surprising behavior, workaround for a specific bug). Never explain WHAT — names already do.
- **Pre-commit:** Husky + lint-staged auto-runs Prettier on staged files.

## Required secrets / env vars

None of these belong in source. Never echo them into chat logs.

| Where                                                   | Names                                                                                          | Purpose                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `web/.env.local` (gitignored)                           | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`                                                  | local dev (`npm run dev` / local `npm run build`) |
| GitHub repo secrets                                     | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | CI build + deploy                                 |
| Supabase Edge Function secrets (`supabase secrets set`) | `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `RECEIPT_IMPORT_CRON_TOKEN`                             | AI providers; cron token for the import worker    |

The cron token must match the copy in Vault that pg_cron sends — see [supabase/functions/process-receipt-imports/README.md](supabase/functions/process-receipt-imports/README.md) and ADR-0016.

VITE\_\* vars are **build-time** — Vite inlines them into the bundle. Cloudflare Pages dashboard env vars are NOT used in our direct-upload deploy model. See [docs/deploy.md](docs/deploy.md) for full picture.

## Things that bit us — full list in project-status.md §Lessons learned

The most expensive lessons:

- **`exactOptionalPropertyTypes: true` + `Partial<T>`** is a sharp gotcha. `Partial<{items: T[]}>` is not equivalent to `{items?: T[] | undefined}` — exact mode rejects `undefined` for properties whose type doesn't include it. Fix: always pass an array (empty or not), never `undefined`.
- **jsdom does not implement native `<dialog>`.** Tests for `<DeleteConfirmDialog>` stub `HTMLDialogElement.prototype.showModal/close` in `beforeAll`.
- **TanStack Router `<Link>` needs router context.** Render-only component tests mock `@tanstack/react-router` to return a plain `<a>` with `href` built from `params`.
- **Deno does NOT resolve Vite-style workspace packages.** `@finance-tracker/domain` uses `"main": "./src/index.ts"` + extension-less internal imports — Deno chokes. `ParsedReceipt` types are mirrored in `_shared/receipt-ai/types.ts`; client-side Zod validation covers runtime safety.
- **`supabase/functions/_shared/domain/` is a generated copy.** `scripts/sync-edge-domain.mjs` copies selected `packages/domain` files and rewrites relative imports to `.ts` for Deno. Never edit the copy: change the domain source, run `npm run sync:edge-domain`, commit both. `check:edge-domain` (in `npm run test` and CI) fails on drift.
- **PowerShell `>` redirect → UTF-16 LE with BOM.** Vite/TS/ESLint want UTF-8. For `supabase gen types`: `[System.IO.File]::WriteAllText(path, ($output -join "`n"), [System.Text.UTF8Encoding]::new($false))`.
- **TanStack Router `routeTree.gen.ts` is generated and gitignored.** Any script that triggers `tsc` must call `tsr generate` first. Wired into `web/package.json` scripts.
- **Cloudflare Pages "Connect GitHub" UI loop bug.** GitHub-app sometimes deadlocks at the permissions screen with nothing to click. Workaround: bypass via wrangler CLI + GitHub Actions. This is why we don't use Cloudflare's auto-build feature.
- **VITE\_\* vars are build-time, not runtime.** Cloudflare Pages dashboard env vars are ignored in direct-upload mode. Vars must live where the build runs (`.env.local` locally, GitHub secrets in CI). Trips up first-time CF Pages users every time.
- **Anon key public by design.** Real auth is JWT + RLS. service_role never in the frontend. Don't panic-rotate the anon key after seeing it in DevTools.

## When extending

[`docs/extending.md`](docs/extending.md) has numbered recipes for: add a category, add a table + migration, replace the AI provider, add a column, add a currency to FX, add a new port adapter, add a new route, add a UI test. Use the recipes — they encode the order of operations that keeps schema, types, hooks, ESLint, and tests in sync.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Where to start

Before making non-trivial changes, read in order:

1. **[docs/project-status.md](docs/project-status.md)** — current state, what's done, what's next, lessons learned (15 items as of Phase 10). The handoff doc.
2. **[docs/architecture.md](docs/architecture.md)** — layers, request flows, ports & adapters, extension points.
3. **[docs/data-model.md](docs/data-model.md)** — authoritative Postgres schema, RLS rules, money/qty/fx conventions.
4. **[docs/decisions/](docs/decisions/)** — 13 MADR ADRs. ADR-0013 covers the Apps Script → React/Supabase migration; 0001/0002/0005/0006/0010 are marked superseded.
5. **[docs/deploy.md](docs/deploy.md)** — operational runbook: secrets, env vars, deploy procedure, troubleshooting.
6. **[docs/extending.md](docs/extending.md)** — numbered recipes for common extensions (add category, swap AI provider, add column, etc.).

The legacy Apps Script app is archived at [legacy/apps-script/](legacy/apps-script/) — frozen 2026-05-07, kept for emergency rollback up to 90 days post-cutover. Do not edit.

## Common commands

From repo root (npm workspaces dispatch to `web/` and `packages/domain/`):

```powershell
npm run dev          # Vite dev server on :5173 (web workspace)
npm run build        # tsr generate + tsc -b + vite build (web workspace)
npm run lint         # ESLint flat config across all workspaces
npm run typecheck    # tsr generate + tsc -b --noEmit across all workspaces
npm run test         # Vitest across all workspaces
npm run format       # Prettier --write
```

Single-test runs:

```powershell
npx vitest run --root web src/features/photo                    # one folder
npx vitest run --root packages/domain src/pair-detector.test.ts # one file
npx vitest run -t 'cancellation'                                # by test name
```

Edge Function (separate Deno toolchain — see [supabase/functions/parse-receipt/README.md](supabase/functions/parse-receipt/README.md)):

```powershell
deno check supabase/functions/parse-receipt/index.ts            # typecheck
deno lint  supabase/functions/parse-receipt                     # lint
npx supabase functions serve parse-receipt --env-file ...       # local serve
npx supabase functions deploy parse-receipt                     # production
```

Database (Supabase CLI):

```powershell
npx supabase db push                                            # apply migrations to linked project
npx supabase gen types typescript --linked                      # regenerate database.types.ts
npx supabase db reset                                           # local-only reset + reseed
```

For the gen-types command on Windows use the UTF-8 helper, since PowerShell `>` produces UTF-16 LE with BOM that Vite/TS reject — see [docs/deploy.md](docs/deploy.md) "Common operations".

## Architecture in one paragraph

React 19 SPA built with Vite 8 + Tailwind 4 + TanStack Query 5 + TanStack Router (file-based routes), deployed as static files to **Cloudflare Pages**. Backend is **Supabase end-to-end**: Postgres + Auth (magic link) + Storage + a single Edge Function. The browser talks **directly** to Supabase via supabase-js — Postgres RLS does authorization (allowlist via `app_users` table, helper `is_allowed_user()`). The one Edge Function is `parse-receipt` (Deno) — it exists only because Gemini and Anthropic don't issue scoped API keys, so the keys can't go in the browser bundle. Vendor-coupled code lives in **adapters** at `web/src/shared/lib/<area>/` (one folder per port: auth, fx-rate, parse-receipt, photo-storage); routes/components/hooks depend on the singleton from `dependencies.ts`, never on supabase-js directly. ESLint `no-restricted-imports` enforces this. Domain logic — Zod schemas, ULID, money/qty/fx rounding, factories, pair-detector — lives in **`packages/domain/`** as a vendor-free TypeScript workspace package, imported by both the web app and (vendored, not imported, due to Deno limitations) the Edge Function. Routes: `/`, `/photo`, `/manual`, `/recent`, `/edit/$id`, `/stats`, `/auth/callback`. CI/CD: GitHub Actions runs lint + typecheck + test + build then `wrangler pages deploy` — see [.github/workflows/deploy.yml](.github/workflows/deploy.yml). FX rates for UAH come live from NBU via direct browser fetch (CORS-open public API). Cost target: $0/month.

## Folder structure

```
finance-tracker/
├── web/src/
│   ├── routes/                    # TanStack Router file-based: __root, index, manual, recent, edit.$id, photo, stats, auth.callback
│   ├── features/                  # vertical slices, each with api/ + components/ + (hooks/) + index.ts barrel
│   │   ├── auth/                  # SignInForm, RequireAuth guard, useCurrentUser, useAllowlistCheck
│   │   ├── receipts/              # CRUD: hooks (useReceipts, useReceipt, save/update/delete mutations) + form components + ReceiptCard
│   │   ├── categories/            # useCategories
│   │   ├── products/              # useProducts
│   │   ├── photo/                 # PhotoPicker, PhotoReviewForm, CancellationCard, useParseReceiptMutation, useSavePhotoReceiptMutation, resizeImage
│   │   └── stats/                 # 4 chart components + useStatsByMonth/Category/User/Store
│   ├── shared/
│   │   ├── lib/                   # PORTS — see below
│   │   │   ├── auth/              # IAuthService + supabaseAuthService
│   │   │   ├── fx-rate/           # IFxRateProvider + nbuFxRateProvider
│   │   │   ├── parse-receipt/     # IParseReceiptService + edgeFunctionParseReceiptService
│   │   │   ├── photo-storage/     # IPhotoStorage + supabasePhotoStorage
│   │   │   ├── supabase-client.ts # PRIVATE — only adapters import; ESLint blocks elsewhere
│   │   │   ├── dependencies.ts    # public barrel: re-exports all singletons
│   │   │   ├── query-client.ts    # TanStack Query config
│   │   │   └── env.ts             # Zod-validated import.meta.env
│   │   ├── ui/                    # design primitives: Button, Input, cn helper
│   │   ├── utils/                 # format-money, format-date
│   │   └── types/database.types.ts # GENERATED via supabase gen types — do not edit manually
│   └── styles/tailwind.css        # @import "tailwindcss";
├── packages/domain/src/           # vendor-free: money, ulid, time, consumed-by, schemas (Zod), factories, pair-detector + tests
├── supabase/
│   ├── migrations/                # 3 timestamped SQL files: schema, storage bucket, stats views
│   ├── functions/parse-receipt/   # Deno Edge Function: handler + index + config + providers/ + prompts/
│   └── seed.sql                   # 20 categories
├── .github/workflows/deploy.yml   # CI: lint + typecheck + test + build + wrangler pages deploy
├── docs/                          # this file's siblings (architecture, data-model, deploy, ADRs, etc.)
└── legacy/apps-script/            # frozen 2026-05-07; do not edit
```

## Ports & adapters — discipline

The vendor swap is mechanical because we wired it that way. Five rules:

1. **No `import { supabase } from '@/shared/lib/supabase-client'`** outside an adapter or `**/api/**` folder. ESLint `no-restricted-imports` enforces this. The exemption for `api/` is intentional — Supabase REST + RLS query DSL is rich and we'd lose more than we gain by wrapping it. See ADR-0013 §0.3 "Why no Repository pattern".
2. **Each port = one folder under `web/src/shared/lib/`**: an `*.types.ts` interface, a `*-<vendor>-*.ts` adapter (one per vendor), and an `index.ts` barrel that exports the singleton.
3. **`packages/domain/` is vendor-free.** No `supabase`, no `react`, no `vite`. ESLint blocks those imports there.
4. **Routes import hooks; hooks import services; services know about the vendor.** Routes never see supabase-js types.
5. **One singleton per port** in [`web/src/shared/lib/dependencies.ts`](web/src/shared/lib/dependencies.ts). Adapter swap = change one re-export line in the port's `index.ts`. No DI container, no service locator.

## Authorization model

Real authorization happens in Postgres. The pieces:

- **Anon key** is **public by design** — it's in the bundle, visible in DevTools. By itself it gets the `anon` role; RLS blocks all reads/writes on RLS-protected tables.
- **Magic link sign-in** issues a JWT for the user. supabase-js auto-attaches it. RLS policies inspect `auth.jwt() ->> 'email'`.
- **Allowlist** lives in `public.app_users` (one column, `email`). Helper `public.is_allowed_user()` returns `true` iff the JWT email is in that table. All RLS policies on `receipts`/`items`/`products`/`categories`/`storage.objects` (bucket `receipts`) are gated by it.
- **service_role key** bypasses RLS. It NEVER appears in the frontend. It's only available inside the Edge Function via `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` if we ever need it (today we don't — the Edge Function calls `is_allowed_user()` RPC under the caller's JWT).
- **`<RequireAuth>` has 4 states**: loading / unauthenticated / authenticated-but-not-allowlisted / authenticated-and-allowlisted. Sign-in is no guarantee of access.

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
- **Negative line items**: `unit_price_orig` may be negative (cancellation, Pfand refund, Rabatt). `qty` always positive. See ADR-0012 + ADR-0014 + `pair-detector.ts` for client-side grouping logic. After parse, exact ±X pairs become a single 0-priced row with `pair_marker.kind = 'cancelled'`; partial discounts (|neg| < pos) merge into one row with `discount_orig` set and `pair_marker.kind = 'discount-merged'`. The marker is a UI-only hint (drives ItemRow badge + footer breakdown), never persisted.

## Testing strategy

Three layers, all under Vitest (one toolchain except for the Edge Function):

- **Domain unit** ([`packages/domain/src/*.test.ts`](packages/domain/src/)) — pure TS: schemas, factories, pair-detector (16 tests verbatim from legacy), money, ulid, time, consumed-by. 76 tests.
- **Web** ([`web/src/**/*.test.{ts,tsx}`](web/src/)) — adapters mocked via `vi.mock`; hooks tested via `renderHook` + QueryClient wrapper; components tested via `@testing-library/react`. 72 tests covering ports (parse-receipt, photo-storage, fx-rate), mutations (save/update/photo-save with cleanup), components (CancellationCard, DeleteConfirmDialog, ReceiptCard), stats hooks. Chart components NOT tested (Chart.js needs canvas, jsdom doesn't implement it — manual smoke covers visuals).
- **Edge Function** ([`supabase/functions/parse-receipt/handler.test.ts`](supabase/functions/parse-receipt/handler.test.ts)) — Vitest in Node (handler.ts is runtime-portable, only Web Fetch needed). 7 tests covering primary→fallback orchestration, 401/403/CORS preflight. Has its own `vitest.config.ts` + `package.json` registered as a sub-workspace at the repo root.

CI runs all three (`npm run test --workspaces`). Total: ~155 tests in <5s.

What's NOT covered automatically:

- Real-vendor smoke (real Gemini call, real RLS denial, real magic-link round-trip) — done via manual `/photo` testing.
- Visual / layout / canvas-rendering — manual browser check.
- E2E (Playwright is in the plan but deferred post-MVP).

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
| Supabase Edge Function secrets (`supabase secrets set`) | `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`                                                          | parse-receipt function only                       |

VITE\_\* vars are **build-time** — Vite inlines them into the bundle. Cloudflare Pages dashboard env vars are NOT used in our direct-upload deploy model. See [docs/deploy.md](docs/deploy.md) for full picture.

## Things that bit us — full list in project-status.md §Lessons learned

The most expensive lessons (15 items total, last 8 specifically about this stack):

- **`exactOptionalPropertyTypes: true` + `Partial<T>`** is a sharp gotcha. `Partial<{items: T[]}>` is not equivalent to `{items?: T[] | undefined}` — exact mode rejects `undefined` for properties whose type doesn't include it. Fix: always pass an array (empty or not), never `undefined`.
- **jsdom does not implement native `<dialog>`.** Tests for `<DeleteConfirmDialog>` stub `HTMLDialogElement.prototype.showModal/close` in `beforeAll`.
- **TanStack Router `<Link>` needs router context.** Render-only component tests mock `@tanstack/react-router` to return a plain `<a>` with `href` built from `params`.
- **Deno does NOT resolve Vite-style workspace packages.** `@finance-tracker/domain` uses `"main": "./src/index.ts"` + extension-less internal imports — Deno chokes. Phase 7 vendored ~25 LOC of `ParsedReceipt` types into the Edge Function instead. Client-side Zod validation covers runtime safety.
- **PowerShell `>` redirect → UTF-16 LE with BOM.** Vite/TS/ESLint want UTF-8. For `supabase gen types`: `[System.IO.File]::WriteAllText(path, ($output -join "`n"), [System.Text.UTF8Encoding]::new($false))`.
- **TanStack Router `routeTree.gen.ts` is generated and gitignored.** Any script that triggers `tsc` must call `tsr generate` first. Wired into `web/package.json` scripts.
- **Cloudflare Pages "Connect GitHub" UI loop bug.** GitHub-app sometimes deadlocks at the permissions screen with nothing to click. Workaround: bypass via wrangler CLI + GitHub Actions. This is why we don't use Cloudflare's auto-build feature.
- **VITE\_\* vars are build-time, not runtime.** Cloudflare Pages dashboard env vars are ignored in direct-upload mode. Vars must live where the build runs (`.env.local` locally, GitHub secrets in CI). Trips up first-time CF Pages users every time.
- **Anon key public by design.** Real auth is JWT + RLS. service_role never in the frontend. Don't panic-rotate the anon key after seeing it in DevTools.

## When extending

[`docs/extending.md`](docs/extending.md) has numbered recipes for: add a category, add a table + migration, replace the AI provider, add a column, add a currency to FX, add a new port adapter, add a new route, add a UI test. Use the recipes — they encode the order of operations that keeps schema, types, hooks, ESLint, and tests in sync.

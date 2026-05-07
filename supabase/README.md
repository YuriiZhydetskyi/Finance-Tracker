# Supabase workspace

Schema, seed data, RLS policies, and Edge Functions for Finance Tracker.

## Layout

```
supabase/
├── config.toml                          # Supabase CLI project config (local dev defaults)
├── migrations/
│   └── 20260507000001_initial_schema.sql  # 4 tables + enums + indexes + triggers + RLS
├── seed.sql                             # 20 categories from docs/data-model.md
├── functions/                           # Edge Functions (added in Phase 7)
│   └── parse-receipt/                   # Gemini→Claude AI proxy
└── README.md                            # this file
```

## Local development (requires Docker Desktop)

```bash
# from repo root
npx supabase start          # spins up Postgres + Auth + Storage + Studio + Inbucket
npx supabase db reset       # applies migrations + seed
npx supabase status         # show URLs (Studio: http://127.0.0.1:54323)
npx supabase stop           # tear down
```

The local stack uses ports 54321 (REST/auth/storage), 54322 (Postgres), 54323 (Studio), 54324 (Inbucket — receives all auth emails locally).

## Connect a remote project

```bash
# Create a project at https://supabase.com/dashboard, then:
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push                    # apply migrations to the remote project
```

After linking, generate fresh TypeScript types into the web workspace:

```bash
npx supabase gen types typescript --linked > web/src/shared/types/database.types.ts
```

## After first deploy: grant user access

The schema's RLS policies require the authenticated email to be present in `public.app_users`. Add yourself and your second user via the Supabase Studio SQL editor:

```sql
insert into public.app_users (email) values
  ('you@example.com'),
  ('YOUR_SECOND_USER_EMAIL');
```

Without these inserts, RLS will silently filter every row and the app will look empty.

## Edge Functions

Phase 7 of the migration plan introduces `supabase/functions/parse-receipt/`. Local dev:

```bash
npx supabase functions serve parse-receipt --env-file ./supabase/functions/parse-receipt/.env.local
```

Deploy:

```bash
npx supabase functions deploy parse-receipt
```

Secrets must be set in the project (not committed):

```bash
npx supabase secrets set GEMINI_API_KEY=xxx ANTHROPIC_API_KEY=yyy
```

# parse-receipt — Supabase Edge Function

Wraps Gemini Flash (primary) + Claude Sonnet 4.6 (fallback) for receipt-photo OCR. Verifies the caller's JWT belongs to an allowlisted email (via `app_users` + `is_allowed_user()` RPC) before spending tokens.

## Layout

```
parse-receipt/
├── index.ts                  # Deno entry: 3 lines.
├── handler.ts                # Pure (Request) => Promise<Response> — runtime-portable.
├── config.ts                 # Deno-only: env loading, Supabase client, isAllowed callback.
├── deno.json                 # Imports map: @supabase/supabase-js → npm:.
├── types.ts                  # ParsedReceipt + AiContext (mirror of @finance-tracker/domain).
├── providers/
│   ├── ai-provider.ts        # IAiProvider strategy interface.
│   ├── gemini-provider.ts    # Implementation using `responseJsonSchema`.
│   └── anthropic-provider.ts # Implementation using `tool_use` forcing.
└── prompts/
    └── receipt-prompt.ts     # buildPrompt + buildSchema — ports of legacy Gemini.js verbatim.
```

## Endpoint

`POST /functions/v1/parse-receipt`

**Headers** — `Authorization: Bearer <jwt>`, `Content-Type: application/json`

**Body**:

```json
{
  "imageBase64": "<base64-encoded JPEG, no `data:` prefix>",
  "mimeType": "image/jpeg",
  "categories": ["Бакалія", "Молочка", ...],
  "products": [{"name": "Молоко 3%"}, ...]
}
```

**200 Response** — `ParsedReceipt` shape (validate client-side via `@finance-tracker/domain.ParsedReceiptSchema`):

```json
{
  "store": "Lidl",
  "date": "2026-05-04",
  "currency": "EUR",
  "total_orig": 12.5,
  "items": [
    { "product_name": "...", "qty": 1, "unit_price_orig": 1.99, "category_suggestion": "Бакалія" }
  ]
}
```

**Errors** — `401 Missing Authorization` · `403 Forbidden: not in allowlist` · `400 Invalid body` · `502 AI parsing failed (both providers)`.

## Local development

```bash
# 1. Set the AI keys in supabase/.env.local (gitignored). SUPABASE_URL and
#    SUPABASE_ANON_KEY are auto-provided by `supabase functions serve`.
echo "GEMINI_API_KEY=..." >> supabase/.env.local
echo "ANTHROPIC_API_KEY=..." >> supabase/.env.local

# 2. Serve the function locally (requires `supabase start` for the DB).
npm run supabase:start
supabase functions serve parse-receipt --env-file supabase/.env.local

# 3. Test with a real JWT (sign in via the web app to /auth/callback to mint one,
#    then copy from devtools localStorage → supabase.auth.token).
curl -s -X POST http://127.0.0.1:54321/functions/v1/parse-receipt \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"imageBase64":"<b64>","categories":["Бакалія"]}'
```

## Production deployment

```bash
# 1. Set secrets (one-time per project / per rotation).
npx supabase secrets set \
  GEMINI_API_KEY=... \
  ANTHROPIC_API_KEY=...

# 2. Deploy.
npx supabase functions deploy parse-receipt
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase — never set them manually.

## Auth model

- `verify_jwt = true` is the platform default → un-authed callers blocked before our code runs.
- We then call `is_allowed_user()` (Postgres SQL function) using the caller's JWT. RLS on `app_users` only returns the user's own row; the function checks for existence. One query, ~10ms.
- If the user signs out, their JWT is invalidated by Supabase → next call returns `403`.

## Why we don't validate the AI output server-side

The legacy Apps Script function ran `Domain.validateParsedReceipt()` after the AI call. We deliberately skip this here:

1. Both providers enforce the JSON schema natively (Gemini: `responseJsonSchema`; Claude: `tool_use input_schema`). Bad output is rare.
2. The web client validates with `ParsedReceiptSchema` (Zod) before showing data to the user. That's the source of truth.
3. Removing Zod from the function avoids cross-runtime resolution gymnastics (Vite ↔ Deno workspace package).
4. If a provider returns malformed JSON, the client surfaces it as a clear error and the user can retry or fall back to manual entry.

If we ever need server-side validation, the cheapest path is to inline a hand-written shape check in `handler.ts` — not to import Zod.

## Drift discipline

The prompt + schema in `prompts/receipt-prompt.ts` MUST stay byte-equal to legacy `legacy/apps-script/src/Gemini.js`. The legacy code is the rollback path; if they diverge, swapping back becomes risky. When updating the prompt, update both files in the same commit.

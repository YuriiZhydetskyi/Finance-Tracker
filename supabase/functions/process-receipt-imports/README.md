# process-receipt-imports

Scheduled background worker з ADR-0016. Браузер його напряму не викликає.

- `pg_cron` викликає функцію з окремим випадковим cron token, збереженим у Vault.
- Один виклик забирає не більше двох PGMQ messages з visibility timeout п’ять хвилин.
- Gemini класифікує й парсить першим; Anthropic працює як fallback.
- Детерміновані gates у `domain.ts` вирішують, чи можна auto-save чек.
- `finalize_receipt_import` зберігає кілька таблиць в одній Postgres-транзакції.
- Retryable failure знову стає видимим; третя помилка переходить у exception queue.

Runtime secrets: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` і `RECEIPT_IMPORT_CRON_TOKEN`. Supabase
інжектить `SUPABASE_URL` та `SUPABASE_SERVICE_ROLE_KEY` для доступу воркера до БД. Handler точно
порівнює bearer token з окремим cron token; `verify_jwt=false` лише вимикає дублюючу
gateway-перевірку і не робить handler публічним. Cron token не має database privileges.

Локальні перевірки:

```powershell
npm --workspace @finance-tracker/process-receipt-imports-fn run test
deno check supabase/functions/process-receipt-imports/index.ts
deno lint supabase/functions/process-receipt-imports
```

Deployment і Vault setup описані в `docs/deploy.md`. Не клади cron token або service-role key у
client env, логи, документацію чи committed files.

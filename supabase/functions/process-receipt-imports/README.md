# process-receipt-imports

Scheduled background worker з ADR-0016. Браузер його напряму не викликає.

- `pg_cron` викликає функцію з окремим випадковим cron token, збереженим у Vault.
- Один виклик забирає одне PGMQ message з visibility timeout п’ять хвилин, щоб не конкурувати за
  AI latency budget усередині одного Edge Function invocation.
- Один provider працює на одну доставку queue message: Gemini 3.7 Flash — перший, Sonnet 5 —
  fallback на наступній доставці.
- Bulk parse повертає row-level evidence. Якщо результат Gemini не проходить arithmetic або
  evidence gate, Sonnet незалежно читає оригінал без primary total чи primary items. Якщо Sonnet
  також не проходить gates, файл переходить у ручну перевірку; третьої AI-моделі немає.
- Детерміновані gates у `domain.ts` та `receipt-reconciliation.ts` вирішують, чи можна auto-save
  чек. Відповідь, обірвана через token limit, завжди вважається помилкою.
- Anthropic використовує компактні aliases лише у provider wire format; перед runtime validation
  вони розгортаються назад у canonical `BulkParsedDocument`.
- Після `max_tokens` або Anthropic request timeout worker читає довгий чек bounded chunks по 40
  фінансових рядків із дворядковим overlap. Кожний `chunk_parse` зберігається в attempt journal
  того самого queue message; merge дозволений лише після exact overlap, metadata, evidence,
  arithmetic та article-count gates.
- Кожний worker/provider stage записується в `receipt_import_attempts`; batch detail показує цей
  журнал разом з оригіналом файла.
- Виправлений користувачем JSON з `needs_review` повертається в ту саму PGMQ-чергу без нового
  provider call. Worker порівнює його з попереднім total/article-count baseline, повторює
  evidence та arithmetic gates і записує окремий `manual_json` attempt.
- `finalize_receipt_import` зберігає кілька таблиць в одній Postgres-транзакції.
- Точний збіг date/time/currency/total автоматично прив’язується до наявного чека; ширші
  duplicate-кандидати лишаються на ручну перевірку.
- Звичайний retryable failure знову стає видимим; третя звичайна помилка переходить у exception
  queue. Chunk protocol має окрему safety-межу 12 доставок.
- Кожен provider request має timeout 130 секунд, але providers не виконуються послідовно в одному
  invocation. Anthropic bulk response має компактний wire format і budget 20000 output tokens;
  більші результати переходять у кілька bounded queue deliveries замість одного довшого request.

## Карта модулів

Лише `index.ts` і `config.ts` знають про Deno. Решта модулів portable (Web Fetch + інʼєктовані
залежності `WorkerDeps`: `db`, `primary`, `fallback`, `cronToken`, `fetch`, `log`), тому
оркестрація тестується у Vitest під Node з fake `db` і fake providers.

| Файл                        | Відповідальність                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `index.ts`                  | `Deno.serve(createHandler(loadWorkerDeps()))`                                                  |
| `config.ts`                 | Читає env, створює service-role Supabase client і providers → `WorkerDeps`                     |
| `constants.ts`              | `BUCKET`, provider timeout, Anthropic token budget, fallback model                             |
| `handler.ts`                | HTTP: метод, cron token, `expire_stale_receipt_import_uploads`, `claim_receipt_import_jobs`    |
| `job-processor.ts`          | `processJob`: сценарій однієї доставки + `obtainParsedDocument`, `rejectForReview`, `finalize` |
| `job-context.ts`            | `loadJobContext`: metadata файла, categories/products/taxonomy, завантаження документа         |
| `job-failure.ts`            | `handleFailure`: журнал помилки й рішення retry / manual review                                |
| `parsing.ts`                | Provider stages: звичайний parse, long-receipt chunks, незалежна перевірка, stored seed        |
| `attempts.ts`               | Журнал `receipt_import_attempts` (`createAttemptLog`), trace/result поля, лог reconciliation   |
| `exceptions.ts`             | RPC `complete_receipt_import_exception` / `complete_manual_receipt_import_exception`           |
| `taxonomy-enrichment.ts`    | Доповнення порожніх taxonomy-атрибутів продуктів після успішної фіналізації                    |
| `fx.ts`                     | Курс EUR/UAH від NBU через інʼєктований `fetch`                                                |
| `messages.ts`               | Публічні повідомлення про помилки provider/worker                                              |
| `encoding.ts`               | `bytesToBase64`, `ulid`                                                                        |
| `types.ts`                  | `Job`, `ImportFile`, attempt/provider типи, `WorkerDeps`, `RetryableImportError`               |
| `domain.ts`                 | Детерміновані gates: validation, arithmetic, evidence, `prepareReceipt`                        |
| `long-receipt.ts`           | Протокол chunk-ів довгого чека                                                                 |
| `receipt-reconciliation.ts` | Вибір provider/seed і звірка незалежного читання                                               |

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

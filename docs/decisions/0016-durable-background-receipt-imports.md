# ADR-0016: Стійкий фоновий імпорт великої кількості документів

**Status:** accepted
**Date:** 2026-08-31

## Context

Звичайний `/photo` тримає файли й результати в пам’яті браузера, послідовно викликає AI та
просить переглянути кожен чек. Це зручно для кількох чеків, але не для накопиченої папки до 200
сканів, де є також PDF, що не є чеками. Закриття вкладки не повинно зупиняти вже завантажену
роботу.

## Considered options

- Розширити `/photo` і залишити client-side чергу.
- Зберігати завдання в Postgres і опитувати їх без окремої черги.
- Додати окремий `/imports` з Supabase Storage, PGMQ, Cron та Edge Function worker.

## Decision outcome

Додаємо окремий режим `/imports`. Браузер готує й завантажує максимум 200 документів з одним
`paid_by`; файли понад 6 МБ завантажуються через resumable TUS. Після реєстрації в PGMQ браузер
більше не є частиною processing path.

Cron викликає `process-receipt-imports`, worker забирає максимум два повідомлення, класифікує
документ через Gemini з Anthropic fallback і автоматично зберігає лише чек, який пройшов суворі
перевірки. Нечек, невпевнена класифікація, невідповідність суми, можлива семантична копія або
остаточна технічна помилка переходять у persisted exception queue. Один PDF дорівнює одному
документу. Невідома категорія стає `Інше`, `consumed_by` — `shared`.

`finalize_receipt_import` атомарно створює receipt, items, products і product_prices. Worker-only
RPC доступні лише `service_role`; browser RPC перевіряють allowlist. `/photo` та `pending_parses`
не змінюють своєї семантики.

## Consequences

- Вкладку можна закрити після завершення upload/queue кроку.
- Обробка відновлюється після тимчасових збоїв і має максимум три спроби.
- Production потребує PGMQ, pg_cron, pg_net, Vault secrets та окремого deploy worker-функції.
- AI-класифікація не вважається достатньою для auto-save без детермінованих validation gates.
- Сирі файли та exception metadata потребуватимуть окремої retention policy у майбутньому.

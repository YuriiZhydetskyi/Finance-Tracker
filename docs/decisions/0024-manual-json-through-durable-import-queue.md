# ADR-0024: Ручний JSON через стійку чергу імпорту

- Status: accepted
- Date: 2026-09-03
- Extends: [ADR-0016](0016-durable-background-receipt-imports.md),
  [ADR-0022](0022-printed-article-count-repair.md)

## Context and Problem Statement

Після двох невдалих AI-перевірок довгий чек може лишитися у `needs_review`, хоча користувач може
окремо попросити Claude або інший інструмент перечитати PDF й підготувати виправлений JSON.
Наявний ручний JSON-імпорт у `/photo` створював новий client-side review item і не закривав
`receipt_import_file`, не зберігав його durable audit link та міг лишити batch з винятком.

Вставлений JSON є недовіреним input. Сам факт, що він синтаксично валідний, не дозволяє обходити
перевірку рядків, підсумку, надрукованої кількості товарів, дедуплікацію або транзакційну
фіналізацію.

## Considered Options

- Залишити `/photo` окремим шляхом і вручну позначати import-file вирішеним.
- Зберігати receipt у браузері, а потім окремим RPC прив'язувати його до import-file.
- Дати browser-клієнту доступ до worker-only `finalize_receipt_import`.
- Записати ручний JSON у той самий import-file і повторно провести його через PGMQ worker.

## Decision Outcome

Ручний JSON стає альтернативним input того самого durable workflow:

1. UI локально перевіряє canonical schema, row evidence, line totals, арифметику, ordinals,
   `article_count` і попередньо прочитані `total_orig/article_count`.
2. Authenticated RPC `submit_receipt_import_json` приймає рівно один bounded JSON object лише для
   файла у `needs_review`, записує його в `manual_json` і повертає файл у PGMQ.
3. Worker не викликає AI для такої доставки. Він повторно валідовує manual JSON на серверному
   боці, порівнює його з provider baseline у `parsed_json`, запускає ті самі evidence,
   arithmetic, category, FX та duplicate gates.
4. Успішний результат проходить через наявний worker-only `finalize_receipt_import`, тому receipt,
   items, products, price snapshots та import-file оновлюються в одній Postgres-транзакції.
5. Невалідний manual JSON одразу повертається у `needs_review`. `parsed_json` з provider baseline
   не перезаписується, а submission і результат лишаються в `manual_json` та attempt journal.
6. Звичайний «Повторити аналіз» очищає `manual_json`, щоб наступна доставка знову викликала
   providers.

`finalize_receipt_import` не отримує browser grant і залишається доступним лише `service_role`.
Новий browser RPC перевіряє allowlist, не має прямого write grant на import tables і лише ставить
bounded роботу в чергу.

## Consequences

### Позитивні

- Виправлений JSON закриває саме той PDF і batch, для яких виник виняток.
- PDF, provider baseline, attempt history, duplicate checks і transaction boundary зберігаються.
- Користувач одразу бачить конкретні розбіжності, а server-side worker не довіряє client check.
- Manual submission не витрачає ще один AI-виклик.

### Негативні та обмеження

- Production release потребує одночасно застосувати migration і deploy нової версії worker.
- Verbatim evidence доводить внутрішню узгодженість JSON, але не є новим computer-vision читанням
  PDF; користувач або зовнішній AI усе одно має правильно переписати видимі рядки.
- `manual_json` має bounded розмір 1 MiB і максимум 500 фінансових позицій.

## References

- [Supabase Database Functions](https://supabase.com/docs/guides/database/functions)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [process-receipt-imports/index.ts](../../supabase/functions/process-receipt-imports/index.ts)
- [submit manual JSON migration](../../supabase/migrations/20260902214756_submit_manual_receipt_import_json.sql)

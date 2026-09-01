# ADR-0018: Доказове розпізнавання та незалежна перевірка чеків

- Status: accepted
- Date: 2026-09-01
- Supersedes: [ADR-0017](0017-bulk-import-arithmetic-repair.md)
- Extends: [ADR-0016](0016-durable-background-receipt-imports.md)

## Context and Problem Statement

Item-only repair з ADR-0017 отримував надрукований підсумок, попередню обчислену суму та
попередні позиції. Такий запит добре знаходив можливе виправлення, але не був незалежною
перевіркою: модель уже знала число, до якого треба дійти. Крім того, фінальна арифметична
збіжність не доводила, що кожна кількість або повторний рядок справді видимі в документі.

Реальні винятки показали щонайменше два різні layout-дефекти: правий VAT-клас `2` на чеках dm
розпізнавався як `qty=2`, а один із кількох однакових рядків міг бути пропущений. Однакове
повідомлення «сума не збігається» не пояснювало користувачу, який саме етап і чому не пройшов.
Console logs Edge Function також не були достатнім audit trail після завершення виклику.

## Considered options

- Лише розширити extraction prompt і лишити арифметику єдиним gate.
- Передавати repair-моделі очікувану суму, але просити не вигадувати balancing item.
- Завжди відправляти mismatch на ручну перевірку.
- Вимагати row-level evidence, виконувати blind cross-provider parse та зберігати кожну спробу.

## Decision Outcome

### 1. Evidence-first bulk contract

Bulk extraction, на відміну від інтерактивного photo-import, повертає для кожного фінансового
рядка:

- послідовний `source_ordinal`;
- короткий дослівний `raw_text` видимого рядка;
- `row_kind`;
- `qty_evidence`: implicit one, explicit multiplier або weight/volume;
- надрукований line total, якщо він є;
- окремий `tax_class`, якщо праворуч надруковано VAT-клас.

Підсумковий рядок також має `total_raw_text`. Детермінований evidence gate перевіряє суцільну
нумерацію, наявність видимого multiplier для `qty != 1`, вагові одиниці, line total та присутність
розпізнаної суми у тексті підсумкового рядка. Prompt окремо забороняє перетворювати VAT-клас на
кількість, згортати однакові сусідні рядки або вигадувати balancing row.

### 2. Точна бухгалтерська арифметика

Позиції рахуються після one-to-one cancellation/discount pairing з ADR-0015 і округлення кожного
рядка до cent. Допуск фіксований на `0.02 EUR/UAH`; відсотковий допуск більше не використовується,
бо на великому чеку він міг приховати пропущений дешевий товар.

### 3. Blind independent verification

Якщо Gemini primary має arithmetic mismatch або не проходить evidence gate, Anthropic отримує
лише оригінальний image/PDF, категорії та той самий повний bulk contract. Йому не передаються
первинні позиції, primary total, computed total або величина різниці.

Secondary result приймається лише коли він самостійно:

1. класифікує той самий документ як receipt;
2. погоджується щодо дати, валюти, продавця, часу та printed total;
3. проходить evidence gate;
4. має точну детерміновану арифметику.

Після цього primary metadata лишається канонічною, а evidenced secondary items замінюють позиції.
Детермінований comparator формує причину на кшталт `tax_class_as_quantity`,
`missing_repeated_row` або `missing_discount`. Якщо будь-яка умова не виконана, import лишається
fail-closed у review.

### 4. Завершеність provider response

Gemini приймається лише з `finishReason=STOP`, Anthropic — лише зі `stop_reason=tool_use`.
`MAX_TOKENS`, відсутній tool output або невалідний JSON є помилкою, а не частковим успіхом.
Bulk Gemini використовує thinking level `high` і high media resolution; Anthropic має окремий
bulk budget `8192` output tokens.

### 5. Постійний audit trail

`receipt_import_attempts` зберігає кожний analysis run та stage: worker, primary, fallback і
independent check. Запис створюється зі статусом `started` до зовнішнього виклику, тому аварійно
обірваний процес лишається видимим. Після завершення фіксуються provider/model, безпечні settings,
duration, token usage, request id, stop reason, printed/computed totals, diagnosis, validated JSON
і коротке user-facing повідомлення.

Таблиця доступна frontend лише на читання через allowlist RLS; service role має тільки потрібні
`select/insert/update`. Повний provider error body та secrets у таблицю чи console не пишуться.
Batch detail показує історію поруч з оригінальним файлом як для винятків, так і для вже збережених
документів.

## Consequences

### Позитивні

- Correct total більше не є єдиним доказом правильності OCR.
- Independent model не може цілеспрямовано підігнати позиції під відому різницю.
- Відомі layout-помилки мають перевірювані diagnosis codes і зрозуміле пояснення в UI.
- Provider truncation і завислі/обірвані запуски можна відрізнити від document validation failure.
- Кожний requeue створює новий analysis run, не стираючи попередні результати.

### Негативні та обмеження

- Bulk output і storage займають більше місця через row evidence та attempt history.
- Problematic receipt потребує другого provider call і має більшу latency та AI-вартість.
- `raw_text` є твердженням моделі, а не координатами OCR; захист забезпечує поєднання двох
  незалежних читань, deterministic gates та доступного користувачу оригіналу.
- Старі attempt details не виникають ретроспективно; вони з'являються після нового requeue.

## References

- [ADR-0015](0015-pair-detector-multi-tuple-aggregation.md)
- [ADR-0016](0016-durable-background-receipt-imports.md)
- [bulk-import-prompt.ts](../../supabase/functions/parse-receipt/prompts/bulk-import-prompt.ts)
- [domain.ts](../../supabase/functions/process-receipt-imports/domain.ts)
- [receipt-reconciliation.ts](../../supabase/functions/process-receipt-imports/receipt-reconciliation.ts)

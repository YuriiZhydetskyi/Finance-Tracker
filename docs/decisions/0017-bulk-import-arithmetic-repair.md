# ADR-0017: Детермінована арифметика та cross-provider repair у bulk-import

- Status: superseded by [ADR-0018](0018-evidence-based-receipt-verification.md)
- Date: 2026-08-31
- Extends: [ADR-0015](0015-pair-detector-multi-tuple-aggregation.md), [ADR-0016](0016-durable-background-receipt-imports.md)

## Context and Problem Statement

Суворий arithmetic gate з ADR-0016 правильно не зберігав чек, коли сума розпізнаних позицій не
збігалася з надрукованим підсумком. Аналіз реального batch виявив, що однаковий симптом мав дві
різні причини:

1. AI міг пропустити повторний рядок, переплутати VAT-class із кількістю, прочитати цифру ціни
   неправильно або сплутати pack-size з окремим розрахунком Pfand.
2. Навіть правильний AI-result міг бути зіпсований background-нормалізацією. Локальна реалізація
   повторно застосовувала кілька однакових Rabatt-рядків до першої позитивної позиції, тоді як
   ADR-0015 вимагає one-to-one matching із claimed rows.

Просте розширення prompt не усуває детермінований дефект і не дає надійної перевірки відповіді
тієї самої моделі. Водночас не можна автоматично приймати вигаданий balancing item або дозволяти
repair-моделі змінити надрукований total.

## Considered options

- Лише доповнити основний extraction prompt.
- Після mismatch повторити той самий запит тією самою моделлю.
- Одразу відправляти всі arithmetic mismatch у manual review.
- Виправити deterministic pairing та додати один незалежний item-only repair іншого provider.

## Decision Outcome

### 1. Єдина арифметична семантика

Background worker нормалізує cancellation/discount rows тим самим двопрохідним правилом, що й
канонічний pair-detector з ADR-0015:

1. exact cancellations мають пріоритет;
2. решта негативів можуть стати partial discounts;
3. кожен позитивний і негативний source row можна claim лише один раз;
4. unpaired negative rows зберігаються як самостійні фінансові позиції.

Нормалізація і arithmetic gate використовують одну pure-функцію. Вона округлює qty, unit price,
discount і line total за тими самими правилами, що й finalization, тому pre-check і persisted
receipt не можуть розійтися через дві реалізації формули.

### 2. Один незалежний repair-pass

Якщо Gemini успішно повернув `document_kind="receipt"`, але deterministic arithmetic не зійшлася,
worker один раз передає оригінальний image/PDF Anthropic. Це не повний повторний parse: окремий
schema дозволяє повернути лише `items`.

Repair отримує як evidence:

- незмінний надрукований `total_orig` із primary extraction;
- обчислену суму попередніх позицій;
- попередній список позицій для порівняння;
- оригінальний документ.

У candidate замінюється тільки `items`. Store, address, date, time, currency, classification і
`total_orig` завжди беруться з primary result. Candidate повторно проходить runtime validation,
one-to-one normalization та arithmetic gate. Він приймається лише коли сума виправлених видимих
рядків збігається з зафіксованим printed total.

Prompt прямо забороняє adjustment/balancing items і зміну цифр лише заради збіжності. Він також
описує підтверджені layout-пастки: VAT class у правій колонці dm, pack-size поруч із Pfand та
окремі повторні рядки однакового товару.

### 3. Fail-closed поведінка

Якщо repair падає, повертає невалідні items або арифметика все одно не збігається, worker не
виконує auto-save і залишає початковий parse у persisted exception для review. Якщо primary
provider упав і вже був використаний Anthropic fallback, третього AI-виклику немає.

Worker пише структурований operational log із file id, статусом repair та сумами before/after,
але без повного OCR payload і provider secrets.

## Consequences

### Позитивні

- Правильні repeated-discount extraction більше не псуються application code.
- Частину очевидних OCR/layout помилок можна безпечно виправити без ручного перегляду.
- Printed total і receipt metadata не контролюються repair-моделлю.
- Невирішені або сумнівні документи зберігають попередню fail-closed поведінку.

### Негативні та обмеження

- Arithmetic mismatch після успішного Gemini parse додає один Anthropic call, тому такий файл має
  більшу latency і AI-вартість.
- Repair не доводить семантичну правильність позицій, якщо неправильні рядки випадково дають ту
  саму суму. Інші validation gates і review workflow лишаються необхідними.
- Уже завершені exception rows автоматично не перезапускаються після deploy; requeue є окремою
  операційною дією.
- Зміна не потребує нової таблиці, колонки, RPC або Supabase migration.

## References

- [ADR-0015](0015-pair-detector-multi-tuple-aggregation.md)
- [ADR-0016](0016-durable-background-receipt-imports.md)
- [process-receipt-imports/domain.ts](../../supabase/functions/process-receipt-imports/domain.ts)
- [ADR-0018](0018-evidence-based-receipt-verification.md)
- [bulk-import-prompt.ts](../../supabase/functions/parse-receipt/prompts/bulk-import-prompt.ts)

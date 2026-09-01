# ADR-0023: Компактне поетапне розпізнавання довгих чеків

- Status: accepted
- Date: 2026-09-01
- Extends: [ADR-0016](0016-durable-background-receipt-imports.md),
  [ADR-0022](0022-printed-article-count-repair.md)

## Context and Problem Statement

Після переходу на Sonnet 5 один довгий production PDF двічі завершився рівно на `16384`
output tokens із `stop_reason=max_tokens`. Обидва виклики мали однакові параметри та витратили
приблизно 99 секунд, тому звичайний retry не міг змінити результат. Просте збільшення token
budget ризикує перетнути 130-секундний provider timeout і 150-секундний request idle timeout
Supabase Edge Functions.

Окремий короткий EDEKA-чек показав іншу проблему: standalone multiplier `2 x 1,79`, надрукований
між рядками хліба `2,99` і молока `3,58`, модель механічно приєднала до попереднього товару.
Evidence gate правильно заблокував `2 x 1,79 != 2,99`, але загальний prompt не пояснював цей
layout і не мав безпечного deterministic repair.

## Considered Options

- Лише підняти `max_tokens` до максимального значення Sonnet 5.
- Після `max_tokens` повторювати той самий запит.
- Скоротити evidence та перестати зберігати verbatim rows.
- Стиснути provider wire format, а надзвичайно довгі чеки читати bounded chunks через PGMQ.
- Виправляти multiplier лише prompt-ом.
- Додати prompt правило разом із fail-closed adjacent-row reassociation.

## Decision Outcome

### 1. Компактний Anthropic wire format

Canonical `BulkParsedDocument` і persisted JSON не змінюються. Лише Anthropic tool input для
кожної позиції використовує короткі aliases (`n`, `q`, `u`, `r` тощо), після чого provider
негайно розгортає їх у canonical поля й передає на наявну runtime validation. Це прибирає
повторення довгих JSON-ключів на кожному рядку, не втрачаючи evidence.

Bulk budget становить `20000` output tokens із вимкненим thinking. Частковий tool input при
`max_tokens` як і раніше не приймається.

### 2. Durable chunk fallback після `max_tokens`

Якщо повний Sonnet-result досягає token limit або request timeout, наступна доставка того самого
PGMQ message переходить у chunk mode:

- одна доставка читає щонайбільше 40 фінансових рядків;
- ordinals абсолютні від початку документа;
- наступний chunk повторює два попередні рядки;
- кожний validated chunk зберігається як окремий `chunk_parse` attempt, прив'язаний до того самого
  `queue_message_id`;
- overlap має збігтися за всіма фінансовими та verbatim полями;
- receipt metadata, printed total і article count мають збігатися між усіма chunks;
- фінальний merge проходить повні evidence, arithmetic та article-count gates.

Queue safety ceiling — 12 доставок. Звичайні provider/audit помилки не отримують додаткових
retry; межа використовується лише явно запланованим chunk protocol. Новий manual requeue має
інший message id і не може підхопити старі chunks.

### 3. Доказове переприв'язування multiplier

Bulk prompt вимагає перевіряти standalone multiplier між двома товарами в обидва боки через
надрукований line total. Після provider validation worker може перенести multiplier на наступний
рядок лише коли одночасно виконано всі умови:

1. попередній item має explicit integer multiplier і line-total mismatch;
2. наступний item має implicit qty=1;
3. `multiplier qty × unit price` точно дорівнює line total наступного item;
4. raw evidence однозначно ділиться на product fragment і standalone multiplier fragment;
5. після перенесення обидва line totals, повний receipt total, article count та evidence стають
   валідними;
6. існує рівно один такий кандидат у всьому чеку.

Provider result у attempt history лишається незмінним; worker details окремо фіксують
переприв'язування. Будь-яка неоднозначність залишається у review.

## Consequences

### Позитивні

- Довгий чек не повторює завідомо однаковий обірваний запит.
- Chunk calls вкладаються в Edge Function latency budget і відновлюються через durable queue.
- Canonical schema, audit trail і fail-closed gates не послаблюються.
- Відомий EDEKA layout виправляється лише за повним набором незалежних арифметичних доказів.

### Негативні та обмеження

- Дуже довгий чек коштує кілька повних vision reads оригінального PDF.
- Strict overlap може залишити чек у review через дрібну OCR-нестабільність; це навмисний вибір на
  користь фінансової точності.
- Chunk completeness усе ще залежить від `has_more`, тому хибний фінальний marker приймається
  лише якщо повна арифметика й надрукована кількість товарів незалежно підтверджують результат.

## References

- [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits)
- [Supabase Queues](https://supabase.com/docs/guides/queues)
- [Claude stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)
- [Claude Sonnet 5 changes](https://platform.claude.com/docs/en/models/sonnet-5/whats-new-sonnet-5)
- [process-receipt-imports/index.ts](../../supabase/functions/process-receipt-imports/index.ts)
- [long-receipt.ts](../../supabase/functions/process-receipt-imports/long-receipt.ts)

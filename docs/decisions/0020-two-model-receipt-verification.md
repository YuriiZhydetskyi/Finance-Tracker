# ADR-0020: Gemini 3.7 Flash і Sonnet 5 без третьої verification-моделі

- Status: superseded by [ADR-0021](0021-physical-row-audit-for-repeated-items.md)
- Date: 2026-09-01
- Supersedes: [ADR-0011](0011-claude-fallback.md), [ADR-0019](0019-staged-receipt-verification.md)
- Extends: [ADR-0016](0016-durable-background-receipt-imports.md)

## Context and Problem Statement

У погодженій конфігурації розпізнавання чеків Gemini 3.7 Flash є primary-моделлю, а Claude
Sonnet 5 — єдиним fallback і незалежним verifier. Під час production-діагностики до worker було
додано Claude Opus 4.7 як третю модель для результатів Sonnet, що не пройшли детерміновані
перевірки. Це збільшило вартість і змінило provider policy без окремого погодження.

Водночас Sonnet 5 є прямим наступником Sonnet 4.6, але має дві важливі API-відмінності для цього
pipeline: non-default sampling parameters повертають HTTP 400, а adaptive thinking увімкнено за
замовчуванням і ділить `max_tokens` зі structured output.

## Considered Options

- Залишити Sonnet 4.6 і Opus 4.7 для третьої перевірки.
- Замінити обидві Anthropic-моделі на Sonnet 5, зберігши три model calls.
- Використовувати лише Gemini 3.7 Flash і Sonnet 5, після невирішеного результату переходити до
  ручної перевірки.

## Decision Outcome

### 1. Дві моделі з чіткими ролями

Worker і звичайний photo-import використовують:

1. `gemini-3.7-flash` як primary;
2. `claude-sonnet-5` як fallback та єдиний незалежний verifier.

Якщо Gemini повернув валідний результат, який не пройшов arithmetic або evidence gate, наступна
доставка виконує blind parse через Sonnet. Sonnet отримує лише оригінальний документ і стандартний
prompt; primary rows, total difference та попередній output моделі йому не передаються.

Якщо Gemini provider упав, наступна доставка виконує Sonnet як fallback. Якщо результат Sonnet не
проходить детерміновані gates або не узгоджується з Gemini, файл переходить у `needs_review`.
Третьої verification-моделі та автоматичної ескалації до Opus немає. Транзієнтна помилка самого
Sonnet verification-call може повторити той самий call у межах queue retry budget, але не змінює
provider.

Queued message, створений старою версією worker для Opus-етапу, fail-closed переходить у ручну
перевірку без нового AI-виклику та без можливості автоматично зберегти старий Anthropic seed.

### 2. Параметри Sonnet 5

Anthropic request використовує canonical model ID `claude-sonnet-5` і forced `record_receipt`
tool. `temperature`, `top_p` та `top_k` не передаються. `thinking: { type: "disabled" }` явно
зберігає попередню no-thinking поведінку Sonnet 4.6: token budget залишається доступним для повного
structured result, а latency fallback не збільшується через adaptive reasoning.

Provider читає `tool_use` block за `type` і `name`, а не за позицією в `content`, тому response
parsing не залежить від наявності інших content blocks.

### 3. Дані та audit trail

Схема БД не змінюється. `receipt_import_attempts.model`, token usage, status і result JSON далі
зберігають фактичний model ID кожного виклику. Історичні записи Opus не видаляються.

## Consequences

### Позитивні

- Production policy відповідає погодженій конфігурації та має передбачувану верхню межу вартості.
- Sonnet 5 використовується і для interactive fallback, і для bulk-import без unsupported
  sampling parameters.
- Невирішені фінансові розбіжності fail-closed і лишаються видимими у ручній перевірці разом з
  оригінальним файлом та attempt history.
- Старі queued escalation повідомлення не можуть випадково викликати Opus після deploy.

### Негативні та обмеження

- Якщо Gemini недоступний, а Sonnet повернув арифметично неповний чек, немає другої незалежної
  Anthropic-моделі для автоматичного repair.
- Частка `needs_review` може зрости для документів, де дві моделі не дали достатнього evidence.
- Sonnet 5 має інший tokenizer; фактичну вартість треба оцінювати за збереженими usage tokens, а не
  лише за ціною одного токена.

## References

- [Claude Sonnet 5 migration guide](https://platform.claude.com/docs/en/models/sonnet-5/migration-guide)
- [Claude model IDs and versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions)
- [ADR-0016](0016-durable-background-receipt-imports.md)
- [process-receipt-imports/index.ts](../../supabase/functions/process-receipt-imports/index.ts)
- [anthropic-provider.ts](../../supabase/functions/parse-receipt/providers/anthropic-provider.ts)

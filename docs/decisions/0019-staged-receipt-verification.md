# ADR-0019: Поетапна незалежна перевірка чеків через чергу

- Status: accepted
- Date: 2026-09-01
- Supersedes: [ADR-0018](0018-evidence-based-receipt-verification.md)
- Extends: [ADR-0016](0016-durable-background-receipt-imports.md)

## Context and Problem Statement

ADR-0018 виконував Gemini primary і Anthropic fallback послідовно в одному Edge Function
invocation. Production-журнали показали дві окремі межі такого підходу:

- довгий PDF потребував понад `8192` output tokens, а збільшити одночасно token budget і timeout
  fallback було неможливо без ризику перевищити 150-секундний request idle timeout;
- коли Gemini був недоступний, повторні спроби одного й того самого Sonnet давали однаковий
  arithmetic mismatch і не були незалежними перевірками.

Водночас PGMQ вже забезпечує кілька доставок одного файла та зберігає `read_count`, а
`receipt_import_attempts` зберігає validated result кожного provider call.

## Considered options

- Лише збільшити Anthropic token limit і скоротити timeout Gemini.
- Запускати providers паралельно в одному invocation.
- Продовжувати повторювати Sonnet до третьої доставки.
- Виконувати один provider call на доставку й використовувати persisted result як seed лише для
  детермінованого порівняння з наступним blind parse.

## Decision Outcome

### 1. Один provider на одну доставку

Перша доставка виконує Gemini з `HIGH` thinking. Якщо provider падає, друга доставка виконує
Sonnet. Кожен call має власний timeout до 130 секунд; послідовні provider timeout більше не
складаються в одному HTTP request.

Bulk Anthropic отримує до `16384` output tokens. Часткова відповідь із `max_tokens` так само
fail-closed і не може бути збережена як чек.

### 2. Persisted blind verification

Якщо validated parse має arithmetic mismatch або не проходить evidence gate, worker не передає
його значення іншій моделі. Результат уже лежить у `receipt_import_attempts.result_json`; наступна
доставка знову відправляє лише оригінальний файл і стандартний extraction prompt:

- Gemini mismatch перевіряє Sonnet;
- Sonnet mismatch перевіряє окрема verification-модель Opus;
- comparator читає обидва validated results з нашого коду, але жодна модель не бачить output,
  total difference чи підказку попередньої моделі.

Для Opus 4.7 request не містить custom `temperature`: ця модель приймає лише default sampling
поведінку. Sonnet 4.6 зберігає низьку temperature для детермінованішого OCR.

Якщо Sonnet після Gemini також не проходить gates, його результат стає seed для Opus на третій
доставці. Provider error verification-call можна повторити до третьої доставки; після цього файл
лишається у review.

### 3. Верифікаційний self-audit без balancing

Bulk prompt вимагає перед відповіддю ще раз пройти всі фінансові рядки, якщо їхня сума не
збігається з printed total. Другий прохід окремо перевіряє repeated rows, discount/refund,
quantity evidence та unit/line price. Він не дозволяє додавати або змінювати позицію без окремо
видимого `raw_text`.

Якщо дві незалежні моделі лишають ту саму розбіжність, comparator формує точний diagnosis. Для
випадку, коли gap дорівнює ще одному вже повтореному рядку, UI прямо показує товар, суму та те,
що доказу для автоматичного додавання бракує.

## Consequences

### Позитивні

- Довгі чеки мають достатній token/time budget без перевищення request idle limit.
- Незалежна перевірка не є повтором тієї самої моделі після падіння primary.
- Retry використовує durable queue та audit trail замість довгого browser/HTTP session.
- Невирішена розбіжність має конкретну гіпотезу, але не змінює фінансові дані без доказу.

### Негативні та обмеження

- Problematic receipt може чекати два cron intervals і коштувати до трьох model calls.
- Opus дорожчий за Sonnet, тому використовується лише для fallback-result, який не пройшов gates.
- `result_json` в attempt history стає частиною operational state для продовження verification;
  його retention не можна скорочувати без нового рішення.

## References

- [ADR-0016](0016-durable-background-receipt-imports.md)
- [ADR-0018](0018-evidence-based-receipt-verification.md)
- [process-receipt-imports/index.ts](../../supabase/functions/process-receipt-imports/index.ts)
- [receipt-reconciliation.ts](../../supabase/functions/process-receipt-imports/receipt-reconciliation.ts)

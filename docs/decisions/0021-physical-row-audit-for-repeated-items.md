# ADR-0021: Окремий фізичний аудит повторюваних рядків чека

- Status: superseded by [ADR-0022](0022-printed-article-count-repair.md)
- Date: 2026-09-01
- Supersedes: [ADR-0020](0020-two-model-receipt-verification.md)
- Extends: [ADR-0016](0016-durable-background-receipt-imports.md)

## Context and Problem Statement

Production-перевірка довгого PDF підтвердила дві незалежні проблеми. Старий manual requeue міг
повторно використати Anthropic-result із попереднього queue cycle; це окремо виправлено
прив'язкою attempt до PGMQ message. Після свіжого запуску Gemini 3.7 Flash отримав HTTP 429, а
Sonnet 5 заново прочитав оригінал, однак емітив лише 10 із 12 фізично надрукованих однакових
рядків. Надрукований total був правильним, а arithmetic gap дорівнював `2 × 1.99`.

Загальний prompt уже забороняв згортати однакові рядки й вимагав повторного visual sweep. Цього
виявилося недостатньо: модель могла самоконсистентно пропустити кілька повторів. Водночас
автоматично домальовувати позиції лише з арифметики небезпечно, бо таку саму різницю може
пояснювати інший товар, знижка або повернення.

## Considered Options

- Лише сильніше сформулювати один рядок у загальному extraction prompt.
- Автоматично додавати `gap / repeated-line-price` копій без нового читання документа.
- Повернути третю модель Opus.
- Залишити дві погоджені моделі, але додати окремий physical-row audit і deterministic gates.

## Decision Outcome

### 1. Конкретний repeated-row protocol у стандартному prompt

Bulk prompt явно вимагає рахувати кожний фізичний фінансовий рядок. Для повторюваної комбінації
`product_code + price` модель ділить входження на візуальні блоки, розділені іншими товарами,
рахує блоки зверху вниз і знизу вгору та звіряє обидва результати. Приклад `4 + 4 + 4` прямо
пояснює, що треба емітити 12 окремих items, а не 10 і не `qty=12` без надрукованого multiplier.

Count можна брати лише з видимих рядків, не з final total або arithmetic gap.

### 2. Окремий verification prompt

Verification-call отримує оригінальний image/PDF і спеціалізований physical-row ledger prompt.
Йому не передають previous extraction, computed total, gap, підозрюваний товар або запропоновану
кількість. Тому audit фокусується на повноті транскрипції, але не знає числа, під яке треба
підігнати результат.

Якщо Gemini-result не проходить gate, delivery 2 виконує цей audit через Sonnet 5. Якщо Gemini
був недоступний і звичайний Sonnet fallback на delivery 2 має mismatch, delivery 3 виконує той
самий Sonnet 5 ще раз, але вже у спеціалізованому audit mode. Це не третя модель і не повернення
Opus; provider policy лишається Gemini 3.7 Flash + Sonnet 5.

Повторний audit дозволений лише в межах того самого PGMQ message. Новий manual requeue завжди
починається без historical seed.

### 3. Fail-closed acceptance і точний diagnosis

Audit-result проходить ті самі runtime schema, row evidence, receipt identity та exact arithmetic
gates. Correct total сам по собі не дозволяє додати рядок. Якщо audit має повну evidenced
арифметику, його items можна прийняти; comparator визначає `missing_repeated_row` і для кількох
відновлених копій.

Якщо mismatch лишився, deterministic diagnosis шукає лише однозначну repeated group, для якої
gap дорівнює цілому числу line totals. UI/log отримує `occurrences`, `missingOccurrences` і
`expectedOccurrences`, але дані не змінюються автоматично.

## Consequences

### Позитивні

- Відомий layout із кількома блоками однакових товарів має окремий verification path.
- Provider не бачить очікуваного виправлення й не може просто збалансувати чек під gap.
- Політика з двома моделями зберігається; Opus не повертається.
- Невдалий audit пояснює не лише суму, а й точну repeated-row гіпотезу.

### Негативні та обмеження

- Коли Gemini недоступний, проблемний Sonnet-result може коштувати другого Sonnet call і ще
  одного cron interval.
- Два читання тією самою моделлю не є статистично незалежними. Без координатного OCR повну
  незалежність гарантувати неможливо, тому acceptance лишається fail-closed через evidence та
  arithmetic gates.
- Модель усе ще може двічі недорахувати однаковий блок. У такому випадку файл залишається у
  review; арифметична гіпотеза ніколи не перетворюється на невидимі items автоматично.

## References

- [ADR-0016](0016-durable-background-receipt-imports.md)
- [ADR-0020](0020-two-model-receipt-verification.md)
- [bulk-import-prompt.ts](../../supabase/functions/parse-receipt/prompts/bulk-import-prompt.ts)
- [process-receipt-imports/index.ts](../../supabase/functions/process-receipt-imports/index.ts)
- [receipt-reconciliation.ts](../../supabase/functions/process-receipt-imports/receipt-reconciliation.ts)

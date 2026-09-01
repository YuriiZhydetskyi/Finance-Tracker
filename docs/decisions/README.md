# Architecture Decision Records (ADR)

Цей каталог містить **причини** для всіх нетривіальних архітектурних рішень. Один файл = одне рішення. Формат — **MADR 3.0 short** (Context / Considered Options / Decision Outcome / Consequences / Pros and Cons).

## Як читати

- ADR-и пронумеровано хронологічно (`0001`, `0002`, ...). Номери **ніколи не переномеровуємо**.
- Status: `accepted` (рішення в силі), `superseded` (замінено новішим — посилається на номер), `deprecated` (більше не актуальне).
- При зміні рішення — створюємо **новий** ADR, який supersedes попередній. Старий не видаляємо.

## Як додавати новий

1. Скопіюй найсвіжіший ADR як шаблон.
2. Назви файл `NNNN-kebab-case-title.md` (наступний вільний номер).
3. Заповни секції MADR.
4. Додай рядок в індекс нижче.
5. Якщо рішення замінює старе — постав старому `Status: superseded by NNNN` і посилання.

## Індекс

| # | Назва | Status | Тема |
|---|---|---|---|
| [0001](0001-google-sheets-as-storage.md) | Google Sheets як основне сховище | superseded by 0013 | Storage |
| [0002](0002-apps-script-runtime-and-clasp.md) | Google Apps Script як runtime, clasp + Git як toolchain | superseded by 0013 | Runtime |
| [0003](0003-gemini-with-provider-abstraction.md) | Gemini Flash для парсингу чеків + тонка AiClient-абстракція | accepted (revised) | AI |
| [0004](0004-multi-currency-eur-base.md) | Multi-currency з EUR як базою; зберігаємо оригінал + EUR + курс | accepted (revised) | Schema |
| [0005](0005-alpine-for-ui-no-build.md) | Alpine.js для реактивності UI; без build-pipeline | superseded by 0013 | UI |
| [0006](0006-separate-pages-per-mode.md) | Окремі HTML-сторінки на кожен режим (photo / manual / edit) | superseded by 0013 | UI |
| [0007](0007-products-as-optional-dimension.md) | Products як необов'язковий покажчик; селективний каталог | accepted | Schema |
| [0008](0008-prices-computed-from-items.md) | Reference prices обчислюються з історії Items; без окремої таблиці | accepted | Analytics |
| [0009](0009-notes-columns-and-wasted-qty.md) | Notes як прості колонки; spoilage як wasted_qty колонка | accepted | Schema |
| [0010](0010-web-app-access-mode.md) | Web app access: `ANYONE` (signed-in) + server-side allowlist | superseded by 0013 | Deploy |
| [0011](0011-claude-fallback.md) | Claude Sonnet 4.6 як автоматичний fallback для Gemini | superseded by 0020 | AI |
| [0012](0012-cancellation-discount-grouping.md) | Cancellation/discount pair grouping в UI; `Items.discount_orig` колонка | accepted | UI / Schema |
| [0013](0013-migrate-to-react-supabase.md) | Міграція з Apps Script + Sheets на React + Supabase + Cloudflare Pages | accepted | Migration |
| [0014](0014-cancellations-as-zero-rows.md) | Cancellation-пари як нульові UI-рядки | accepted | Domain |
| [0015](0015-pair-detector-multi-tuple-aggregation.md) | Multi-tuple pair detection та aggregation | accepted | Domain |
| [0016](0016-durable-background-receipt-imports.md) | Стійкий фоновий імпорт великої кількості документів | accepted | Import / Queue |
| [0017](0017-bulk-import-arithmetic-repair.md) | Детермінована арифметика та cross-provider repair у bulk-import | superseded by 0018 | Import / AI |
| [0018](0018-evidence-based-receipt-verification.md) | Доказове розпізнавання та незалежна перевірка чеків | superseded by 0019 | Import / AI / Observability |
| [0019](0019-staged-receipt-verification.md) | Поетапна незалежна перевірка чеків через чергу | superseded by 0020 | Import / AI / Queue |
| [0020](0020-two-model-receipt-verification.md) | Gemini 3.7 Flash і Sonnet 5 без третьої verification-моделі | superseded by 0021 | Import / AI / Queue |
| [0021](0021-physical-row-audit-for-repeated-items.md) | Окремий фізичний аудит повторюваних рядків чека | superseded by 0022 | Import / AI / Queue |
| [0022](0022-printed-article-count-repair.md) | Доказове відновлення повторів за надрукованою кількістю товарів | accepted | Import / AI / Domain |

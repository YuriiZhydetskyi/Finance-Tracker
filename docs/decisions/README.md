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
| [0001](0001-google-sheets-as-storage.md) | Google Sheets як основне сховище | accepted | Storage |
| [0002](0002-apps-script-runtime-and-clasp.md) | Google Apps Script як runtime, clasp + Git як toolchain | accepted | Runtime |
| [0003](0003-gemini-with-provider-abstraction.md) | Gemini Flash для парсингу чеків + тонка AiClient-абстракція | accepted (revised) | AI |
| [0004](0004-multi-currency-eur-base.md) | Multi-currency з EUR як базою; зберігаємо оригінал + EUR + курс | accepted (revised) | Schema |
| [0005](0005-alpine-for-ui-no-build.md) | Alpine.js для реактивності UI; без build-pipeline | accepted | UI |
| [0006](0006-separate-pages-per-mode.md) | Окремі HTML-сторінки на кожен режим (photo / manual / edit) | accepted | UI |
| [0007](0007-products-as-optional-dimension.md) | Products як необов'язковий покажчик; селективний каталог | accepted | Schema |
| [0008](0008-prices-computed-from-items.md) | Reference prices обчислюються з історії Items; без окремої таблиці | accepted | Analytics |
| [0009](0009-notes-columns-and-wasted-qty.md) | Notes як прості колонки; spoilage як wasted_qty колонка | accepted | Schema |
| [0010](0010-web-app-access-mode.md) | Web app access: `ANYONE` (signed-in) + server-side allowlist | accepted (revised) | Deploy |

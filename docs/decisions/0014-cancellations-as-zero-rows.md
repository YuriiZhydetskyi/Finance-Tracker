# ADR-0014: Cancellation pairs як inline-рядки з ціною 0; discount pairs з явним розкладом

- Status: accepted
- Date: 2026-05-08
- Supersedes: [ADR-0012 §C1](0012-cancellation-discount-grouping.md) (default-OFF / opt-in checkbox)

## Context and Problem Statement

ADR-0012 встановив три правила:

- **A3** — pair detection на клієнті в photo flow.
- **B1** — `Items.discount_orig` як структуроване поле.
- **C1** — cancellation pairs за замовчуванням **не зберігаються** (default-OFF); UI показує окрему секцію з checkbox "Включити до чеку".

A3 і B1 виправдали себе на практиці. C1 — ні. Користувач, тестуючи `/photo` на реальних чеках EDEKA, навів дві претензії:

1. **Cancellation pair (касир пробив зайвий раз):** хочеться бачити рядок прямо у списку товарів з лейблом «пробито випадково» і ціною 0, а не окрему amber-секцію зверху з checkbox. Розрив контексту між "є cancellation там вгорі" і "є товари нижче" створює когнітивне навантаження. Видимий рядок з 0-ціною самопояснюваний.

2. **Discount pair (знижка через термін придатності, типово 30% або 50% off):** автоматично згрупований рядок не показує явно «оригінал X / знижка Y / фінал Z». Користувач бачить тільки фінальну суму у footer і має лізти в поле "Знижка", щоб зрозуміти структуру.

Питання: як змінити UX cancellation і discount pairs після pair detection?

## Considered Options

### A. Як показувати cancellation pair?
- A1. Залишити окрему amber-секцію з checkbox, дефолт OFF (status quo, ADR-0012 §C1).
- A2. Залишити секцію, але дефолт ON і змінити лейбли на "Пробито випадково".
- A3. Inline-рядок у списку товарів з ціною 0, бейджем "Пробито випадково · автоматично згруповано", disabled-полями, збереження в БД за замовчуванням.

### B. Як показувати discount pair?
- B1. Тільки поле "Знижка" поряд з іншими полями (status quo).
- B2. Додати explicit footer-блок "Оригінал / Знижка / Фінал" замість одного "Рядок:" для merged-рядків.

### C. Як це передати від pair-detector до UI?
- C1. Окремі масиви: `{ items, cancellations }` (status quo).
- C2. Єдиний масив `items: DetectedItem[]` де кожен item опціонально має `pair_marker: { kind: 'cancelled' | 'discount-merged' }`. Cancellation тепер — звичайний `DetectedItem` з `unit_price_orig=0` і marker. UI читає marker через RHF watch і застосовує візуальне трактування.

## Decision Outcome

### A3 — inline-рядок з ціною 0 і збереженням в БД

Cancellation pair тепер додається в `items[]` як рядок з:
- `unit_price_orig: 0`, `discount_orig: 0`, `qty` як був.
- `note: 'пробито випадково'` (pre-fill, користувач може редагувати).
- `pair_marker: { kind: 'cancelled' }` (UI-only hint, не персиститься).

ItemRow рендерить:
- Amber border + bg.
- Бейдж "⚠ Пробито випадково · автоматично згруповано".
- Disabled-поля для qty/price/discount/wasted_qty.
- Footer "Рядок: 0,00 €".

Користувач може видалити рядок кнопкою "Видалити" якщо не хоче бачити в історії. Збережений рядок з'являється в `/recent` і `/edit/$id` як звичайний 0-ціновий товар з нотаткою (без бейджа — marker не персиститься).

### B2 — явний триблок Оригінал / Знижка / Фінал

ItemRow для `pair_marker.kind === 'discount-merged'` рендерить:
- Emerald border + bg.
- Бейдж "🏷 Знижка · автоматично згруповано".
- Поля редаговані (користувач може скоригувати).
- Footer:
  ```
  Оригінал: qty × unit_price = total_before
  Знижка:                   −discount_total
  Фінал:                     final_total
  ```

### C2 — єдиний масив з опціональним marker

`PairDetectionResult` тепер `{ items: DetectedItem[] }` без `cancellations`. `DetectedItem = ParsedItem & { pair_marker? }`. Це робить downstream-код простішим (один список замість двох) і дозволяє ItemRow вирішувати UX через marker, не знаючи звідки рядок прийшов.

### Threshold детекції — без змін

Зберігаємо логіку ADR-0012:
- |neg| ≈ pos → cancelled marker
- |neg| < pos → discount-merged marker (будь-який %, не тільки 30/50)
- qty mismatch / 3+ дублі / refund > purchase → не групується

30% і 50% — типові кейси користувача, але магічних чисел уникаємо. Будь-який партіальний % обробляється однаково.

## Consequences

### Позитивні
- Користувач бачить ВСЕ що було на чеку в одному списку, без окремої секції зверху.
- Cancellation рядки самопояснювані: 0-ціна + "пробито випадково" в нотатці пояснюють, що це.
- Discount рядки прозорі: явно видно оригінальну ціну і знижку.
- Менше клікаючих елементів (без checkbox-toggle).
- В `/recent` і `/edit` cancellation рядки залишаються видимими — історія чека повна.

### Негативні / обмеження
- 0-цінові рядки потрапляють у БД. У `total_orig`, `total_eur` і Stats не вносять матеріальної шкоди (нулі), але в counts (кількість позицій) вони присутні. Прийнятно — в стат-репортах "куплено N різних позицій" 0-цінові випадкові скасування і так заслуговують бути порахованими ("AI знайшов це на чеку").
- Якщо користувач не хоче бачити 0-рядок в історії — потрібен 1 додатковий клік "Видалити". Симетрично до старого "1 клік щоб включити" — переносимо клік на менш-частий кейс (видалення зайвого rare; залишити видимим common).
- В `/edit/$id` для збереженого cancellation-рядка немає бейджа (marker не зберігається). Користувач бачить просто "Wine — 0,00 €" з нотаткою "пробито випадково". Це консистентно: marker — ефемерний UI-stamp після parse, не persistent state. Edit-flow не реактивує детекцію.
- ADR-0012 §C1 інвертується. Це усвідомлений revisit після реального використання — поведінка default-OFF створювала більше friction ніж очікувалось.

### Що НЕ змінено
- Алгоритм pair-detector (групування, threshold). Тільки форма виходу.
- Schema / migrations. `discount_orig` колонка вже є з ADR-0012 §B1.
- AI prompt / Edge Function. Детекція як і раніше клієнтська.
- /manual і /edit. Pair detection там не запускається.

## Pros and Cons of the Options

### A1 — статус кво (відхилено)
- ❌ Розрив контексту між cancellation-секцією і списком товарів.
- ❌ Default-OFF губить рядки які на чеку точно були.
- ❌ Окрема UX-конструкція з checkbox потребує когнітивного зусилля.

### A2 — секція, але default-ON (відхилено)
- ✅ Менша зміна.
- ❌ Все ще окрема секція. Користувач явно сказав "показувати як товар", а не "показувати в окремій картці".

### A3 — inline-рядок з ціною 0 (обрано)
- ✅ Один список товарів, один UX-патерн.
- ✅ Рядки видимі в історії.
- ✅ ItemRow вже знає про disabled / borders / footer — мінімальна додавання маркера достатньо.
- ❌ 0-рядки в БД (прийнятна ціна).

### B1 — поле "Знижка" поряд (відхилено для merged)
- ✅ Без змін.
- ❌ Не пояснює що рядок auto-merged. Не показує оригінал явно.

### B2 — триблок (обрано)
- ✅ Явність: видно структуру знижки.
- ✅ Поле "Знижка" як було, плюс explicit breakdown — readability win.
- ❌ Більше DOM-елементів у footer (минорно).

### C1 — два масиви (відхилено)
- ✅ Status quo.
- ❌ Downstream-код мусить знати про обидва, мерджити їх на submit. PhotoReviewForm мав місцевий `Set<number>` для toggle.

### C2 — один масив з marker (обрано)
- ✅ Простіше: один list, один render-loop.
- ✅ Marker — UI-hint, не persistent state. Чисте розділення.
- ❌ Refactor існуючих 16 тестів pair-detector (тривіально).

## References
- [ADR-0012](0012-cancellation-discount-grouping.md) — original design (A3+B1+C1; цей ADR замінює тільки C1 + uplevels UX).
- [pair-detector.ts](../../packages/domain/src/pair-detector.ts), [ItemRow.tsx](../../web/src/features/receipts/components/ItemRow.tsx), [PhotoReviewForm.tsx](../../web/src/features/photo/components/PhotoReviewForm.tsx).

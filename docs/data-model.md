# Модель даних

> Цей документ — **єдине джерело істини** про схему. Якщо тут і в коді розбіжність — правда тут. Код треба виправити.

Зберігання — Google Sheet із чотирма листами: `Receipts`, `Items`, `Products`, `Categories`. Чому саме Sheet — див. [ADR-0001](decisions/0001-google-sheets-as-storage.md). Чому Apps Script — [ADR-0002](decisions/0002-apps-script-runtime-and-clasp.md). Курси валют **не зберігаються** в окремому листі — конвертація відбувається на льоту при збереженні чеку (див. ADR-0004).

## Глобальні правила

### Identity (ULID)
Усі первинні ключі — **ULID**, 26 символів, time-sortable, унікальні. Генерується inline в Apps Script (нема нативної бібліотеки). Приклад: `01HM4N6RXX5K2P9F8DZ7QWERTY`.

Чому не auto-increment: Sheets не має такого. Чому не UUID v4: ULID додатково сортується по часу (зручно при дебагу та лістингу).

### Дати і час
- **Дати без часу** (`Receipts.date`) — рядок ISO 8601 без часу: `2026-05-04`.
- **Timestamp-и** (`created_at`, `updated_at`) — рядок ISO 8601 з таймзоною: `2026-05-04T14:30:00+02:00`.
- Таймзона за замовчуванням — `Europe/Berlin`. Виставляється у `appsscript.json` (`timeZone`) і використовується при генерації `created_at`/`updated_at`.
- Дати **завжди як string у Sheet**, не як native Date. Інакше локаль Sheet ламає інтерпретацію.

### Гроші (precision rule)
- Грошові поля — `Number` у Sheet, **округлені до 2 знаків після коми** на write у `Storage.js`.
- Округлення: `Math.round(value * 100) / 100`.
- Дисплейний формат — обов'язок UI / Looker Studio, не сховища.
- Чому не cents-integer: Looker і pivot-таблиці працюють із плаваючою точкою натурально; rounding-on-write усуває drift на рівні I/O. Див. [ADR-0004](decisions/0004-multi-currency-eur-base.md).

### Валюта
- Базова валюта — **EUR**. Усі агрегації в дашбордах — у EUR.
- Підтримуються **EUR (база) + UAH**. Інші валюти — out of scope (можна додати точково в `Fx.getRateLive`, якщо колись з'явиться потреба).
- На Receipt-рівні зберігається **і оригінал, і EUR-нормалізація + курс на момент фіксації** як audit trail. Курс фіксується назавжди — історична правда не переписується.
- ISO 4217 коди (`EUR`, `UAH`).

### FX lookup rule
- Курс отримується **live** з джерела при збереженні чеку — функція `Fx.getRateLive(currency, date)`.
- Для EUR → одразу `1.0` без жодного запиту.
- Для UAH → виклик NBU API на дату чеку. Підтримуються історичні дати (для редагування старих чеків).
- Якщо NBU повертає порожньо (вихідний/свято) → walk-back до 7 днів назад, найближчий доступний курс.
- Результат записується в `Receipt.fx_rate_eur` і ніколи не перераховується. Окремої таблиці курсів немає.

### Джерело курсу
- **NBU (bank.gov.ua)** — `?valcode=EUR&date=YYYYMMDD&json`. Підтримує історичні дати. Це **єдине** зовнішнє джерело курсів у проєкті.

### Snapshot rule (для product_name)
- `Items.product_name` — **snapshot** на момент покупки. Копія назви як її розпізнав AI (або як ввів користувач).
- Якщо `Items.product_id` потім перейменують у `Products` — `product_name` у старих чеках **залишається таким, яким був**. Зберігаємо аудиторський слід.
- Запити "як ми називали цей продукт у різні часи" — через `product_name`, агрегаційні — через `product_id`.

### Hard-delete rule
- Видалення — фізичне (рядок прибирається).
- Backup — Sheet version history (~30 днів) + daily CSV backup у Drive (Phase 5).
- Soft-delete не використовуємо: ускладнює всі запити, цінність аудиту нижча за просту схему.

### Lock rule (concurrent writes)
- Усі операції, що пишуть **більше одного рядка** (наприклад, INSERT receipt + N items) — обгорнуті в `LockService.getScriptLock().tryLock(30000)`.
- Лок звільняється у `finally`-блоку.
- Це захищає від гонок, коли двоє людей одночасно зберігають чеки.
- **Чому ScriptLock, а не DocumentLock:** `getDocumentLock()` повертає `null` для standalone скриптів (як наш). DocumentLock працює лише для container-bound скриптів. ScriptLock дає той самий project-wide контракт серіалізації.

### Schema evolution rule
Під час MVP (Phase 0–5):
- **Додавати** колонки можна — тільки в **кінець** листа.
- **Не переставляти** колонки.
- **Не видаляти** колонки (replace значенням `null` якщо вмикаємо deprecation).
- **Не перейменовувати** колонки (додаємо нову, копіюємо дані з лагом).

Storage-код спирається на імена колонок, не на позицію — щоб додавання колонок не ламало існуючий код.

---

## Лист `Receipts`

Один рядок = один чек / одна онлайн-витрата.

| # | Колонка | Тип | Формат / правила | Nullable | Приклад |
|---|---|---|---|---|---|
| 1 | `id` | string (ULID) | 26 символів | ні | `01HM4N6RXX5K2P9F8DZ7QWERTY` |
| 2 | `date` | string | `YYYY-MM-DD` | ні | `2026-05-04` |
| 3 | `store` | string | вільний текст; нормалізація через `Config.STORE_ALIASES` рекомендована | ні | `ALDI Süd` |
| 4 | `currency` | string | ISO 4217 | ні | `EUR` |
| 5 | `total_orig` | number | float, 2dp, у валюті чеку | ні | `34.78` |
| 6 | `fx_rate_eur` | number | курс currency→EUR на дату чеку, 6dp | ні | `1.000000` (для EUR) / `0.024500` (для UAH) |
| 7 | `total_eur` | number | float, 2dp, нормалізований total | ні | `34.78` |
| 8 | `paid_by` | string (email) | gmail-адреса | ні | `yurii@example.com` |
| 9 | `photo_url` | string (URL) | посилання на файл у Drive (Phase 1+) | так | `https://drive.google.com/file/d/.../view` |
| 10 | `source` | enum | `photo` \| `manual` \| `edit` | ні | `photo` |
| 11 | `raw_ocr_json` | string (JSON) | компактний JSON масиву items, як повернув AI; **обмежено 45 000 символів** | так | `[{"name":"Pesto Barilla 190g","price":3.49}]` |
| 12 | `note` | string | вільна нотатка користувача | так | `Закупка для вечірки` |
| 13 | `created_at` | string | ISO 8601 з таймзоною | ні | `2026-05-04T14:30:00+02:00` |
| 14 | `updated_at` | string | ISO 8601 з таймзоною; оновлюється на UPDATE | ні | `2026-05-04T14:35:12+02:00` |

**Правила:**
- `total_eur = round(total_orig * fx_rate_eur, 2)` — обчислюється на write.
- `fx_rate_eur` для EUR-чеку = `1.000000` (явно записуємо, не пропускаємо).
- `raw_ocr_json` зберігає **тільки items array**, не повну Gemini-відповідь — щоб не впертись у 50 000-символьний ліміт клітинки. Для photo-режиму. Для manual і edit — `null`.

---

## Лист `Items`

Один рядок = один товар у чеку.

| # | Колонка | Тип | Формат / правила | Nullable | Приклад |
|---|---|---|---|---|---|
| 1 | `id` | string (ULID) | | ні | `01HM4N6RZZ7K2P9F8DZ7QWERAA` |
| 2 | `receipt_id` | string (ULID) | FK → `Receipts.id` | ні | `01HM4N6RXX5K2P9F8DZ7QWERTY` |
| 3 | `product_id` | string (ULID) | FK → `Products.id`; **nullable** для commodity / one-off | так | `01HM4N6RPP3K2P9F8DZ7QWERTZ` |
| 4 | `product_name` | string | snapshot назви на момент покупки | ні | `Pesto Barilla Genovese 190g` |
| 5 | `category` | string | FK → `Categories.name` | ні | `Бакалія` |
| 6 | `qty` | number | float, 3dp, кількість одиниць | ні | `2.000` (2 шт.) / `0.350` (350 г) |
| 7 | `unit_price_orig` | number | float, 2dp, у валюті чеку. **Може бути від'ємним** (знижка, Pfand-refund, скасування) | ні | `3.49` / `-2.99` |
| 8 | `total_orig` | number | `round(qty * unit_price_orig, 2)` у валюті чеку. Знак успадковується від `unit_price_orig` | ні | `6.98` / `-2.99` |
| 9 | `total_eur` | number | `round(total_orig * receipt.fx_rate_eur, 2)` | ні | `6.98` / `-2.99` |
| 10 | `consumed_by` | enum | `his` \| `hers` \| `shared` \| `custom:HIS%/HERS%` | ні | `shared` / `custom:30/70` |
| 11 | `note` | string | вільна нотатка | так | `Купили на знижці -50%` |
| 12 | `wasted_qty` | number | float, 3dp; default `0`; ≤ `qty`; одиниці зіпсувалось | ні | `0.000` |
| 13 | `discount_orig` | number | float, 2dp; default `0`; ≥ 0; ≤ `unit_price_orig`. Знижка на одиницю товару у валюті чеку (Rabatt-pair-merge або ручне введення) | ні | `0.00` / `1.00` |
| 14 | `created_at` | string | ISO 8601 | ні | `2026-05-04T14:30:00+02:00` |
| 15 | `updated_at` | string | ISO 8601 | ні | `2026-05-04T14:35:12+02:00` |

**Правила:**
- `total_orig = round(qty * (unit_price_orig - discount_orig), 2)` — інваріант, перевіряється у `Domain.js`. Коли `discount_orig = 0`, формула рівноцінна `qty * unit_price_orig` (старий інваріант).
- `total_eur` денормалізовано (зберігається копія) — для аналітики без джойнів. Див. [ADR-0008](decisions/0008-prices-computed-from-items.md).
- **Negative line items.** `unit_price_orig` (і відповідно `total_orig` / `total_eur`) може бути від'ємним. Три типові причини на німецьких чеках: касир пробив товар двічі і відмінив (cancellation pair), знижка / акція / markdown через термін придатності (Rabatt), повернення тари (Leergut/Pfand refund). `qty` лишається додатнім (≥ 1) — змінюється тільки знак ціни. Receipt's `total_orig` = сума всіх item totals: позитивні і негативні нетятся природно. Gemini промпт ([src/Gemini.js](../src/Gemini.js)) інструктує модель видавати такі рядки окремими items, а не зливати з positive-counterpart-ом.
- **Pair grouping**: коли AI повертає Rabatt-пару (`+X` повний товар + `−Y` знижка з тим самим product_name), photo.html UI зливає їх у один Item з `unit_price_orig=X` і `discount_orig=Y` перед збереженням ([ADR-0012](decisions/0012-cancellation-discount-grouping.md)). При full cancellation (`+X` і `−X`) — за замовчуванням обидва не зберігаються (користувач може override). Items, що потрапляють у Sheet після цього, мають додатній або нульовий `unit_price_orig` (за винятком окремих Pfand/Leergut рядків, що не мають позитивного counterpart-у).
- `consumed_by`:
  - `his` / `hers` — повністю одного.
  - `shared` — 50/50.
  - `custom:30/70` — `30%` його / `70%` її. Парсер у `Domain.js`.
- `wasted_qty`:
  - Завжди ≤ `qty`.
  - Default `0`.
  - `wasted_value_eur = (wasted_qty / qty) * total_eur` — обчислюється в Looker, не зберігається.
- Якщо `product_id = null` — Item все одно валідний; просто не бере участі в product-level аналітиці. Див. [ADR-0007](decisions/0007-products-as-optional-dimension.md).

---

## Лист `Products`

Один рядок = один **канонічний** товар (бренд + розмір/обсяг). Каталог **селективний** — тільки те, що варто трекати.

| # | Колонка | Тип | Формат / правила | Nullable | Приклад |
|---|---|---|---|---|---|
| 1 | `id` | string (ULID) | | ні | `01HM4N6RPP3K2P9F8DZ7QWERTZ` |
| 2 | `name` | string | канонічна форма | ні | `Pesto Barilla Genovese 190g` |
| 3 | `category` | string | FK → `Categories.name` | ні | `Бакалія` |
| 4 | `unit` | string | `pcs` \| `g` \| `kg` \| `ml` \| `l` | так | `g` |
| 5 | `unit_size` | number | розмір однієї одиниці у `unit` | так | `190` |
| 6 | `notes` | string | довгострокові нотатки про продукт | так | `Улюблений бренд` |
| 7 | `created_at` | string | ISO 8601 | ні | |
| 8 | `updated_at` | string | ISO 8601 | ні | |

**Правила:**
- `name` має бути унікальним (мʼяко, перевіряється у Storage перед INSERT).
- При перейменуванні `name` — `Items.product_name` не оновлюється (snapshot rule).

---

## Лист `Categories`

Один рядок = одна категорія.

| # | Колонка | Тип | Формат / правила | Nullable | Приклад |
|---|---|---|---|---|---|
| 1 | `name` | string | унікальне; primary key | ні | `Молочка` |
| 2 | `group` | string | для дашборду | ні | `Продукти` |

**Початковий seed (20 категорій):**

| Group | Categories |
|---|---|
| Продукти | Молочка, М'ясо/риба, Овочі/фрукти, Бакалія, Солодке, Алкоголь |
| Побут | Хімія/гігієна, Аптека, Одяг, Електроніка |
| Житло | Оренда житла, Комуналка |
| Транспорт | Авто, Транспорт |
| Розваги | Кафе/ресторани, Розваги |
| Сервіси | Курси/освіта, Підписки, Послуги |
| Інше | Інше |

Розширюється через додавання рядків (див. [extending.md](../docs/extending.md)).

---

## In-memory типи (НЕ зберігаються в Sheet)

### `ParsedReceipt` / `ParsedItem`

Це **transit shape** між AI-парсером і UI — повертається з `AiClient.parseReceipt(imageBytes, ctx)`. Жодне з цих полів не зберігається в Sheet напряму; UI відображає, користувач редагує, потім будуються справжні `Receipt`/`Item` через `Domain.makeReceipt` / `Domain.makeItem`.

**`ParsedReceipt`:**
| Поле | Тип | Nullable | Примітка |
|---|---|---|---|
| `store` | string | так | best-effort merchant name |
| `date` | string `YYYY-MM-DD` | так | `null` якщо AI не зчитав |
| `currency` | string ISO 4217 | ні | default `'EUR'` |
| `total_orig` | number | так | sanity check проти sum(items) |
| `items` | `ParsedItem[]` | ні | може бути `[]` |

**`ParsedItem`:**
| Поле | Тип | Nullable | Примітка |
|---|---|---|---|
| `product_name` | string | ні | verbatim з чека (мова як у чеку) |
| `qty` | number | ні | > 0 |
| `unit_price_orig` | number | ні | у валюті чеку |
| `category_suggestion` | string | так | one of `Categories.name` або `null` |
| `discount_orig` | number | так | заповнюється UI-шаром після pair-grouping ([ADR-0012](decisions/0012-cancellation-discount-grouping.md)); AI завжди повертає `0`/`undefined` |

Валідація: `Domain.validateParsedReceipt` — soft validator (дозволяє null store/date/total). Гарантує тільки ISO-4217 currency і числові обов'язкові поля для items.

Product matching до існуючих `Products.id` — **не** робить AI; це UI-side логіка у Phase 3.

---

## Зведена діаграма зв'язків

```
Receipts (1) ────< Items (N)
                     │
                     ├──> Products (0..1)   product_id nullable
                     └──> Categories (1)    category required

NBU API (live) ── викликається при INSERT/UPDATE UAH-Receipt для fx_rate_eur
```

---

## Ще не в схемі (out of MVP)

Документуємо, щоб не забути обговорити при додаванні:

- `Settlements` (хто кому винен) — out of scope.
- `Spoilage` як окрема таблиця (поточно `wasted_qty` колонка) — додати лише при потребі багатоетапного списання.
- `ProductPrices` як матеріалізований кеш — додати лише при проблемах з продуктивністю аналітики.
- `Errors` лист — для логування помилок API/UI (Phase 5).
- Підтримка інших валют (USD, PLN, ...) — точкове розширення `Fx.getRateLive` при появі першого реального чеку в такій валюті.

# Модель даних

> Цей документ — **єдине джерело істини** про схему. Якщо тут і в коді розбіжність — правда тут. Код треба виправити.
>
> Канонічні DDL — у [supabase/migrations/](../supabase/migrations/). Згенеровані TS-типи — у [web/src/shared/types/database.types.ts](../web/src/shared/types/database.types.ts) (regenerate через `npx supabase gen types typescript --linked`). Zod-схеми (in-app валідація + factories) — у [packages/domain/src/schemas.ts](../packages/domain/src/schemas.ts).

## Фонові імпорти

Міграція `20260831054319_background_receipt_imports.sql` додає:

- `receipts.photo_path` — постійний Storage path поряд із тимчасовим `photo_url`;
- `receipt_import_batches` — платник і загальний persisted статус batch;
- `receipt_import_files` — hash, Storage path, attempt/status, AI result, exception та зв’язок зі
  створеним або можливим duplicate receipt;
- PGMQ queue `receipt_imports`, browser RPC та service-role-only worker RPC.

Статус файлу рухається `uploading → queued → processing → saved`; ручної уваги потребують
`needs_review`, `duplicate` та `upload_failed`. Exact file duplicate визначається SHA-256 до
upload; можливий semantic duplicate — за store/date/currency/total і близьким time перед insert.
RLS дає allowlisted користувачам тільки `select`; мутації браузера проходять через вузькі RPC,
worker RPC відкриті лише ролі `service_role`.

Зберігання — Postgres у Supabase project `<your-project-ref>`. 4 основні таблиці (`receipts`, `items`, `products`, `categories`) + `app_users` (allowlist) + `pending_parses` (черга невдалих парсингів) + `statement_transactions` (орфанні транзакції виписки) + `store_aliases` (вивчені пари назв для звірки) + 4 read-only view-и `v_stats_by_*` для дашборду + 1 Storage bucket `receipts` для фото.

Чому Postgres + Supabase замість Sheets — див. [ADR-0013](decisions/0013-migrate-to-react-supabase.md). Курси валют **не зберігаються** в окремій таблиці — конвертація відбувається on-the-fly при збереженні чеку через NBU API; курс фіксується назавжди на самому Receipt-рядку як audit trail (ADR-0004).

## Глобальні правила

### Identity (ULID)

Усі первинні ключі — **ULID**, 26 символів, time-sortable, унікальні. Генерується клієнт-side у [`packages/domain/src/ulid.ts`](../packages/domain/src/ulid.ts) (Crockford Base32). Приклад: `01HM4N6RXX5K2P9F8DZ7QWERTY`.

Чому ULID а не Postgres `uuid`/`bigserial`:

- Time-sortable — зручно при дебагу і лістингу.
- Client-generated — ID відомий до insert (потрібно для photo upload path: `{email}/{yyyy}/{mm}/{ulid}.jpg` записується з ULID до того, як receipt-row існує).
- ULID-формат регексом валідується: `^[0-9A-HJKMNP-TV-Z]{26}$`.

### Дати і час

- **Дати без часу** (`receipts.date`) — Postgres `date` тип; на JS-стороні рядок ISO 8601 без часу: `2026-05-04`.
- **Timestamps** (`created_at`, `updated_at`) — Postgres `timestamptz`; default `now()`. На JS-стороні рядок ISO 8601 з offset.
- Frontend timezone — `Europe/Berlin` (через `todayIso()` хелпер у `packages/domain/src/time.ts`). Postgres зберігає у UTC, конвертація — на клієнті.

### Гроші (precision rule)

- Грошові колонки — `numeric(12, 2)` у Postgres.
- Округлення відбувається **на write** у `Domain.makeReceipt` / `makeItem` / `applyReceiptPatch` через `roundMoney(value)` ([`packages/domain/src/money.ts`](../packages/domain/src/money.ts)). Storage / API не округлюють.
- Display формат — обов'язок UI ([`web/src/shared/utils/format-money.ts`](../web/src/shared/utils/format-money.ts) через `Intl.NumberFormat`).
- Чому `numeric` а не `bigint cents`: PostgreSQL native, експорт у CSV/JSON природний, агрегація працює з SUM/AVG без shift'ів.

### Кількість

- `numeric(10, 3)` у Postgres.
- Округлення — `roundQty(value)` (3dp). Дозволяє `0.350 kg`, `1.500 шт.`.

### FX rate

- `numeric(14, 6)` у Postgres з `check (fx_rate_eur > 0)`.
- Округлення — `roundFxRate(value)` (6dp).

### Валюта

- Базова валюта — **EUR**. Усі агрегації у `v_stats_*` — у EUR.
- Підтримуються **EUR (база) + UAH**. Інші валюти — out of scope; додаються точково у `nbu-fx-rate-provider.ts` (див. [extending.md](extending.md) рецепт "Додати валюту").
- На Receipt-рівні зберігається **і оригінал, і EUR-нормалізація + курс на момент фіксації** як audit trail. Курс фіксується назавжди — історична правда не переписується.
- ISO 4217 коди (`EUR`, `UAH`). Postgres check: `currency ~ '^[A-Z]{3}$'`.

### FX lookup rule

- Курс отримується **live** з джерела при збереженні / редагуванні чеку — функція `fxRateProvider.getRateLive(currency, date)`.
- Для EUR → одразу `1.0` без жодного запиту.
- Для UAH → виклик NBU API на дату чеку. Підтримуються історичні дати.
- Якщо NBU повертає порожньо (вихідний/свято) → walk-back до 7 днів назад.
- На update-mutation: курс **переробляється тільки якщо змінилися `currency` або `date`**. Інакше зберігається оригінальний `fx_rate_eur` для аудиту.

### Джерело курсу

- **NBU (bank.gov.ua)** — `?valcode=EUR&date=YYYYMMDD&json`. Підтримує історичні дати. Public, CORS-open, без ключа. Викликається напряму з браузера.
- Drift fixture — `web/src/shared/lib/fx-rate/__fixtures__/nbu-uah-sample.json`. Pin response shape; якщо NBU змінить формат — тест почервоніє першим.

### Snapshot rule (для product_name)

- `items.product_name` — **snapshot** на момент покупки. Копія назви як її розпізнав AI (або як ввів користувач).
- Якщо `products.name` потім перейменують — `items.product_name` у старих чеках **залишається таким, яким був**. Audit trail.
- Запити "як ми називали цей продукт у різні часи" — через `product_name`, агрегаційні — через `product_id`.

### Hard-delete rule

- Видалення — фізичне (`DELETE FROM receipts WHERE id = ?`).
- FK на `items` має `ON DELETE CASCADE` — items видаляються автоматично.
- Backup — Supabase point-in-time recovery (платний tier) АБО periodic CSV export (Phase 12, deferred).
- Soft-delete не використовуємо: ускладнює всі запити, цінність аудиту нижча за просту схему.
- Photo з Storage **не** видаляється автоматично при delete-receipt (orphan blob у bucket). Periodic Storage sweep — Phase 12.

### Row-Level Security (RLS) rule

Усі чотири основні таблиці + `app_users` + `storage.objects` для bucket `receipts` мають RLS enabled. Допустима роль:

```sql
create function public.is_allowed_user() returns boolean
language sql stable security definer
as $$ select exists (select 1 from public.app_users where email = (auth.jwt() ->> 'email')) $$;
```

Policies:

- `receipts`, `items`, `products`, `pending_parses`, `statement_transactions`, `store_aliases` — full read+write для allowlisted users.
- `categories` — read-only для allowlisted users; mutate тільки через Studio SQL editor.
- `app_users` — self-read (`email = auth.jwt() ->> 'email'`); mutate тільки через Studio.
- `storage.objects` для bucket_id `receipts` — full read+write для allowlisted users.
- `v_stats_*` views — `security_invoker = on`, RLS успадковується з базових таблиць.

**Важливо:** anon key (у browser bundle) сам по собі дає лише роль `anon` — RLS блокує все. Авторизація бере силу тільки після magic-link sign-in (JWT з `email`). Service_role key обходить RLS повністю; **ніколи не у frontend**, тільки у Edge Function secrets.

### Schema evolution rule

- Кожна зміна = нова міграція у `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`. Forward-only.
- **Не редагувати** committed міграції.
- **Не перейменовувати** колонку у одному кроці. Дві міграції: add new column with default → update reads/writes → drop old.
- **Не видаляти** колонку поки існують insert/select посилання у код-базі. Спершу очисти код, потім drop.
- `ON DELETE CASCADE`/`SET NULL` визначається у міграції створення FK — зміна потім вимагає `alter table … drop constraint … add constraint …`.
- Після кожної міграції регенерувати TS-типи: `npx supabase gen types typescript --linked > web/src/shared/types/database.types.ts` (через UTF-8 helper на Windows; див. [deploy.md](deploy.md)).
- Не використовувати `npx supabase db reset` проти live проекту — це wipe.

---

## Таблиця `receipts`

Один рядок = один чек / одна онлайн-витрата.

```sql
create table public.receipts (
  id            text primary key,            -- ULID 26 chars
  date          date not null,
  store         text not null,
  currency      text not null check (currency ~ '^[A-Z]{3}$'),
  total_orig    numeric(12, 2) not null,
  fx_rate_eur   numeric(14, 6) not null check (fx_rate_eur > 0),
  total_eur     numeric(12, 2) not null,
  paid_by       text not null check (paid_by like '%@%'),
  photo_url     text,
  source        public.receipt_source not null,    -- enum: 'photo' | 'manual' | 'edit' | 'manual-json' | 'statement'
  raw_ocr_json  text check (raw_ocr_json is null or length(raw_ocr_json) <= 45000),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

| Колонка        | Тип           | Nullable | Правила                                                                                                                                                                                                                                                                        | Приклад                                                                                |
| -------------- | ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `id`           | text (ULID)   | ні       | 26 символів                                                                                                                                                                                                                                                                    | `01HM4N6RXX5K2P9F8DZ7QWERTY`                                                           |
| `date`         | date          | ні       | ISO 8601 yyyy-mm-dd                                                                                                                                                                                                                                                            | `2026-05-04`                                                                           |
| `store`        | text          | ні       | вільний текст; рекомендована soft-нормалізація на UI                                                                                                                                                                                                                           | `ALDI Süd`                                                                             |
| `currency`     | text          | ні       | ISO 4217                                                                                                                                                                                                                                                                       | `EUR` / `UAH`                                                                          |
| `total_orig`   | numeric(12,2) | ні       | у валюті чеку, 2dp                                                                                                                                                                                                                                                             | `34.78`                                                                                |
| `fx_rate_eur`  | numeric(14,6) | ні       | курс currency→EUR на дату чеку, 6dp; > 0                                                                                                                                                                                                                                       | `1.000000` (EUR) / `0.024500` (UAH)                                                    |
| `total_eur`    | numeric(12,2) | ні       | `round(total_orig * fx_rate_eur, 2)`                                                                                                                                                                                                                                           | `34.78`                                                                                |
| `paid_by`      | text (email)  | ні       | гілд-перевірка `like '%@%'`                                                                                                                                                                                                                                                    | `you@example.com`                                                                      |
| `photo_url`    | text          | так      | signed URL з Storage; TTL 1 година (re-sign on display)                                                                                                                                                                                                                        | `https://<your-project-ref>.supabase.co/storage/v1/object/sign/receipts/...?token=...` |
| `source`       | enum          | ні       | `'photo' \| 'manual' \| 'edit' \| 'manual-json' \| 'statement'` (`manual-json` — користувач сам прогнав prompt у external AI tool і вставив JSON через діалог "Paste AI JSON" на `/photo`; `statement` — чек-заглушка з орфанної транзакції виписки, одна позиція без деталей) | `photo`                                                                                |
| `raw_ocr_json` | text          | так      | JSON-stringify ParsedReceipt; **обмежено 45,000 chars**; null коли source=manual або занадто великий (для source=photo та source=manual-json — збережено)                                                                                                                      | `{"store":"Lidl","items":[...]}`                                                       |
| `note`         | text          | так      | вільна нотатка                                                                                                                                                                                                                                                                 | `Закупка для вечірки`                                                                  |
| `created_at`   | timestamptz   | ні       | default `now()`                                                                                                                                                                                                                                                                | `2026-05-04T14:30:00+02:00`                                                            |
| `updated_at`   | timestamptz   | ні       | trigger `set_updated_at()` оновлює на UPDATE                                                                                                                                                                                                                                   |                                                                                        |

**Інваріанти:**

- `total_eur = round(total_orig * fx_rate_eur, 2)` — обчислюється у `makeReceipt` factory.
- `fx_rate_eur` для EUR-чеку = `1.000000` (явно записуємо).
- `raw_ocr_json` зберігається тільки для `source='photo'`; для інших — `null`.
- `photo_url` зберігає **signed URL**, не path. Re-sign — через `photoStorage.getSignedUrl(path)`; path можна екстрактнути з URL regex-ом, або (опційно у майбутньому) додати `photo_path` колонку.

**Індекси:**

- `idx_receipts_date` (date desc)
- `idx_receipts_paid_by_date` (paid_by, date desc)

---

## Таблиця `items`

Один рядок = один товар у чеку.

```sql
create table public.items (
  id              text primary key,
  receipt_id      text not null references public.receipts(id) on delete cascade,
  product_id      text references public.products(id) on delete set null,
  product_name    text not null,
  category        text not null references public.categories(name) on update cascade,
  qty             numeric(10, 3) not null check (qty > 0),
  unit_price_orig numeric(12, 2) not null,
  total_orig      numeric(12, 2) not null,
  total_eur       numeric(12, 2) not null,
  consumed_by     text not null check (
    consumed_by in ('his', 'hers', 'shared')
    or consumed_by ~ '^custom:\d+/\d+$'
  ),
  note            text,
  wasted_qty      numeric(10, 3) not null default 0
                  check (wasted_qty >= 0 and wasted_qty <= qty),
  wasted_at       timestamptz,
  discount_orig   numeric(12, 2) not null default 0
                  check (discount_orig >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

| Колонка           | Тип           | Nullable       | Правила                                                                     | Приклад                       |
| ----------------- | ------------- | -------------- | --------------------------------------------------------------------------- | ----------------------------- |
| `id`              | text (ULID)   | ні             |                                                                             | `01HM4N6RZZ7K2P9F8DZ7QWERAA`  |
| `receipt_id`      | text (ULID)   | ні             | FK → `receipts.id`, CASCADE on delete                                       |                               |
| `product_id`      | text (ULID)   | так            | FK → `products.id`, SET NULL on delete                                      |                               |
| `product_name`    | text          | ні             | snapshot на момент покупки (ADR snapshot rule)                              | `Pesto Barilla Genovese 190g` |
| `category`        | text          | ні             | FK → `categories.name`, CASCADE on update                                   | `Бакалія`                     |
| `qty`             | numeric(10,3) | ні             | > 0                                                                         | `2.000` / `0.350`             |
| `unit_price_orig` | numeric(12,2) | ні             | у валюті чеку. **Може бути від'ємним** (cancellation, Pfand-refund, Rabatt) | `3.49` / `-2.99`              |
| `total_orig`      | numeric(12,2) | ні             | `round(qty * (unit_price_orig - discount_orig), 2)`                         | `6.98` / `-2.99`              |
| `total_eur`       | numeric(12,2) | ні             | `round(total_orig * receipt.fx_rate_eur, 2)`                                | `6.98`                        |
| `consumed_by`     | text          | ні             | `'his' \| 'hers' \| 'shared' \| 'custom:N/M'`                               | `shared` / `custom:30/70`     |
| `note`            | text          | так            |                                                                             | `Купили на знижці -50%`       |
| `wasted_qty`      | numeric(10,3) | ні (default 0) | ≤ `qty`                                                                     | `0.000`                       |
| `wasted_at`       | timestamptz   | так            | non-null iff `wasted_qty > 0` (Zod-level); перезаписується на останню дату  | `2026-05-18T12:00:00Z`        |
| `discount_orig`   | numeric(12,2) | ні (default 0) | ≥ 0; ≤ `unit_price_orig` коли positive                                      | `0.00` / `1.00`               |
| `created_at`      | timestamptz   | ні             | default `now()`                                                             |                               |
| `updated_at`      | timestamptz   | ні             | trigger                                                                     |                               |

**Інваріанти:**

- `total_orig = round(qty * (unit_price_orig - discount_orig), 2)` — перевіряється у `makeItem` factory.
- `total_eur = round(total_orig * receipt.fx_rate_eur, 2)` — денормалізовано (зберігається копія) для аналітики без джойнів.
- `wasted_qty <= qty` — Postgres check + Zod superRefine.
- `wasted_at` non-null iff `wasted_qty > 0` — Zod superRefine only (Postgres колонка просто nullable; інваріант підтримується на write-боці у `makeItem` factory + `useUpdateItemWasteMutation`). При `wasted_qty=0` `wasted_at` стає `null`; при `wasted_qty>0` — `now()` (перезапис при кожному оновленні).
- `discount_orig <= unit_price_orig` коли `unit_price_orig > 0` — Zod superRefine (Postgres check тільки `>= 0`).
- **Negative line items.** `unit_price_orig` (і `total_orig` / `total_eur`) може бути від'ємним. Три типові причини на німецьких чеках: cancellation pair, discount/Rabatt, Pfand/Leergut refund. `qty` лишається додатнім (≥ 1) — змінюється тільки знак ціни. Receipt's `total_orig` природно нетятиме.
- **Pair grouping** (тільки на photo flow): коли AI повертає Rabatt-пару (`+X` + `−Y` з тим самим product_name), `detectPairs` ([packages/domain/src/pair-detector.ts](../packages/domain/src/pair-detector.ts)) зливає їх у один Item з `unit_price_orig=X` і `discount_orig=Y` перед review-formою. Cancellation pair (`+X` + `−X`) — за замовчуванням не зберігається; user може override через checkbox у `<CancellationCard>`. Див. [ADR-0012](decisions/0012-cancellation-discount-grouping.md).
- **`consumed_by` parse:** `'his'` / `'hers'` — повністю одного. `'shared'` — 50/50. `'custom:30/70'` — 30% його / 70% її. Парсер у [`packages/domain/src/consumed-by.ts`](../packages/domain/src/consumed-by.ts).
- **`wasted_value_eur = (wasted_qty / qty) * total_eur`** — обчислюється у `/stats` chart, не зберігається.

**Індекси:**

- `idx_items_receipt_id` (receipt_id)
- `idx_items_category` (category)
- `idx_items_product_id` (product_id) WHERE product_id IS NOT NULL

---

## Таблиця `products`

Один рядок = один **канонічний** товар (бренд + розмір/обсяг). Каталог **селективний** — тільки те, що варто трекати.

```sql
create table public.products (
  id          text primary key,
  name        text not null unique,
  category    text not null references public.categories(name) on update cascade,
  unit        public.product_unit,             -- enum: 'pcs' | 'g' | 'kg' | 'ml' | 'l'
  unit_size   numeric(10, 3),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

| Колонка     | Тип           | Nullable    | Приклад                       |
| ----------- | ------------- | ----------- | ----------------------------- |
| `id`        | text (ULID)   | ні          | `01HM4N6RPP3K2P9F8DZ7QWERTZ`  |
| `name`      | text          | ні (UNIQUE) | `Pesto Barilla Genovese 190g` |
| `category`  | text (FK)     | ні          | `Бакалія`                     |
| `unit`      | enum          | так         | `g`                           |
| `unit_size` | numeric(10,3) | так         | `190.000`                     |
| `notes`     | text          | так         | `Улюблений бренд`             |

**Правила:**

- `name` UNIQUE на DB-level (Postgres ловить дублі при INSERT).
- При перейменуванні `name` — `items.product_name` НЕ оновлюється (snapshot rule).

---

## Таблиця `categories`

Один рядок = одна категорія. Read-only через RLS — mutate тільки через Studio SQL editor.

```sql
create table public.categories (
  name        text primary key,
  group_name  text not null
);
```

| #   | Колонка      | Тип       | Приклад    |
| --- | ------------ | --------- | ---------- |
| 1   | `name`       | text (PK) | `Молочка`  |
| 2   | `group_name` | text      | `Продукти` |

> Чому `group_name` а не `group`: `group` — reserved word у SQL. Renamed для simplicity.

**Початковий seed (20 категорій):**

| Group     | Categories                                                    |
| --------- | ------------------------------------------------------------- |
| Продукти  | Молочка, М'ясо/риба, Овочі/фрукти, Бакалія, Солодке, Алкоголь |
| Побут     | Хімія/гігієна, Аптека, Одяг, Електроніка                      |
| Житло     | Оренда житла, Комуналка                                       |
| Транспорт | Авто, Транспорт                                               |
| Розваги   | Кафе/ресторани, Розваги                                       |
| Сервіси   | Курси/освіта, Підписки, Послуги                               |
| Інше      | Інше                                                          |

Розширюється через додавання рядків (див. [extending.md](extending.md) "Додати категорію").

> **Корисно для німецьких чеків:** додати категорію `name='Pfand'`, `group_name='Побут'` (або `'Інше'`) — Gemini промпт автоматично присвоюватиме її depositним рядкам ("Pfand", "Leergut Entl.allg.", "Leergut Einw.allg."). Без цієї категорії `category_suggestion` буде `null` і user мусить вибирати вручну на review-екрані.

---

## Таблиця `app_users`

Email-allowlist gating для всіх RLS policies.

```sql
create table public.app_users (
  email text primary key
);
```

| Колонка | Тип       | Приклад           |
| ------- | --------- | ----------------- |
| `email` | text (PK) | `you@example.com` |

**Правила:**

- Mutate тільки через Studio SQL editor:
  ```sql
  insert into public.app_users (email) values ('user@example.com');
  delete from public.app_users where email = 'user@example.com';
  ```
- RLS policy `self_read_app_users` дозволяє користувачу читати ТІЛЬКИ свій рядок (для allowlist-перевірки у frontend через `useAllowlistCheck`).
- Без `app_users`-row — `is_allowed_user()` повертає `false` → RLS блокує все.

---

## Таблиця `pending_parses`

Персистентна **черга невдалих парсингів**. Один рядок = одне фото чеку, яке AI не зміг розпізнати і яке чекає повторної спроби. Окрема таблиця (а не прапорець на `receipts`), бо впалий парсинг не має ні `total_orig`, ні `items`, ні курсу — це засмітило б `receipts` і stats-в'юхи. Наявність рядка = «чекає»; колонки `status` немає.

Міграція: [`supabase/migrations/20260604000001_add_pending_parses.sql`](../supabase/migrations/20260604000001_add_pending_parses.sql).

```sql
create table public.pending_parses (
  id                text primary key,            -- ULID
  photo_path        text not null,               -- Storage path, НЕ signed URL
  paid_by           text not null check (paid_by like '%@%'),
  error_message     text,
  attempts          integer not null default 0,
  original_filename text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
```

| Колонка             | Тип         | Nullable       | Правила / Примітка                                                              |
| ------------------- | ----------- | -------------- | ------------------------------------------------------------------------------- |
| `id`                | text (ULID) | ні             | client-generated                                                                |
| `photo_path`        | text        | ні             | Storage path `{email}/{yyyy}/{mm}/{ulid}.{ext}` — re-sign on demand, **не** URL |
| `paid_by`           | text(email) | ні             | хто оплатив — зафіксовано при завантаженні (per-photo), `like '%@%'`            |
| `error_message`     | text        | так            | serialized `ErrorDetail` останньої спроби (для показу на `/pending`)            |
| `attempts`          | integer     | ні (default 0) | скільки разів парсинг падав                                                     |
| `original_filename` | text        | так            | для відображення у списку                                                       |
| `created_at`        | timestamptz | ні             | default `now()`                                                                 |
| `updated_at`        | timestamptz | ні             | trigger `set_updated_at()`                                                      |

**RLS:** `enable row level security` + одна policy `allowlist_all_pending_parses` (full read+write для allowlisted users, gated через `is_allowed_user()`). Індекс `idx_pending_parses_created_at` (created_at desc).

**Lifecycle фото (важливо — щоб не плодити orphan-blob-и):**

- Парсинг впав і вичерпано retry → фото заливається в Storage (раніше воно ніколи не заливалось на впалих) + створюється рядок із `photo_path` і `paid_by`. Логіка у [`useCreatePendingParseMutation`](../web/src/features/pending-parses/api/use-create-pending-parse-mutation.ts), тригер — у [`use-batch-parser.ts`](../web/src/features/photo/batch/use-batch-parser.ts) (auto-persist коли `attempts >= MAX_RETRY_ATTEMPTS`).
- Re-parse + збереження чеку → receipt **переюзовує те саме фото** (re-sign наявного `photo_path`, без повторної заливки — [`useSavePendingReceiptMutation`](../web/src/features/photo/api/use-save-pending-receipt-mutation.ts)); рядок `pending_parses` видаляється, blob лишається за чеком.
- Re-parse знову впав → `attempts++` (`useIncrementPendingAttemptsMutation`), рядок і фото лишаються.
- «Відкинути» на `/pending` → видаляється і рядок, і blob.

Entry-point — окремий роут [`/pending`](../web/src/routes/pending.tsx) + лічильник на головній. Re-parse переюзовує наявну `BatchReviewCarousel` з передзаповненим `paid_by`.

---

## Таблиця `statement_transactions`

Персистентні **орфанні транзакції з виписки** — рядки банківської виписки, які при звірці (`/reconcile`) не співпали з жодним чеком (`reason: 'no-candidate'`). Зберігаються, щоб: (а) пережити перезавантаження; (б) автоматично зматчитись, коли пізніше введуть відповідний чек; (в) користувач міг створити з них чек-«заглушку» без деталей. **Тільки орфани** — співпалі рядки (toFix/alreadyCorrect) діють напряму на `receipts` і не персистяться; повернення/`receipt-taken` лишаються інформаційними.

Міграції: [`supabase/migrations/20260606000001_add_statement_source.sql`](../supabase/migrations/20260606000001_add_statement_source.sql) (додає `'statement'` у enum `receipt_source`) + [`supabase/migrations/20260606000002_statement_transactions.sql`](../supabase/migrations/20260606000002_statement_transactions.sql).

```sql
create table public.statement_transactions (
  id          text primary key,            -- ULID
  date        date not null,
  time        time,
  amount_orig numeric(12, 2) not null,     -- завжди додатна (abs суми списання)
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  merchant    text,
  raw         text,
  paid_by     text not null check (paid_by like '%@%'),
  status      text not null default 'unmatched'
              check (status in ('unmatched', 'receipt_created', 'dismissed')),
  receipt_id  text references public.receipts(id) on delete set null,
  suggested_category text,                 -- AI's category guess at import
  dedup_key   text not null,               -- date|amount|currency|label|occurrence
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

| Колонка              | Тип           | Nullable     | Правила / Примітка                                                                                             |
| -------------------- | ------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| `id`                 | text (ULID)   | ні           | client-generated                                                                                               |
| `date`               | date          | ні           | дата проведення (YYYY-MM-DD)                                                                                   |
| `time`               | time          | так          | HH:MM:SS, якщо виписка показує час транзакції                                                                  |
| `amount_orig`        | numeric(12,2) | ні           | завжди **додатна** — повернення не зберігаються                                                                |
| `currency`           | text          | ні           | ISO 4217                                                                                                       |
| `merchant`           | text          | так          | очищена назва продавця (для показу + м'якого збігу за магазином)                                               |
| `raw`                | text          | так          | оригінальний рядок опису з виписки                                                                             |
| `paid_by`            | text(email)   | ні           | власник картки, обраний при імпорті                                                                            |
| `status`             | text          | ні (default) | `unmatched` → `receipt_created` (створено/зв'язано чек) або `dismissed` (ігноруємо)                            |
| `receipt_id`         | text (FK)     | так          | заповнюється при resolve; FK → `receipts(id)` ON DELETE SET NULL                                               |
| `suggested_category` | text          | так          | категорія, яку LLM запропонував для merchant при імпорті; fallback для заглушки, коли в історії збігу ще немає |
| `dedup_key`          | text          | ні           | `date\|amount\|currency\|label\|occurrence` — **unique**; повторний імпорт не дублює (див. нижче)              |
| `created_at`         | timestamptz   | ні           | default `now()`                                                                                                |
| `updated_at`         | timestamptz   | ні           | trigger `set_updated_at()`                                                                                     |

**RLS:** policy `allowlist_all_statement_transactions` (full read+write, gated `is_allowed_user()`). Unique index `uq_statement_txn_dedup` (dedup_key) + index `idx_statement_txn_status`.

**Дедуп vs справжні дублі (`occurrence`):** два однакові рядки в одному імпорті неможливо на рівні даних відрізнити — «справжній дубль» (покупка реально сталася двічі) vs «overlap скріншотів». Тому: (1) **промпт** інструктує AI чистити overlap — кожну транзакцію включати один раз, але справжні повтори лишати; (2) `occurrence` — порядковий номер серед однакових рядків у межах одного імпорту ([`dedupOccurrences`](../packages/domain/src/bank-statement.ts)). Справжні дублі → `occurrence` 0/1 → різні ключі → обидва зберігаються; повторний імпорт тієї ж виписки відтворює ті самі `occurrence` → ті самі ключі → upsert(`ignoreDuplicates`) дедупить. Без подвоєння на re-import.

**Чек-«заглушка» (`source='statement'`):** коли користувач створює чек з орфана (напр. McDonald's без фото), створюється `receipt` із `source='statement'` + **одна** позиція на повну суму (обрана категорія + `consumed_by`, `product_id = null`). Одна позиція потрібна, бо `v_stats_by_category` агрегує `items` — без неї витрата не потрапила б у розбивку по категоріях (хоч і була б у `v_stats_by_month/user/store`, які рахують з `receipts`). Окрема легка [`useCreateStubReceiptMutation`](../web/src/features/reconcile/api/use-create-stub-receipt-mutation.ts) (НЕ важкий save-flow) — **не** створює product і **не** пише `product_prices` снапшот, щоб не плодити псевдо-продукти з назвою магазину. Категорія в діалозі **передобирається** за пріоритетом: (1) з історії — [`useSuggestedCategory`](../web/src/features/reconcile/api/use-suggested-category.ts) шукає попередні чеки, чий `store` fuzzy-збігається з merchant/raw (той самий `storeNamesMatch`), і бере найчастішу `items.category` (напр. McDonald's → Кафе/ресторани); (2) якщо в історії збігу ще немає — `suggested_category`, яку LLM запропонував при імпорті (промпт отримує список наших категорій і повертає одну з них). Самонавчається; користувач може змінити. Після створення орфан resolve-иться (`receipt_id` + `status='receipt_created'`).

**Lifecycle:**

- Імпорт виписки → no-candidate рядки upsert-яться сюди (`onConflict: dedup_key, ignoreDuplicates`) — [`useSaveOrphansMutation`](../web/src/features/reconcile/api/use-save-orphans-mutation.ts).
- На `/reconcile` **недавні** орфани (≤2 міс.) повторно проганяються через `reconcileStatement` проти чеків того ж вікна; пропонується «Зв'язати» лише для чеків, доданих **після** орфана (`receipt.created_at > orphan.created_at` — старіші вже були перевірені при імпорті). За потреби flip `paid_by` ([`useResolveOrphanMutation`](../web/src/features/reconcile/api/use-resolve-orphan-mutation.ts)).
- «Створити чек» → stub-receipt + resolve. «Ігнорувати» → `status='dismissed'` ([`useDismissOrphanMutation`](../web/src/features/reconcile/api/use-dismiss-orphan-mutation.ts)).

---

## Таблиця `store_aliases`

Вивчені пари назв магазинів для звірки виписки: коли користувач **підтверджує** збіг, у якого назва з виписки НЕ fuzzy-збіглася з назвою магазину чека (`storeMatch: false`), пара запам'ятовується — наступні звірки трактують її як store match (рядок потрапляє в pre-checked групу «Магазин збігся»). Доповнення до token-based fuzzy ([`storeNamesMatch`](../packages/domain/src/store-match.ts)), а не заміна: alias — точний збіг нормалізованої пари.

Міграція: [`supabase/migrations/20260610000001_store_aliases.sql`](../supabase/migrations/20260610000001_store_aliases.sql).

```sql
create table public.store_aliases (
  id             text primary key,            -- ULID
  statement_name text not null,               -- нормалізована назва з виписки (merchant або raw)
  receipt_store  text not null,               -- нормалізована назва магазину чека
  created_at     timestamptz not null default now()
);
```

| Колонка          | Тип         | Nullable | Правила / Примітка                                                                                                                   |
| ---------------- | ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `id`             | text (ULID) | ні       | client-generated                                                                                                                     |
| `statement_name` | text        | ні       | **нормалізована** (`normalizeStoreName`) назва з виписки; на одне підтвердження пишеться до 2 рядків — окремо для `merchant` і `raw` |
| `receipt_store`  | text        | ні       | **нормалізована** назва магазину з чека                                                                                              |
| `created_at`     | timestamptz | ні       | default `now()`                                                                                                                      |

**RLS:** policy `allowlist_all_store_aliases` (full read+write, gated `is_allowed_user()`). Unique index `uq_store_aliases_pair (statement_name, receipt_store)` — повторне підтвердження тієї ж пари no-op (upsert `ignoreDuplicates`).

Обидві колонки зберігаються нормалізованими (нормалізація — у [`makeStoreAlias`](../packages/domain/src/factories.ts)), бо unique-індекс має дедупити "McDonald's" і "MCDONALDS". Матчинг читає таблицю як `Set` ключів `"statement_name|receipt_store"` ([`makeStoreAliasKey`](../packages/domain/src/store-match.ts)) і передає в `reconcileStatement` через `options.storeAliasKeys` — domain лишається vendor-free.

---

## Storage bucket `receipts`

Приватний bucket для фото чеків.

```sql
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false);
```

**Path scheme:** `{user_email}/{yyyy}/{mm}/{ulid}.{ext}` — наприклад `you@example.com/2026/05/01HM4N.../jpg`.

**RLS policies на `storage.objects`** (де `bucket_id = 'receipts'`):

- SELECT, INSERT, UPDATE, DELETE — gated by `bucket_id = 'receipts' AND public.is_allowed_user()`.

**Доступ:**

- Read через signed URLs (TTL 1 година default). Re-sign on demand через `photoStorage.getSignedUrl(path)`.
- Public URLs не використовуються (bucket `public = false`).

---

## Views: `v_stats_by_*`

4 read-only view-и для дашборду на `/stats`. Усі з `security_invoker = on` — RLS успадковується з базових таблиць.

```sql
create view public.v_stats_by_month with (security_invoker = on) as
select to_char(date, 'YYYY-MM') as month,
       sum(total_eur)::numeric(14,2) as total_eur,
       count(*)::int as receipts_count
from public.receipts
group by to_char(date, 'YYYY-MM')
order by to_char(date, 'YYYY-MM') desc;

create view public.v_stats_by_category with (security_invoker = on) as
select category,
       sum(total_eur)::numeric(14,2) as total_eur,
       count(*)::int as items_count
from public.items
group by category
order by sum(total_eur) desc;

create view public.v_stats_by_user with (security_invoker = on) as
select paid_by,
       sum(total_eur)::numeric(14,2) as total_eur,
       count(*)::int as receipts_count
from public.receipts
group by paid_by
order by sum(total_eur) desc;

create view public.v_stats_by_store with (security_invoker = on) as
select store,
       sum(total_eur)::numeric(14,2) as total_eur,
       count(*)::int as receipts_count
from public.receipts
group by store
order by sum(total_eur) desc;
```

| View                       | Колонки                                           | Sort              | Використання                   |
| -------------------------- | ------------------------------------------------- | ----------------- | ------------------------------ |
| `v_stats_by_month`         | `month` (YYYY-MM), `total_eur`, `receipts_count`  | desc              | `/stats` ByMonthChart, last 12 |
| `v_stats_by_category`      | `category`, `total_eur`, `items_count`            | desc by total_eur | `/stats` ByCategoryChart       |
| `v_stats_by_user`          | `paid_by`, `total_eur`, `receipts_count`          | desc by total_eur | `/stats` ByUserChart (pie)     |
| `v_stats_by_store`         | `store`, `total_eur`, `receipts_count`            | desc by total_eur | `/stats` ByStoreChart, top 10  |
| `v_stats_savings_by_month` | `month`, `savings_eur`, `discounted_items_count`  | month desc        | `/stats` SavingsByMonthChart   |
| `v_stats_waste_by_month`   | `month`, `wasted_value_eur`, `wasted_items_count` | month desc        | `/stats` WasteByMonthChart     |

**PostgREST quirk:** numeric columns повертаються JSON-ом як strings, не numbers. Хуки coerce'ять через `asNumber()` у [`web/src/features/stats/api/use-stats.ts`](../web/src/features/stats/api/use-stats.ts).

---

## In-memory типи (НЕ зберігаються у DB)

### `ParsedReceipt` / `ParsedItem`

Це **transit shape** між AI-парсером (Edge Function) і review UI. Жодне з цих полів не зберігається у DB напряму; UI відображає, користувач редагує, потім будуються справжні `Receipt`/`Item` через `makeReceipt`/`makeItem` factories.

Канонічна Zod-схема — у [`packages/domain/src/schemas.ts`](../packages/domain/src/schemas.ts):

**`ParsedReceipt`:**

| Поле         | Тип                 | Nullable | Примітка                      |
| ------------ | ------------------- | -------- | ----------------------------- |
| `store`      | string              | так      | best-effort merchant name     |
| `date`       | string `YYYY-MM-DD` | так      | `null` якщо AI не зчитав      |
| `currency`   | string ISO 4217     | ні       | default `'EUR'`               |
| `total_orig` | number              | так      | sanity check проти sum(items) |
| `items`      | `ParsedItem[]`      | ні       | може бути `[]`                |

**`ParsedItem`:**

| Поле                  | Тип    | Nullable | Примітка                                                                      |
| --------------------- | ------ | -------- | ----------------------------------------------------------------------------- |
| `product_name`        | string | ні       | verbatim з чека (мова як у чеку)                                              |
| `qty`                 | number | ні       | > 0                                                                           |
| `unit_price_orig`     | number | ні       | у валюті чеку; може бути < 0                                                  |
| `category_suggestion` | string | так      | one of `categories.name` або `null`                                           |
| `discount_orig`       | number | так      | заповнюється UI-шаром після pair-grouping; AI завжди повертає `0`/`undefined` |

**Validation flow:**

1. Gemini/Claude провайдери у Edge Function видають JSON через native schema enforcement (`responseJsonSchema` для Gemini, `tool_use input_schema` для Claude). Server-side Zod **не** запускається.
2. Client-side `edge-fn-parse-receipt.ts` валідує відповідь через `ParsedReceiptSchema.safeParse()` — single source of truth.
3. Якщо schema-mismatch — throw з `parse-receipt returned invalid shape: <details>`.

> **Edge Function vendoring.** `supabase/functions/parse-receipt/types.ts` містить ~25 LOC mirror цих типів. Deno не резолвить Vite-style workspace package; vendoring + client-side Zod валідація — pragmatic компроміс. Drift discipline: при зміні `ParsedReceiptSchema` у domain — синхронізуй вендоренний файл. Phase 7 lessons learned + ADR-0013.

Product matching до існуючих `products.id` — **не** робить AI; це UI-side логіка (поки що деференирована, у Phase 5+ можна додати fuzzy-match на review).

---

## Зведена діаграма зв'язків

```
                    ┌──────────────┐
                    │ app_users    │  ◄── allowlist (RLS gate)
                    └──────────────┘
                           │ is_allowed_user()
                           ▼
       ┌───────────────────────────────────────────┐
       │            All RLS policies               │
       └───────────────────────────────────────────┘
                ▲                ▲                ▲
                │                │                │
       ┌────────┴────┐   ┌──────┴──────┐   ┌─────┴───────┐
       │ receipts (1)│──<│ items (N)   │   │ categories  │
       └─────────────┘   └─────────────┘   └─────────────┘
                                │                  ▲
                                │                  │
                                │           (FK ON UPDATE CASCADE)
                                ▼
                         ┌─────────────┐
                         │ products    │
                         │  (0..1)     │
                         └─────────────┘

                         ┌─────────────────────────┐
                         │ storage.objects         │
                         │   bucket_id='receipts'  │
                         │   path: email/yyyy/mm/  │
                         │         {ulid}.jpg      │
                         └─────────────────────────┘

                         ┌─────────────────────────┐
                         │ v_stats_by_month        │
                         │ v_stats_by_category     │
                         │ v_stats_by_user         │
                         │ v_stats_by_store        │
                         │   (security_invoker)    │
                         └─────────────────────────┘

NBU API (live) ── викликається browser-side при INSERT/UPDATE UAH-Receipt → fx_rate_eur
Edge Function `parse-receipt` ── викликається browser-side через supabase-js `functions.invoke`
                                  з JWT user'а; перевіряє is_allowed_user() RPC
```

---

## Ще не у схемі (out of MVP)

Документуємо, щоб не забути обговорити при додаванні. **НЕ** реалізовуй без явної потреби:

- `settlements` (хто кому винен) — нова таблиця, новий ADR.
- `spoilage` як окрема таблиця (поточно `wasted_qty` колонка) — додати лише при потребі багатоетапного списання.
- `product_prices` як матеріалізована view — додати лише при проблемах з продуктивністю аналітики.
- `errors` лог — для логування helper-помилок API/UI.
- Підтримка інших валют (USD, PLN, CHF, ...) — точкове розширення `nbuFxRateProvider` (або новий `ecbFxRateProvider`) при появі першого реального чеку у такій валюті. Див. [extending.md](extending.md) рецепт "Додати валюту".
- `photo_path` колонка на `receipts` — для re-signing photo URLs після TTL expire без regex-екстракції з `photo_url`.
- `audit_log` таблиця (хто/коли редагував рядок).
- `deleted_at` для soft-delete (тільки якщо знайдемо use-case).

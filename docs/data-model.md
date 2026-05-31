# Модель даних

> Цей документ — **єдине джерело істини** про схему. Якщо тут і в коді розбіжність — правда тут. Код треба виправити.
>
> Канонічні DDL — у [supabase/migrations/](../supabase/migrations/). Згенеровані TS-типи — у [web/src/shared/types/database.types.ts](../web/src/shared/types/database.types.ts) (regenerate через `npx supabase gen types typescript --linked`). Zod-схеми (in-app валідація + factories) — у [packages/domain/src/schemas.ts](../packages/domain/src/schemas.ts).

Зберігання — Postgres у Supabase project `<your-project-ref>`. 4 основні таблиці (`receipts`, `items`, `products`, `categories`) + `app_users` (allowlist) + 4 read-only view-и `v_stats_by_*` для дашборду + 1 Storage bucket `receipts` для фото.

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

- `receipts`, `items`, `products` — full read+write для allowlisted users.
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
  source        public.receipt_source not null,    -- enum: 'photo' | 'manual' | 'edit' | 'manual-json'
  raw_ocr_json  text check (raw_ocr_json is null or length(raw_ocr_json) <= 45000),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

| Колонка        | Тип           | Nullable | Правила                                                                                                                                                                     | Приклад                                                                                |
| -------------- | ------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `id`           | text (ULID)   | ні       | 26 символів                                                                                                                                                                 | `01HM4N6RXX5K2P9F8DZ7QWERTY`                                                           |
| `date`         | date          | ні       | ISO 8601 yyyy-mm-dd                                                                                                                                                         | `2026-05-04`                                                                           |
| `store`        | text          | ні       | вільний текст; рекомендована soft-нормалізація на UI                                                                                                                        | `ALDI Süd`                                                                             |
| `currency`     | text          | ні       | ISO 4217                                                                                                                                                                    | `EUR` / `UAH`                                                                          |
| `total_orig`   | numeric(12,2) | ні       | у валюті чеку, 2dp                                                                                                                                                          | `34.78`                                                                                |
| `fx_rate_eur`  | numeric(14,6) | ні       | курс currency→EUR на дату чеку, 6dp; > 0                                                                                                                                    | `1.000000` (EUR) / `0.024500` (UAH)                                                    |
| `total_eur`    | numeric(12,2) | ні       | `round(total_orig * fx_rate_eur, 2)`                                                                                                                                        | `34.78`                                                                                |
| `paid_by`      | text (email)  | ні       | гілд-перевірка `like '%@%'`                                                                                                                                                 | `you@example.com`                                                                      |
| `photo_url`    | text          | так      | signed URL з Storage; TTL 1 година (re-sign on display)                                                                                                                     | `https://<your-project-ref>.supabase.co/storage/v1/object/sign/receipts/...?token=...` |
| `source`       | enum          | ні       | `'photo' \| 'manual' \| 'edit' \| 'manual-json'` (`manual-json` — користувач сам прогнав prompt у external AI tool і вставив JSON через діалог "Paste AI JSON" на `/photo`) | `photo`                                                                                |
| `raw_ocr_json` | text          | так      | JSON-stringify ParsedReceipt; **обмежено 45,000 chars**; null коли source=manual або занадто великий (для source=photo та source=manual-json — збережено)                   | `{"store":"Lidl","items":[...]}`                                                       |
| `note`         | text          | так      | вільна нотатка                                                                                                                                                              | `Закупка для вечірки`                                                                  |
| `created_at`   | timestamptz   | ні       | default `now()`                                                                                                                                                             | `2026-05-04T14:30:00+02:00`                                                            |
| `updated_at`   | timestamptz   | ні       | trigger `set_updated_at()` оновлює на UPDATE                                                                                                                                |                                                                                        |

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

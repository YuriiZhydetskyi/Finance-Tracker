# Deploy & Operations

Operational runbook для нового стека. Архітектурні рішення — у [decisions/0013-migrate-to-react-supabase.md](decisions/0013-migrate-to-react-supabase.md). Цей файл — про "як я задеплою / як додам env var / куди дивитись коли щось упало".

---

## Топологія

```
┌─────────────────────────────────────────────────────────────────────┐
│ GitHub repo (main branch)                                           │
└──────────────┬──────────────────────────────────────────────────────┘
               │ push
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ GitHub Actions (.github/workflows/deploy.yml)                       │
│   1. npm ci                                                         │
│   2. lint + typecheck + test (gate — broken commit не задеплоїться) │
│   3. npm run build  ← Vite inline'ить VITE_* env vars з secrets     │
│   4. wrangler pages deploy web/dist                                 │
└──────────────┬──────────────────────────────────────────────────────┘
               │ static files upload
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Cloudflare Pages — <your-app>.pages.dev (static, prod)     │
└──────────────┬──────────────────────────────────────────────────────┘
               │ HTTPS
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Browser bundle (React SPA)                                          │
│   • supabase-js client з anon key + JWT                             │
│   • Direct calls to Postgres (RLS-gated), Storage (RLS-gated),      │
│     Edge Function (parse-receipt), Auth (magic link)                │
│   • NBU FX rate (public CORS-open API)                              │
└──────────────┬──────────────────────────────────────────────────────┘
               │ supabase-js
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Supabase project <your-project-ref>                               │
│   • Postgres (4 tables + 4 v_stats_* views, RLS on all)             │
│   • Auth (magic link, JWT)                                          │
│   • Storage (`receipts` bucket, RLS via storage.objects policies)   │
│   • Edge Function `parse-receipt` (Gemini → Claude fallback)        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Чому GitHub Actions замість Cloudflare's GitHub-app

Cloudflare Pages пропонує два деплой-режими:

- **Cloudflare-builds:** конект через CF GitHub app → CF клонує репо → CF запускає `npm run build` у себе → CF деплоїть. Env vars живуть у CF dashboard.
- **Direct-upload:** ти білдиш `dist/` сам (локально або в CI) → завантажуєш через `wrangler pages deploy`. CF просто хостить готові файли.

Ми обрали **direct-upload** через GitHub Actions через жорсткий баг у CF GitHub-app UI: «Connect GitHub» іноді закидає у нескінченний loop redirect-у на GitHub permissions сторінку, де нема що клацати. Trade-off: треба свої secrets налаштувати, але натомість CI gate з lint+typecheck+test перед deploy — у CF-builds такого нема, він просто `npm run build`.

Workflow живе у [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). Trigger: push на `main` + manual via GitHub Actions UI.

---

## Required secrets

### GitHub repo secrets (Settings → Secrets and variables → Actions)

| Name                     | Звідки                                                                                                 | Призначення                |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------- |
| `CLOUDFLARE_API_TOKEN`   | dash.cloudflare.com/profile/api-tokens → Create Token з permission `Account → Cloudflare Pages → Edit` | wrangler-action для deploy |
| `CLOUDFLARE_ACCOUNT_ID`  | dash.cloudflare.com → правий sidebar account-сторінки (32-hex chars)                                   | wrangler-action для deploy |
| `VITE_SUPABASE_URL`      | `https://<your-project-ref>.supabase.co`                                                               | Vite inline'ить у бандл    |
| `VITE_SUPABASE_ANON_KEY` | `web/.env.local` (починається з `eyJ...`)                                                              | Vite inline'ить у бандл    |

### Supabase Edge Function secrets

```bash
npx supabase secrets set GEMINI_API_KEY=... ANTHROPIC_API_KEY=...
```

Зберігаються Supabase-стороною; читаються лише з функції через `Deno.env.get(...)`. **Ніколи не потрапляють у клієнтський бандл.**

### Локально (`web/.env.local`, gitignored)

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Тільки ці дві. Cloudflare credentials локально не треба — `wrangler login` робить OAuth-сесію в `~/.wrangler/`.

---

## Build-time vs runtime env vars

Critical concept — від нього залежить куди класти змінні:

- **Vite inline'ить `VITE_*` змінні у бандл при білді.** `import.meta.env.VITE_SUPABASE_URL` буквально замінюється на string у згенерованому JS. Це build-time substitution, не runtime lookup.
- `web/index.html` підставляє `%VITE_SUPABASE_URL%` у `<link rel="preconnect">` тим самим механізмом. Якщо змінної немає на білді, Vite залишає літерал `%VITE_SUPABASE_URL%` (білд не падає, а `env.ts` усе одно зупинить застосунок на старті).
- **Cloudflare Pages у direct-upload режимі нічого не білдить.** Він просто роздає статичні файли. Env vars у CF dashboard у цьому режимі не використовуються — змінні треба у середовищі того, хто білдить.

| Контекст                   | Звідки беруться `VITE_*`                                      |
| -------------------------- | ------------------------------------------------------------- |
| `npm run dev` локально     | `web/.env.local`                                              |
| `npm run build` локально   | `web/.env.local`                                              |
| GitHub Actions build       | repo secrets (`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`) |
| Cloudflare Pages dashboard | **не використовуються** (direct-upload)                       |

Виняток: якщо колись додамо **Cloudflare Pages Functions** (server-side handlers у `functions/`) — для них runtime env у CF dashboard матиме сенс. Зараз — ні.

Як перевірити: відкрий live URL → DevTools → Network → знайди bundled `index-*.js` → grep `eyJ` (початок JWT). Побачиш anon key inline'ом — це нормально, він public.

---

## Authorization model — чому anon key безпечно у бандлі

Часта плутанина: «public anon key — невже не дірка?»

```
Browser bundle → Supabase REST API
├── VITE_SUPABASE_ANON_KEY (public, у DevTools видний)
│   └── каже Supabase: "я представляю проект <id>"
│       Сам по собі = роль `anon` → RLS блокує все
└── + JWT після magic link sign-in
    └── каже Supabase: "я конкретний користувач з email X"
        RLS policy is_allowed_user() перевіряє X у app_users
        → дозволяє/блокує операцію
```

Справжня авторизація живе у Postgres RLS, не у клієнті. Anon key — лише ідентифікатор проекту. Це і є дизайн-рішення Supabase: anon key public by design (звідси префікс `VITE_` у Vite-конвенції — означає public-by-design).

**`service_role` key** — той що обходить RLS повністю. Він **ніколи** не потрапляє у frontend. Живе тільки у Supabase Edge Function secrets, потрібен для адмін-операцій (наразі — нема, RLS + JWT покривають все).

---

## Deploy procedure

### Перший раз (bootstrap, локально)

GitHub Actions деплоїть у вже існуючий CF Pages project. Перший раз створюємо його руками:

```powershell
npm install -g wrangler
wrangler login                               # OAuth-cookie у ~/.wrangler/
cd web
npm run build
wrangler pages deploy dist --project-name=finance-tracker --branch=main
```

Перший запуск питає:

- Create new project? → **Yes**
- Production branch? → **main**

Видасть URL виду `https://finance-tracker.pages.dev` (або з суфіксом — у нас вийшло `<your-app>.pages.dev` бо CF auto-suffix'ить при collision). Запиши його — потрібен для Supabase Auth.

### Supabase Auth — production redirect URLs

Без цього magic link редіректить на `localhost:5173`.

Studio → Authentication → URL Configuration:

- **Site URL:** `https://<твій>.pages.dev`
- **Redirect URLs:** додати `https://<твій>.pages.dev/auth/callback`

### Що далі — git push робить deploy

```powershell
git push origin main
```

GitHub Actions покаже три jobs: `checks` → `deploy-backend` → `deploy-frontend`. `deploy-backend` чекає на ваше підтвердження (кнопка «Review deployments» → «Approve and deploy»). Якщо хоч один gate червоний або ви відхилили deploy — нічого не деплоїться, продакшн лишається на попередній версії. Деталі — розділ «Автодеплой бекенду» нижче.

### Manual deploy (без push, через UI)

GitHub repo → Actions → "Deploy to Cloudflare Pages" → Run workflow → main → Run.

### Локальний deploy (skip CI)

Корисно якщо треба швидко перевірити одну зміну без коміту:

```powershell
cd web
npm run build
wrangler pages deploy dist --project-name=finance-tracker --branch=main
```

Це створить **preview deployment** з URL виду `https://abc1234.<your-app>.pages.dev` — production не торкає. Щоб задеплоїти у production minus CI: `--branch=main`.

---

## Автодеплой бекенду

Міграції та обидві Edge Functions деплоїть job `deploy-backend` у
[deploy.yml](../.github/workflows/deploy.yml). Фронтенд деплоїться лише після
нього, тож він ніколи не випередить схему БД.

**Чому секрети не в коді й не на рівні репо.** Секрети Supabase лежать у
GitHub Environment `production`. GitHub віддає їх лише job-у з
`environment: production` і лише після ручного підтвердження. Workflow із PR
(включно з форками публічного репо) їх не бачить.

### Одноразове налаштування

1. **Environment:** GitHub → Settings → Environments → New environment →
   `production`. Увімкнути **Required reviewers** і додати себе. У
   **Deployment branches and tags** обрати «Selected branches» → `main`.
2. **CI-токен Supabase:** supabase.com/dashboard/account/tokens → Generate new
   token, назва `github-actions-finance-tracker`, термін дії 90 днів.
   Resource access → **Project** → організація → FinanceTracker. Токен потрібен
   лише для `supabase functions deploy`, тому достатньо одного права:
   **Application services → Edge Functions: Read-write**. Решта — None.
   Не використовуйте `supabase link` у CI: він читає розкриті API-ключі
   (включно з `service_role`) і вимагає права «API Key Secrets».
3. **Секрети середовища** (Environments → `production` → Add secret):
   - `SUPABASE_ACCESS_TOKEN` — токен із кроку 2;
   - `SUPABASE_PROJECT_ID` — project ref (Settings → General);
   - `SUPABASE_DB_PASSWORD` — пароль БД (Settings → Database; якщо невідомий —
     «Reset database password» і оновити всюди, де він використовувався).
4. **Перевірка історії міграцій** перед першим автоматичним запуском, локально:

   ```bash
   npx supabase migration list
   ```

   Усі міграції, крім ще не застосованих нових, мають бути в колонці Remote.
   Якщо є розбіжність у старих версіях, `db push` у CI впаде — розберіться
   локально до merge.

### Ротація

- Токен: згенерувати новий, оновити `SUPABASE_ACCESS_TOKEN`, видалити старий у
  дашборді. Нагадування — за тиждень до закінчення терміну.
- Пароль БД: Reset у дашборді → оновити `SUPABASE_DB_PASSWORD`.

### Що робить job

`supabase db push --db-url … --yes` напряму через session pooler
(`SUPABASE_POOLER_HOST` у workflow; раннери GitHub не мають IPv6 для прямого
хоста) — застосовує лише нові міграції, повторний запуск — no-op. Пароль
URL-кодується і маскується в логах. Далі `supabase functions deploy` для `parse-receipt` і
`process-receipt-imports` (`--use-api`, без Docker). Секрети самих функцій
(`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `RECEIPT_IMPORT_CRON_TOKEN`) job не
чіпає: вони вже живуть у Supabase.

Підтвердження потрібне на кожен push у `main`, навіть якщо змінились лише
документи.

---

## Перед деплоєм канонічних назв і злиття (ADR-0033)

Міграції `20261027120000…120600` одним `db push` і змінюють дані (злиття дублікатів товарів,
`products.store`, `receipts.store`, ключі правил, «Без упаковки» масово). Між схемою й міграцією даних
паузи немає, а підтвердження `production` лише останній шлюз. Тому перегляд робимо до merge.

### 1. Копія даних

`pg_dump` таблиць `products`, `items`, `product_prices`, `product_match_rules`, `receipts`,
`store_aliases` (рядок підключення береться зі змінної середовища, у документи й чат не копіюється).
Злиття має логічний відкат (`unmerge_product`), але не фізичний.

### 2. Запити, що працюють ДО міграцій

`merge_duplicate_products(true)` з’являється лише після міграцій, тож до них перевіряємо так:

```sql
-- Написання магазинів у товарах і чеках.
select store, count(*) as products from public.products group by 1 order by 1;
select store, count(*) as receipts from public.receipts group by 1 order by 1;

-- Грубо однакові магазини: нижній регістр без пунктуації. Мережі з різними
-- назвами (Netto / Netto Marken-Discount, оператори REWE) тут не видно: їх шукай очима в списку вище.
select regexp_replace(lower(store), '[^[:alnum:]]+', '', 'g') as rough_key,
       array_agg(distinct store) as spellings
  from public.products
 group by 1 having count(distinct store) > 1;

-- Той самий артикул під кількома написаннями магазину: це пари рівня 1.
select regexp_replace(lower(store), '[^[:alnum:]]+', '', 'g') as rough_key,
       store_product_code, count(*) as rows, array_agg(id) as ids
  from public.products
 where store_product_code is not null
 group by 1, 2 having count(*) > 1;

-- Що доведеться переносити: правила й знімки цін на рядках із цих груп.
select count(*) as rules from public.product_match_rules;
select count(*) as prices from public.product_prices;
select p.store, count(*) as rules
  from public.product_match_rules r join public.products p on p.id = r.product_id
 group by 1 order by 1;
select store_key, count(*) from public.product_match_rules group by 1 order by 1;

-- Чи згортає база великі літери з діакритикою (потрібно для ключів правил).
select lower('ALDI SÜD') = lower('Aldi Süd') as lower_folds_umlaut;

-- Зіткнення (store, merchant_order_id) після зведення написань: ті чеки міграція лишить як є.
select regexp_replace(lower(store), '[^[:alnum:]]+', '', 'g') as rough_key,
       merchant_order_id, array_agg(id) as receipt_ids
  from public.receipts
 where merchant_order_id is not null
 group by 1, 2 having count(*) > 1;

-- Один і той самий похід, імпортований двічі під двома написаннями мережі.
select a.id as first_id, b.id as second_id, a.date, a.total_orig, a.store as first_store, b.store as second_store
  from public.receipts a
  join public.receipts b
    on b.id > a.id and b.date = a.date and b.currency = a.currency
   and b.total_orig = a.total_orig and b.store <> a.store;
```

Другий і третій запити підказують, що очікувати від рівнів 1 і 2; подвійні чеки міграція не чіпає
(рішення власника).

### 3. Сухий прогін усього деплою

Спершу список пар, які правило злило б (міграції лише до `120200`, потім відкат): кожен рядок —
`would_merge` або `skipped_conflict` з причиною в `detail`.

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
\i supabase/migrations/20261027120000_store_name_registry.sql
\i supabase/migrations/20261027120100_packaging_not_applicable_reason.sql
\i supabase/migrations/20261027120200_merge_products.sql
select * from public.merge_duplicate_products(true);
rollback;
SQL
```

Потім усі сім міграцій в одній транзакції, яку відкочено; NOTICE показує, що було б зроблено:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;
\i supabase/migrations/20261027120000_store_name_registry.sql
\i supabase/migrations/20261027120100_packaging_not_applicable_reason.sql
\i supabase/migrations/20261027120200_merge_products.sql
\i supabase/migrations/20261027120300_canonicalize_stores_and_merge_duplicates.sql
\i supabase/migrations/20261027120400_canonical_store_write_path.sql
\i supabase/migrations/20261027120500_packaging_exclusion_rule.sql
\i supabase/migrations/20261027120600_packaging_queue_other_store_hint.sql
rollback;
SQL
```

`SUPABASE_DB_URL` — рядок підключення до бази (session pooler); у репозиторій і чат він не потрапляє.
Скрипти запускають із кореня репозиторію (шляхи `\i` відносні).
Той самий вміст можна вставити в SQL editor у Studio між `begin;` і `rollback;`; якщо Studio не
показує `RAISE NOTICE`, користуйся `psql`. Міграція 20261027120300 сама падає, якщо кількості
`items`, `product_prices`, `receipts` змінились або товарів не стало «було мінус злиті».

Що читати в NOTICE: `MERGED` (пара злита), `SKIPPED` (пара з конфліктом — рішення власника), `STAYS`
(рядок лишився на старому написанні через зіткнення), підсумкові рядки `canonical stores:` і
`packaging exclusion:`, та `FLAGGED` для кожного рядка «Без упаковки». NOTICE містить назви товарів і
магазинів — не публікуй їх.

### 4. Після деплою

```sql
-- Лишились тільки пропущені пари.
select tier, status, count(*) from public.merge_duplicate_products(true) group by 1, 2;
-- Рядки з неканонічним написанням (пара ще чекає рішення).
select count(*) from public.products where store <> public.canonical_store_name(store);
select count(*) from public.receipts where store <> public.canonical_store_name(store);
-- Журнал злиттів і масова позначка.
select count(*) from public.product_merge_log where reverted_at is null;
select packaging_not_applicable_reason, count(*)
  from public.products where packaging_not_applicable group by 1 order by 1;
select count(*) from public.v_packaging_queue_products;
select * from public.store_name_registry order by created_at;
select * from public.store_name_patterns order by pattern;
```

Потім `npx supabase gen types typescript --linked` (через UTF-8 helper, див. «Common operations»):
`database.types.ts` для цієї зміни оновлено вручну.

### Додати мережу магазинів або псевдонім

Рецепт «додати мережу» — у [extending.md](extending.md#рецепт-11-додати-мережу-магазинів-або-псевдонім).
Після нового шаблону вже наявні рядки зводять тим самим правилом, що й міграція:

```sql
select * from public.merge_duplicate_products(true);    -- нові двійники, які шаблон об’єднав
select * from public.merge_duplicate_products(false);  -- злити те, що без конфліктів
update public.products
   set store = public.canonical_store_name(store)
 where store <> public.canonical_store_name(store);
```

Для чеків тригер `trg_receipts_canonical_store` обнулив би `store_printed`, тож на час ручного
перепису його вимикають:

```sql
begin;
alter table public.receipts disable trigger trg_receipts_canonical_store;
update public.receipts
   set store_printed = coalesce(store_printed, store), store = public.canonical_store_name(store)
 where store <> public.canonical_store_name(store);
alter table public.receipts enable trigger trg_receipts_canonical_store;
commit;
```

Ключі навчених правил (`product_match_rules.store_key`, нижній регістр назви магазину) треба
переписати так само: `store_key = public.normalize_product_match_key(public.canonical_store_name(store_key))`.
Зіткнення первинного ключа Postgres покаже помилкою: розв’яжи його вручну.

### Перейменувати канонічну назву магазину

Наприклад, обрати `Netto Marken-Discount` замість `Netto`. Усі рядки мережі мають однакову назву,
тож відображення взаємно однозначне:

```sql
begin;
update public.store_name_patterns
   set canonical_name = 'Netto Marken-Discount'
 where pattern = '^netto( marken discount)?$';
-- якщо канонічну назву дав реєстр, а не шаблон:
-- update public.store_name_registry set canonical_name = '…' where store_key = '…';
update public.products set store = 'Netto Marken-Discount' where store = 'Netto';
alter table public.receipts disable trigger trg_receipts_canonical_store;
update public.receipts set store = 'Netto Marken-Discount' where store = 'Netto';
alter table public.receipts enable trigger trg_receipts_canonical_store;
update public.product_match_rules
   set store_key = public.normalize_product_match_key('Netto Marken-Discount')
 where store_key = public.normalize_product_match_key('Netto');
commit;
```

Якщо серед рядків мережі є такі, що ще лежать на неканонічному написанні (пари, пропущені
міграцією), спершу розв’яжи ці пари.

---

## Common operations

### Додати нову env var

Якщо це **build-time client var** (читається через `import.meta.env.X`):

1. Префікс `VITE_` обов'язковий — інакше Vite не expose'ить.
2. `web/.env.local` локально + `web/.env.example` для команди.
3. GitHub repo secrets: додати з тим самим іменем.
4. `.github/workflows/deploy.yml` → Build step `env:` секція додати рядок:
   ```yaml
   VITE_NEW_VAR: ${{ secrets.VITE_NEW_VAR }}
   ```

Якщо це **Edge Function secret** (читається через `Deno.env.get('X')`):

```bash
npx supabase secrets set MY_KEY=value
npx supabase functions deploy parse-receipt   # redeploy щоб підхопило
```

### Ротувати Supabase anon key

(Рідкісна операція — anon key public by design. Виконувати тільки якщо проект скомпрометований і ключ змінений у Supabase.)

1. Studio → Settings → API → "Reset anon key" (старий миттєво стає невалідний).
2. Скопіювати новий.
3. Оновити `web/.env.local`, GitHub secret `VITE_SUPABASE_ANON_KEY`.
4. Trigger deploy: `git commit --allow-empty -m "rotate anon key" && git push`.

### Змінити CF Pages project name або custom domain

CF dashboard → Workers & Pages → finance-tracker → Settings → Custom domains. Custom domain (наприклад `finance.example.com`) робиться через DNS у Cloudflare DNS — самий простий варіант якщо домен уже там.

Якщо змінив project name: оновити `--project-name=...` у workflow `.github/workflows/deploy.yml`.

### Дроп всього і почати з нуля

```powershell
# CF Pages project
wrangler pages project delete finance-tracker

# Локальна сесія
del $HOME\.wrangler\config\default.toml   # або просто wrangler logout

# Database (DESTRUCTIVE)
npx supabase db reset                      # локально
# Production wipe потребує Studio → SQL editor → drop table ...
```

---

## Troubleshooting

### Magic link редіректить на localhost

Supabase Auth Site URL не оновлений. Studio → Authentication → URL Configuration → виправити Site URL і Redirect URLs.

### `/recent` віддає 404 при прямому переході

Cloudflare Pages SPA fallback не спрацював. Перевір що `web/public/_redirects` існує і містить `/* /index.html 200`. Vite копіює його у `dist/` при білді.

### CI build падає з "Cannot find package @finance-tracker/domain"

`npm ci` не побачив workspaces. Перевір що корінь `package.json` має `"workspaces": ["web", "packages/*", ...]` і workflow робить `npm ci` від кореня (а не від `web/`).

### Wrangler deploy висне

Ймовірно `wrangler login` сесія expired. `wrangler logout && wrangler login`.

### supabase-js говорить "Invalid API key"

Або `VITE_SUPABASE_ANON_KEY` переплутаний з URL-ом, або у CI секреті не той value. Спершу перевір локально (`npm run dev`); якщо працює — значить різниться лише у CI.

### `parse-receipt` Edge Function 401-ить

JWT не передався або email не у `app_users`. Логи функції: `npx supabase functions logs parse-receipt`. Studio → SQL → `select * from app_users;` — переконатись що email є.

### Stats charts порожні

Або реально нема даних, або views не застосовані до live проекту. Перевір: Studio → SQL → `select * from v_stats_by_month limit 1;`. Якщо «relation does not exist» → потрібен `npx supabase db push`.

### CI зелений, але live URL показує стару версію

CF CDN кеш. Cloudflare деплоїть нову версію інстантно, але кеш-edge може віддавати стару ще кілька хв. Hard refresh (Ctrl+Shift+R) у браузері або інкогніто. Можна також у CF dashboard → Caching → Purge Everything.

---

## Production checklist

Перед першим production-смоук-тестом, переконайся:

- [ ] `npx supabase db push` застосував обидві накопичені міграції (`20260507000002_storage_bucket.sql`, `20260507000003_stats_views.sql`)
- [ ] `npx supabase gen types typescript --linked` регенерує `web/src/shared/types/database.types.ts` з canonical джерела
- [ ] `npx supabase secrets set GEMINI_API_KEY=... ANTHROPIC_API_KEY=...` сетнуто
- [ ] `npx supabase functions deploy parse-receipt` пройшло
- [ ] Bootstrap deploy через `wrangler pages deploy dist` створив CF Pages project
- [ ] 4 GitHub secrets додані (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- [ ] Supabase Auth Site URL + Redirect URLs оновлені на production-домен
- [ ] Workflow file (`.github/workflows/deploy.yml`) закомічено і пройшов перший Actions run зеленим
- [ ] Email другого користувача доданий у `app_users`
- [ ] End-to-end smoke: sign in від обох користувачів, save photo receipt, save manual, edit, delete, /stats показує дані

---

## Увімкнути фоновий імпорт

Застосовувати лише під час окремого production deploy після review міграції:

```powershell
npx supabase db push
npx supabase functions deploy process-receipt-imports --no-verify-jwt
```

Згенеруй окремий випадковий token і задай однакове значення у двох server-only місцях (значення
сюди не копіювати): Edge Function secret `RECEIPT_IMPORT_CRON_TOKEN` та Vault secret
`receipt_import_cron_token`. У Vault також потрібен `project_url` із base URL Supabase. Міграція
створює Cron job; доки `project_url` і `receipt_import_cron_token` відсутні, його SQL навмисно не
робить HTTP request. Не використовуй service-role key як cron token: він має database privileges,
які не потрібні планувальнику.

Перевір: job є в `cron.job`, повідомлення рухаються у `pgmq.q_receipt_imports`, а логи функції не
містять payload або ключів. `RECEIPT_IMPORT_CRON_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_URL`, Gemini й Anthropic keys автоматично/явно доступні тільки Edge Function і ніколи не
додаються у `VITE_*`.

## Увімкнути автоімпорт з Gmail

Потрібні міграція `20261026150000_email_receipt_imports.sql` і функція
`ingest-email-receipts`. CI деплоїть обидві у job `deploy-backend`; вручну:

```powershell
npx supabase db push
npx supabase functions deploy ingest-email-receipts --no-verify-jwt
npx supabase functions deploy process-receipt-imports --no-verify-jwt
```

Нових секретів немає. Функція використовує автоматичні `SUPABASE_URL` і
`SUPABASE_SERVICE_ROLE_KEY`, а клієнта автентифікує ingest-токеном, хеш якого лежить у
`email_import_sources`. `verify_jwt = false` задано в `supabase/config.toml`. Після міграції
перегенеруй `database.types.ts`.

`process-receipt-imports` треба передеплоїти разом із нею, бо воркер має вміти читати
текстові документи (`text/plain`). Налаштування на боці Google описане в
[gmail-import.md](gmail-import.md).

## Заголовки безпеки

`web/public/_headers` задає для Cloudflare Pages `nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy` і `Permissions-Policy`. CSP поки що працює в режимі
`Content-Security-Policy-Report-Only`. Після деплою відкрий застосунок, пройди «Фото чек»,
«Масовий імпорт», `/edit/$id` і «Статистику» та перевір консоль браузера на порушення CSP.
Якщо їх немає, перейменуй заголовок на `Content-Security-Policy`.

У Report-Only політику додано `require-trusted-types-for 'script'`. Перед перейменуванням на `Content-Security-Policy` перевір консоль на порушення Trusted Types (pdf.js, `heic-to`, Chart.js) або прибери цю директиву: в enforced-режимі вона ламає будь-який `innerHTML`/`eval`-подібний виклик без політики.

## Posthumous: рекавері легасі

90-денне вікно відкату на Apps Script завершилось 2026-08-06. Код старого додатку видалено з репо у вересні 2026 (останній коміт, що його містить: `875bb9b`). Для довідки: `git checkout 875bb9b -- legacy/apps-script`.

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

GitHub Actions tab покаже job. ~2 хв: lint+typecheck+test+build+deploy. Якщо хоч один gate червоний — deploy не йде, продакшн залишається на попередній версії.

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

## Posthumous: рекавері легасі за 90 днів

До 2026-08-06 Apps Script проект (scriptId у `legacy/apps-script/.clasp.json`) лишається інтактним. Якщо новий стек серйозно ламається і fix зайняв би довше за прийнятну downtime:

```powershell
cd legacy/apps-script
npm install
npm run push     # clasp push на оригінальний project
```

Потім у Apps Script editor → Deploy → New deployment → Web app → отримаєш legacy URL. Поділись з обома користувачами. Sheet-дані не торкані; новий Postgres-state лишається паралельно.

Після 2026-08-06 Apps Script проект можна архівувати або видалити. Кодова база у `legacy/apps-script/` залишається у репі назавжди — це історичний референс.

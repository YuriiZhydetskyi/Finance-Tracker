# Setup — розгортання з нуля

Цей документ описує, як підняти проєкт на свіжій машині. Слідуючи кроком, ти повинен отримати локально працюючий dev-сервер (`npm run dev` на `:5173`), що говорить з вже існуючим Supabase project'ом.

Для деплою у production (Cloudflare Pages + Edge Function + secrets + Supabase Auth URL config + manual smoke) — окремий runbook у [deploy.md](deploy.md).

## Передумови

- **Node.js ≥ 22 LTS** локально (`node --version`).
- **npm** ≥ 10 (іде в комплекті з Node 22).
- **Git** локально.
- **Supabase project** — наразі один спільний `<your-project-ref>`. Якщо створюєш свій (наприклад для fork-а) — потрібен Supabase акаунт.
- **API keys для Edge Function** (тільки для production deploy):
  - **Gemini API key** з [aistudio.google.com](https://aistudio.google.com/) — безкоштовний tier 15 req/min достатньо.
  - **Anthropic API key** з [console.anthropic.com](https://console.anthropic.com/) — pay-as-you-go (~$0.024 за fallback call). Якщо не сетиш — Claude fallback не спрацьовує, але Gemini-only flow працює.

> Локальний dev НЕ потребує API ключів — `parse-receipt` функція не запускається локально, поки не сетнеш `supabase functions serve` з env-файлом. Без неї `/photo` flow не працюватиме у dev, але всі інші сторінки (`/manual`, `/recent`, `/edit`, `/stats`) — так.

## Крок 1. Локальний клон і залежності

```powershell
git clone https://github.com/<your-org>/Finance-Tracker.git finance-tracker
cd finance-tracker
npm ci
```

`npm ci` інсталює root + усі workspaces (`web/`, `packages/domain/`, `supabase/functions/parse-receipt/`).

> Husky pre-commit hook налаштовується автоматично через `prepare` script у root `package.json`. Якщо клонуєш не у GitHub-Actions runner — переконайся що `git config core.hooksPath` дорівнює `.husky` (за замовчуванням так).

## Крок 2. Supabase project (опція A: використати існуючий)

Якщо ти приєднуєшся до проекту, що вже працює:

1. Попроси owner-а додати твій email у `app_users`:
   ```sql
   insert into public.app_users (email) values ('your-email@example.com');
   ```
2. Перейди до Кроку 4 (env-файл).

## Крок 2 (альтернатива). Supabase project (опція B: створити свій)

Якщо це новий fork / нове розгортання:

1. Створи проект на [supabase.com](https://supabase.com/dashboard) (free tier).
2. Запам'ятай project ref (32-hex chars з URL Studio).
3. Залогінься Supabase CLI:
   ```powershell
   npm install -g supabase    # або через npx, але глобально швидше
   supabase login
   ```
4. Лінкуй repo до проекту:
   ```powershell
   supabase link --project-ref <your-project-ref>
   ```
5. Apply migrations:
   ```powershell
   supabase db push
   ```
   Це застосує усі 3 файли з `supabase/migrations/` (schema, storage bucket, stats views).
6. Seed категорій:
   ```powershell
   supabase db reset --linked --no-seed=false
   ```
   або вручну через Studio SQL editor — copy-paste з `supabase/seed.sql`.
7. Додай свій email у `app_users` через Studio SQL editor:
   ```sql
   insert into public.app_users (email) values ('your-email@example.com');
   ```

## Крок 3. Регенерувати TypeScript-типи

Якщо схема змінювалась з останнього commit — обов'язково:

```powershell
$out = npx supabase gen types typescript --linked
[System.IO.File]::WriteAllText("$PWD\web\src\shared\types\database.types.ts", ($out -join "`n"), [System.Text.UTF8Encoding]::new($false))
```

Це UTF-8-без-BOM helper для Windows. На Linux/macOS — просто `npx supabase gen types typescript --linked > web/src/shared/types/database.types.ts`.

## Крок 4. Локальний `.env.local`

Скопіюй `web/.env.example` → `web/.env.local` і заповни:

```ini
# web/.env.local (gitignored)
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Анон-ключ візьми у Studio → Settings → API → anon key (public). **Не плутай з service_role key** — той ніколи не у frontend.

> Anon key public by design — він буде у browser bundle, видний у DevTools. Справжню авторизацію робить RLS + JWT (магічне посилання). Див. [deploy.md](deploy.md) "Authorization model".

## Крок 5. Sanity check

```powershell
npm run lint && npm run typecheck && npm run test && npm run build
```

Усі чотири мають бути зеленими. `npm run test` — ~155 тестів, <5с.

## Крок 6. Запустити dev-сервер

```powershell
npm run dev
```

Vite запустить на `http://localhost:5173`. HMR одразу — змінюй файли і дивись.

При першому відкритті:

1. Тебе перенаправить на sign-in форму.
2. Введи свій email → "Надіслати посилання".
3. Перевір пошту → клікни magic link → потрапляєш на `/auth/callback` → після ~1с redirect на `/`.
4. Якщо `app_users` має твій email — побачиш header з email + 4 кнопки на головній.
5. Якщо НЕ має — побачиш "Доступ заборонено" сторінку (RLS працює).

## Крок 7. Локальний Edge Function (опційно — для `/photo` flow)

`/photo` сторінка викликає Supabase Edge Function `parse-receipt`. Локально функція не запускається сама по собі.

**Опція A: проти live Edge Function** (вже задеплоєний у production, але `verify_jwt` пускає тебе як signed-in user'а):

Нічого додаткового не треба — `/photo` працюватиме напряму проти live функції. **Будь обережний** — кожен реальний виклик коштує Gemini tokens; для dev-iterations без реальних чеків це OK.

**Опція B: запустити функцію локально** (якщо хочеш дебажити):

1. Створи `supabase/.env.local`:
   ```ini
   GEMINI_API_KEY=AIza...
   ANTHROPIC_API_KEY=sk-ant-...    # опційно
   ```
2. Запусти:

   ```powershell
   supabase functions serve parse-receipt --env-file supabase/.env.local --no-verify-jwt
   ```

   `--no-verify-jwt` дозволяє локальні виклики без auth — спрощує дебаг. У production `verify_jwt = true` лишається.

3. У `web/.env.local` додай:
   ```ini
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   ```
   щоб supabase-js client дзвонив у локальний emulator (потребує `supabase start` для повного local stack — DB + Auth + Storage + Functions).

> Local stack-up — окрема історія. Поки що простіше: dev проти live Supabase project, Edge Function — або live, або не використовувати `/photo`.

## Крок 8. Production deploy

Окремий runbook — [deploy.md](deploy.md). Там покривається:

- 4 GitHub secrets для CI
- Cloudflare Pages bootstrap через wrangler
- Supabase Auth Site URL + Redirect URLs config
- `supabase functions deploy parse-receipt` + secrets
- Перший real-receipt smoke

## Крок 9. Onboarding другого користувача

Коли хочеш дати доступ нареченій / партнеру:

1. У Studio SQL editor:
   ```sql
   insert into public.app_users (email) values ('partner@example.com');
   ```
2. Поділись live URL (за замовчуванням `https://finance-tracker.pages.dev` або custom domain).
3. Партнер відкриває URL → вводить свій email → magic link у пошту → клікає → готовий.

Будь-який email що пройде magic-link отримає JWT, але дані з БД побачить тільки якщо є в `app_users`. RLS діє автоматично.

## Перевірка

- [ ] `npm run lint && typecheck && test && build` — все зелене
- [ ] `npm run dev` — Vite стартує на :5173
- [ ] Magic link sign-in працює end-to-end (поштова скринька → клік → авторизований)
- [ ] `/recent` показує "Поки що порожньо" (якщо нема даних) або список (якщо є)
- [ ] `/manual` save flow проходить без помилок (можна перевірити з тестовим чеком EUR/UAH)
- [ ] (Опційно) `/photo` flow проти live Edge Function — реальний чек, Gemini parse, save
- [ ] (Опційно) `/stats` після збереження кількох чеків показує чарти

## Цикл розробки

```powershell
# редагуй файли локально
npm run dev                  # HMR відбиває зміни одразу
npm run lint                 # ESLint
npm run typecheck            # tsc + tsr generate
npm run test                 # vitest (всі workspaces)
npm run format               # Prettier

git add .
git commit -m "..."          # husky pre-commit запустить prettier на staged files
git push                     # GitHub Actions автоматично deploy через ~2 хв
```

Pre-commit запускає Prettier через `lint-staged`. Lint+typecheck+test НЕ запускаються pre-commit (повний `npm run lint && typecheck && test` — щоразу занадто повільно). Натомість CI ставить gate перед deploy — якщо щось зламано, deploy не відбувається.

## Лінтинг

ESLint 9 flat config:

- `web/eslint.config.js` — React + TypeScript + React Hooks rules + `no-restricted-imports` для блокування прямого `supabase-client` за межами адаптерів і `**/api/**`.
- `packages/domain/eslint.config.js` — TypeScript + блокує `react`, `supabase-js`, `vite` imports (vendor-free пакет).
- Root `eslint.config.js` (опційно) для repo-wide rules.

Запуск: `npm run lint`. Auto-fix: `npx eslint . --fix` або `npm run format`.

Якщо ESLint помилково блокує валідний код — додай вузький disable-коментар (`// eslint-disable-next-line <rule>`) і подумай чи rule справді корисний (можливо, потрібно додати exemption у config).

## Тестування — три рівні

### Рівень 1: Domain unit-тести

`packages/domain/src/*.test.ts` — pure TS:

- `schemas.test.ts` — Zod валідація + cross-field invariants.
- `factories.test.ts` — makeReceipt/makeItem поведінка, edge cases (fx_rate boundary, discount > unit_price).
- `pair-detector.test.ts` — 16 тестів cancellation/discount grouping (ADR-0012).
- `money.test.ts`, `ulid.test.ts`, `time.test.ts`, `consumed-by.test.ts`.

### Рівень 2: Web unit + integration

`web/src/**/*.test.{ts,tsx}` — Vitest + jsdom + @testing-library/react:

- Adapter тести з `vi.mock('../supabase-client')`.
- Hook тести через `renderHook` + QueryClient wrapper.
- Component тести (render, interaction, snapshot — як треба).
- TanStack Router `<Link>` мокається через `vi.mock('@tanstack/react-router')`.
- Native `<dialog>` потребує `HTMLDialogElement.prototype.showModal/close` стабів у `beforeAll`.
- Chart.js НЕ покрито (jsdom не реалізує canvas) — manual smoke.

### Рівень 3: Edge Function (Vitest у Node)

`supabase/functions/parse-receipt/handler.test.ts` — handler.ts runtime-portable, тестується у Node.

Запуск всього: `npm run test` (root). Per-workspace: `npx vitest run --root web` або `npx vitest run --root packages/domain`. Single file: `npx vitest run path/to/file.test.ts`.

## Що НЕ покрито тестами (чесні межі)

- Real Supabase calls (RLS behavior, real magic-link flow, real Storage upload) — через manual smoke.
- Real Gemini / Claude calls — через manual `/photo` flow або `curl` проти live Edge Function.
- Visual / layout / responsive — через manual browser check.
- E2E (Playwright) — у backlog.

## Troubleshooting

Розширений список — [deploy.md "Troubleshooting"](deploy.md#troubleshooting). Часті при первинному setup:

- **"Cannot find package @finance-tracker/domain"** при `npm run dev` → запусти `npm ci` від кореня (не з `web/`).
- **Build падає з SyntaxError у `routeTree.gen.ts`** → не комітнутий generated файл. Запусти `npm run typecheck` (тригерить `tsr generate`).
- **`supabase` команди not found** → встанови глобально (`npm install -g supabase`) або префікс `npx`.
- **PowerShell `>` редірект ламає TS-файл** → використай UTF-8 helper (Крок 3).
- **Magic link редіректить на `localhost:5173`** замість production → Supabase Auth URL Configuration не оновлено для production. У dev це OK.
- **`/photo` повертає 401** → Edge Function `verify_jwt = true` блокує — переконайся що залогінений у dev. Або `supabase functions serve --no-verify-jwt` для local debug.
- **`/photo` повертає 403** → JWT валідний але email не у `app_users`. Studio SQL editor → insert.

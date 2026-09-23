# AGENTS.md

Цей файл — кореневі інструкції для Codex у Finance Tracker. Він доповнює, але не
замінює `CLAUDE.md`: обидва файли лишаються в репозиторії для сумісності з різними
coding agents.

## Перед початком роботи

- Для нетривіальної зміни спочатку перевір `git status --short --branch` і не
  перезаписуй сторонні або незакомічені зміни.
- Визнач актуальну поведінку з коду, тестів і конфігурації. Частина Markdown-файлів
  містить історичні знімки з травня–червня 2026 року, тому їхні кількості тестів,
  маршрутів, міграцій і фаз можуть бути застарілими.
- Порядок довіри при розбіжностях:
  1. `package.json` та workspace `package.json` — команди й версії;
  2. `supabase/migrations/` та `web/src/shared/types/database.types.ts` — фактична
     схема БД;
  3. `packages/domain/src/` — доменні типи, фабрики й інваріанти;
  4. `web/src/routes/` і `web/src/features/` — поточний UI та use cases;
  5. `docs/` і ADR-и — намір, пояснення та operational context.
- Якщо документація суперечить коду, не приховуй це: з'ясуй, що є актуальним, і
  або синхронізуй відповідний документ у межах задачі, або явно повідом про drift.
- `conversation.md` — історія початкового дизайну, а
  `code-review-tools-comparison.md` — історичний review experiment. Не трактуй їх
  як поточні інструкції.

## Що прочитати за типом задачі

- Загальна архітектура: `docs/architecture.md` і ADR-0013.
- Дані, RLS, precision та lifecycle: `docs/data-model.md` плюс фактичні міграції.
- Поточний handoff і відомі нюанси: `docs/project-status.md`; перевіряй його факти
  проти коду.
- Деплой або production troubleshooting: `docs/deploy.md`.
- Нова машина чи local stack: `docs/setup.md`.
- Розширення: `docs/extending.md` і найближчі за темою ADR-и.
- Cancellation/discount grouping: ADR-0012, ADR-0014 та ADR-0015 разом; новіший
  ADR має перевагу над superseded частиною старішого.

Не читай усі великі документи для вузької правки. Відкривай лише релевантні джерела
і перевіряй посилання на реальні файли.

## Поточна структура

- `web/` — React/Vite SPA. TanStack Router маршрути лежать у `web/src/routes/`, а
  вертикальні feature slices — у `web/src/features/`.
- `packages/domain/` — vendor-free TypeScript пакет з Zod-схемами, фабриками,
  money/qty/fx helpers, pair detection, bank-statement normalization і
  reconciliation.
- `supabase/` — imperative SQL migrations, seed, Storage/RLS та Edge Function
  `parse-receipt`.
- `supabase/functions/parse-receipt/` — Deno runtime з Gemini primary та Anthropic
  fallback; portable handler і provider tests запускаються через npm/Vitest.
- `legacy/apps-script/` — заморожений rollback reference. Не редагуй його без
  прямого запиту, що явно стосується legacy або rollback parity.

Активний SPA включає, зокрема, receipt CRUD, photo/manual JSON import, failed-parse
queue, waste tracking, statistics та reconciliation банківської виписки. Не
відновлюй стару архітектурну карту з `README.md` або `CLAUDE.md` без перевірки
поточних каталогів.

## Архітектурні правила

1. `packages/domain/` не імпортує React, Vite, Supabase або інший vendor runtime.
2. Routes і components залежать від feature hooks/services, а не від
   `supabase-client` напряму.
3. Прямі PostgREST-запити дозволені у `web/src/features/**/api/**`. Vendor adapters
   живуть у `web/src/shared/lib/<area>/`; публічні singleton-и проходять через
   `web/src/shared/lib/dependencies.ts`.
4. Feature boundary може мати `index.ts`, але не створюй каскад barrel-файлів
   усередині `components/`, `api/` або `hooks/`.
5. Postgres/supabase-js використовують `snake_case` end-to-end. Не додавай
   camelCase mapping layer без окремого архітектурного рішення.
6. Нові сутності створюй через доменні фабрики, якщо для них уже існує factory.
   Не дублюй rounding, ULID або derived-total logic у UI чи API hooks.

## Доменні інваріанти

- Money округлюється через `roundMoney` до 2 знаків, qty через `roundQty` до 3,
  fx rate через `roundFxRate` до 6.
- Item total: `round(qty * (unit_price_orig - discount_orig), 2)`; receipt EUR
  total фіксує audit-rate і не має непомітно перераховувати історію.
- `qty` додатна; negative financial rows моделюються через price/discount rules.
- Pair markers (`cancelled`, `discount-merged`, `aggregated`) — UI-only і не
  персистяться. Поведінку визначає `packages/domain/src/pair-detector.ts` та
  ADR-0012/0014/0015.
- `paid_by` і `consumed_by` — різні поняття; не змішуй платника з розподілом
  споживання.
- Reconciliation мусить лишатися one-to-one: один receipt не можна призначити двом
  statement rows. Повторний імпорт не повинен дублювати orphan transactions;
  зберігай `dedup_key`/`occurrence` semantics.
- Stub receipt із statement orphan не створює product і не пише `product_prices`.
- `product_name` в item — історичний snapshot; перейменування Product не переписує
  минулі Items.

## Supabase і безпека

- Проєкт використовує forward-only imperative migrations. Не редагуй committed
  migration; створи нову через перевірену команду CLI (`npx supabase migration
new <name>`, попередньо звіривши `npx supabase migration --help`).
- Не запускай `db push`, `db reset --linked`, production SQL, `functions deploy`,
  secret rotation або Cloudflare deploy без прямого дозволу користувача.
- Після schema change регенеруй
  `web/src/shared/types/database.types.ts`. У Windows не використовуй PowerShell
  `>` для TS-файлу, бо він може створити UTF-16. Використовуй UTF-8 без BOM:

  ```powershell
  $generatedTypes = npx supabase gen types typescript --linked
  [System.IO.File]::WriteAllText(
    "$PWD\web\src\shared\types\database.types.ts",
    ($generatedTypes -join "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
  ```

- Для кожної таблиці в exposed schema потрібні навмисні Data API grants/exposure
  та RLS policies. Наявність RLS і доступність таблиці через Data API — різні
  перевірки.
- Views, доступні клієнту, мають зберігати `security_invoker = on`, щоб не обходити
  RLS базових таблиць.
- `app_users` + `is_allowed_user()` — реальний authorization gate. Sign-in сам по
  собі не означає доступ до даних.
- Не винось `service_role`/secret keys у frontend, логи, Markdown або чат. Anon key
  є public client credential за дизайном, але його все одно не треба копіювати з
  локальних файлів у відповіді.
- Не переносити `.claude/settings.local.json` у Codex-конфігурацію. Це локальний,
  gitignored Claude permission file; він не є джерелом команд або секретів.

## AI Edge Function

- Client response обов'язково проходить `ParsedReceiptSchema`; provider-native
  structured output не замінює client-side validation.
- `supabase/functions/parse-receipt/types.ts` дзеркалить частину domain contract,
  бо Deno не резолвить workspace package так само, як Vite. При зміні parsed shape
  перевір обидва місця та відповідні тести.
- Не розкривай prompt/provider errors разом із ключами або повним sensitive payload.
- Документи одночасно називають legacy prompt frozen і вимагають prompt parity. Не
  редагуй `legacy/apps-script/` мовчки: якщо task змінює active prompt, явно вкажи
  цей конфлікт і узгодь потрібний рівень rollback parity.

## Команди

Запускай з кореня репозиторію:

```powershell
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
npm run format:check
```

Вузькі перевірки:

```powershell
npm --workspace @finance-tracker/web run lint
npm --workspace @finance-tracker/web run typecheck
npx vitest run --root web path/to/file.test.ts
npx vitest run --root packages/domain path/to/file.test.ts
npm --workspace @finance-tracker/parse-receipt-fn run test
deno check supabase/functions/parse-receipt/index.ts
deno lint supabase/functions/parse-receipt
```

TanStack `routeTree.gen.ts` згенерований і gitignored. Не редагуй його; workspace
scripts самі викликають `tsr generate` перед lint/typecheck/test/build.

## Перевірка змін

- Doc-only: запусти Prettier check принаймні для змінених Markdown-файлів.
- Domain logic: релевантні unit tests, потім root lint/typecheck/test.
- Web route, hook або component: релевантний Vitest path, lint, typecheck; build,
  якщо змінено routing, Vite config, env loading або bundling boundary.
- Edge Function: provider/handler tests плюс Deno check/lint, якщо Deno доступний.
- Schema/RLS: review migration, generated types, RLS/Data API exposure та
  application query path. Live behavior не вважай перевіреним без реального
  local/remote SQL test у дозволеному середовищі.
- Якщо Vitest у Codex Windows sandbox падає до старту тестів із `spawn EPERM`, це не
  test failure. Повтори той самий command із дозволом на child processes і окремо
  повідом фактичний результат.

Не заявляй, що production, RLS, magic link, Storage, Gemini/Anthropic або
Cloudflare перевірені, якщо запускав лише unit tests.

## Стиль і документація

- Документація та user-facing текст — українською. Код, identifiers, comments і
  commit messages — англійською.
- Файли: `kebab-case.ts` для logic/data, `PascalCase.tsx` для components,
  `use-<name>.ts` для hooks.
- Types замість enums у новому TypeScript-коді, якщо database/generated contract
  не вимагає enum.
- Коментарі пояснюють WHY: hidden constraint, workaround або non-obvious business
  rule. Не переказуй очевидний код.
- Не фіксуй у довготривалих інструкціях volatile counts без потреби. Якщо count
  важливий, обчисли його під час перевірки.
- Для нетривіального нового архітектурного рішення додай наступний ADR без
  перенумерації старих і онови `docs/decisions/README.md`.

## Git і завершення задачі

- Не коміть і не push без прямого прохання користувача.
- Не використовуй `git add .` у брудному worktree. Stage лише task-owned files і
  перевір `git diff --cached --name-only` та `git diff --cached --check` перед
  комітом.
- Перед handoff покажи, які файли змінились, які gates пройшли, що не вдалося
  перевірити, і чи залишився worktree dirty.

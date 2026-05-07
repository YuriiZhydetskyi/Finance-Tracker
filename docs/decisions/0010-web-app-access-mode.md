# ADR-0010: Web app access mode — `ANYONE` (signed-in Google account required)

- Status: superseded by [ADR-0013](0013-migrate-to-react-supabase.md) (2026-05-08)
- Date: 2026-05-04
- Revised: 2026-05-05 — додано server-side allowlist через `Config.ALLOWED_EMAILS` як real authorization gate (manifest `ANYONE` лишається). Див. Changelog.
- Superseded: 2026-05-08 — Apps Script web app deployment пішов; новий доступ через Supabase Auth + RLS allowlist (`app_users` table).

## Context and Problem Statement

Apps Script web app `webapp.access` controls who can hit the deployed URL. Phase 3 ships UI for two users (Юрій + наречена) on personal Gmail accounts. The default `MYSELF` blocks the second user; `DOMAIN` requires Google Workspace; `ANYONE_ANONYMOUS` makes the URL fully public without sign-in.

> **Naming gotcha.** Apps Script manifest enum values:
> - `MYSELF` — only the script owner.
> - `DOMAIN` — only members of the owner's Workspace domain.
> - `ANYONE` — anyone signed in to a Google account (matches the Deploy UI label *"Anyone with a Google account"*).
> - `ANYONE_ANONYMOUS` — anyone, including without sign-in (matches the Deploy UI label *"Anyone"*).
>
> The natural-language Deploy UI labels do **not** map 1:1 to the manifest enum names. `ANYONE` here means *signed-in*, not *unauthenticated*.

## Considered Options

1. **`MYSELF`** — script owner only.
2. **`DOMAIN`** — only users in the same Workspace domain.
3. **`ANYONE`** — any signed-in Google user who knows the URL.
4. **`ANYONE_ANONYMOUS`** — fully public, no sign-in required.

## Decision Outcome

Obrano **`ANYONE`** з `executeAs: USER_ACCESSING`.

Поєднання `executeAs: USER_ACCESSING` + `access: ANYONE` означає:
- Користувач мусить мати Google account і знати URL.
- Кожен запит запускається як цей користувач — `Session.getActiveUser()` повертає його email; `paid_by` коректно атрибутується.
- Cap'd vector: будь-хто залогінений в Google і з URL може записати в Sheet. Тому URL — **приватне посилання** (як Google Doc shared link), ділимось ним тільки з нареченою.

## Consequences

### Позитивні
- Двоє людей з різних personal Gmail можуть користуватись без Workspace.
- Native Google auth — не треба вигадувати свій логін.
- `Session.getActiveUser()` працює per-request і дає email атрибутацію.

### Негативні / гострі кути
- **URL — секрет**. Якщо хтось випадково вигуглить або URL потрапить у scrape — той хто має Google account зможе записати фейкові чеки. Мітигація: URL не публікуємо ніде, не комітимо у Git, не діли в Slack/Discord. У разі витоку — undeploy у Apps Script editor і re-deploy з новим URL.
- **`executeAs: USER_ACCESSING`** означає що OAuth scopes авторизуються кожним користувачем окремо. Перший вхід наречена побачить екран авторизації. Це нормально.
- **Audit trail** обмежений: Sheet bumps `created_at` per row, але не пише `created_by`. Якщо в майбутньому буде потреба — додати `created_by` колонку (per schema-evolution rule, в кінець листа).

## Alternatives detail

### MYSELF
- ✅ Найбезпечніше.
- ❌ Працює тільки для одного user — стає single-user app, нащо обоє не можуть юзати.

### DOMAIN
- ✅ Безпечно в межах Workspace.
- ❌ Personal Gmail не входить у Workspace — недоступний.

### ANYONE_ANONYMOUS
- ✅ Зручно.
- ❌ Анонімний bot може записати; немає `Session.getActiveUser()`. Не підходить для shared expense ledger.

## Operational notes

Після `npm run push` у Apps Script editor: **Deploy → New deployment → Type: Web app → Execute as: User accessing the web app → Who has access: Anyone with a Google account → Deploy**.

URL зберегти: Drive shortcut + закладки на телефонах. **НЕ** скидати у Git, чат, посилання.

Якщо потрібно змінити mode — оновити `src/appsscript.json` `webapp.access`, `npm run push`, **створити новий deployment** (старий URL продовжує працювати з попередньою конфігурацією до видалення).

---

## Changelog

### 2026-05-05 — Server-side allowlist

**Що змінилось:**
- `webapp.access` лишається `ANYONE` (sign-in required), але це більше не наша primary defense. Реальний gate — server-side allowlist у `Config.ALLOWED_EMAILS`. Кожен `Web.doGet` і кожен `google.script.run` endpoint порівнює `Session.getEffectiveUser().getEmail()` (case-insensitive) з цим списком.
- Не-allowlisted user отримує: на `doGet` — friendly "Доступ обмежено" HTML page (з email який намагався зайти); на runServer endpoints — кинутий `Error("Access denied for X")`, що клієнт показує через failure handler.
- `Web.whoAmI` тепер використовує `Session.getEffectiveUser()` замість `getActiveUser()`. getEffectiveUser працює надійно для personal Gmail коли `userinfo.email` scope авторизовано (у нас він є у `appsscript.json` з Phase 1).

**Чому:**
- Apps Script manifest enum НЕ має режиму "specific list of emails" — тільки MYSELF / DOMAIN / ANYONE / ANYONE_ANONYMOUS. Для двох personal Gmail акаунтів server-side check — єдиний робочий варіант.
- Раніше URL був де-факто секрет (anyone with link could write). Тепер навіть якщо посилання витече — write impossible without authorized email.

**Як змінити список:**
Edit `Config.ALLOWED_EMAILS` array у `src/Config.js`, потім `npm run push` + new version у Manage deployments.

**Тести:** `tests/web.test.js` має ~6 нових `Authz: ...` cases що покривають happy path, denied path, case-insensitive, anonymous, runServer endpoint guards.

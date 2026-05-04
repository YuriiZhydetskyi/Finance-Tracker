# ADR-0010: Web app access mode — `ANYONE` (signed-in Google account required)

- Status: accepted
- Date: 2026-05-04

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

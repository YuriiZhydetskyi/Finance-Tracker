# ADR-0002: Google Apps Script як runtime, clasp + Git як toolchain

- Status: superseded by [ADR-0013](0013-migrate-to-react-supabase.md) (2026-05-08)
- Date: 2026-05-04

## Context and Problem Statement

Маючи Google Sheets як сховище ([ADR-0001](0001-google-sheets-as-storage.md)), потрібен runtime для:
- HTTP-ендпоїнтів (upload фото, save receipt, update item),
- виклику Gemini API,
- запису у Sheet,
- віддачі HTML UI.

Цей runtime має бути дешевим, інтегруватись з Google акаунтом обох користувачів, і підтримувати нормальний dev-workflow (Git, версіонування, локальний редактор).

## Considered Options

1. **Google Apps Script** + `@google/clasp` для локальної розробки + Git.
2. **Cloudflare Workers** + Sheets API через service account.
3. **Azure Functions** + Sheets API.
4. **Self-hosted Node.js** на VPS.

## Decision Outcome

Обрано **Google Apps Script + clasp + Git**.

Apps Script web app деплоїться як standalone (не bound to Sheet) — це дає окремий URL і можливість керувати versioning/permissions незалежно від Sheet.

`clasp` забезпечує: локальний код у Git, `clasp push` для деплою, `clasp pull` для синхронізації якщо хтось правив у браузері.

## Consequences

### Позитивні
- Нативна інтеграція зі Sheet — `SpreadsheetApp` API без service-account гимнастики.
- Нуль хостингу, нуль конфігу, нуль білд-пайплайну.
- `Session.getActiveUser().getEmail()` дає identity користувача автоматично (за певних умов — див. нижче).
- `LockService` вирішує конкурентність "із коробки".
- `UrlFetchApp` для виклику Gemini API.
- `HtmlService` для віддачі UI.
- `clasp` дозволяє нормальний Git-workflow.

### Негативні / гострі кути
- **6-хвилинний ліміт на виконання `doGet`/`doPost`**. Photo→Gemini→Drive→Sheet за один запит зазвичай вкладається в 5–15 секунд, але треба тримати в голові.
- **20 000 URL Fetch/день** на consumer-аккаунті. Для двох людей — за межами реальності.
- **`google.script.run` НЕ є `fetch`** — це callback-API в HtmlService. Promise-обгортка потрібна (`shared/webapp.js` буде це робити). Див. [ADR-0005](0005-alpine-for-ui-no-build.md).
- **Service Worker не працює** в iframe Apps Script web app. PWA-маніфест дає home-screen icon, але **не offline**.
- **`Session.getActiveUser().getEmail()` повертає `""`** для personal Gmail без Workspace-домену. Тестується рано в Phase 1 — fallback робиться через explicit user-toggle у UI з `localStorage`.
- **`clasp login`** — OAuth flow з 2FA. Recovery procedure — у [setup.md](../setup.md).

### Якщо колись виходимо за межі
Якщо ліміти Apps Script стануть тісними або потрібен справжній offline — переносимо UI на **Cloudflare Pages SPA**, який стукає в JSON-ендпоїнти (Apps Script Functions or Cloudflare Workers + Sheets API). API-контракт залишається — UI замінюється.

## Pros and Cons of the Options

### 1. Apps Script + clasp + Git
- ✅ Нативна Sheet-інтеграція, нуль інфра, нуль витрат.
- ❌ 6-min timeout, callback API, нема Service Worker.

### 2. Cloudflare Workers + Sheets API
- ✅ Power-modern, edge-distributed, Promise-based.
- ❌ Service-account налаштування, JWT auth, складніший setup.

### 3. Azure Functions
- ✅ Free tier 1M викликів/міс, MS-екосистема.
- ❌ Cold starts, складніший setup, не дає переваг проти Cloudflare.

### 4. Self-hosted Node.js
- ✅ Повний контроль.
- ❌ VPS-плата, бекапи, моніторинг, security patches — overkill для двох людей.

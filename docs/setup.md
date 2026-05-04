# Setup — розгортання з нуля

Цей документ описує, як підняти проєкт на свіжій машині. Слідуючи кроком, ти повинен отримати робочий web app, доступний обом партнерам, без додаткових питань.

## Передумови

- Google акаунт (твій буде owner Sheet і Apps Script проєкту).
- Google акаунт нареченої — для розшарювання Sheet і деплою web app.
- Node.js ≥ 18 локально.
- Git локально.
- API key для Gemini з [aistudio.google.com](https://aistudio.google.com/) (безкоштовний tier достатньо).

## Крок 1. Локальний клон і залежності

```bash
git clone <repo-url> finance-tracker
cd finance-tracker
npm install   # підтягує @google/clasp у devDependencies
```

## Крок 2. clasp login

```bash
npx clasp login
```

Відкриється браузер для OAuth-флоу. Підтверди дозволи. clasp зберігає токен у `~/.clasprc.json`.

### Recovery procedure (якщо втратив токен / змінив машину)

```bash
npx clasp logout
npx clasp login
```

Знову OAuth flow. Перш ніж знову робити `clasp push` — переконайся, що `.clasp.json` (НЕ `.clasprc.json`) у репо вказує на правильний `scriptId`.

## Крок 3. Створення Google Sheet

1. Відкрий [sheets.new](https://sheets.new).
2. Перейменуй на `Finance Tracker`.
3. Створи 4 листи (вкладки): `Receipts`, `Items`, `Products`, `Categories`. Видали дефолтний `Sheet1`.
4. У кожному листі заповни заголовки колонок строго за схемою з [data-model.md](data-model.md). Один заголовок = одна клітинка в першому рядку.
5. У листі `Categories` заповни початковий seed (20 категорій з data-model.md).
6. Скопіюй Sheet ID з URL. URL виглядає як `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit` — потрібна частина між `/d/` і `/edit`.

> Курси валют (UAH→EUR) зберігаються **на самих чеках** як audit trail. Окремого листа `FxRates` немає — конвертація live при збереженні UAH-чеку через NBU API. Див. [ADR-0004](decisions/0004-multi-currency-eur-base.md).

## Крок 4. Створення Apps Script проєкту

```bash
npx clasp create --type webapp --title "Finance Tracker" --rootDir ./src
```

Це створить:
- Новий Apps Script проєкт у твоєму Drive.
- Файл `.clasp.json` локально з `scriptId`.
- Стартовий `appsscript.json` у `./src`.

Якщо `appsscript.json` уже існує — clasp не перезапише його.

### Ручне налаштування `appsscript.json`

```json
{
  "timeZone": "Europe/Berlin",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_ACCESSING",
    "access": "DOMAIN"
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/script.scriptapp"
  ]
}
```

Якщо твій акаунт — Personal Gmail (не Workspace), ймовірно `access: "ANYONE"` з обмеженням share-листа на дві email-адреси буде потрібен — див. крок 8.

## Крок 5. Налаштування Config.js

У `src/Config.js` (створиться у Phase 1) — задаси:

```javascript
const Config = {
  SHEET_ID: '<SHEET_ID з кроку 3>',
  DRIVE_FOLDER_ID: '<ID Drive-папки для фото; крок 6>',
  AI_PROVIDER: 'gemini',
  EMAIL_ALIASES: {
    'yurii@example.com': 'Я',
    'fiancee@example.com': 'Вона'
  }
};
```

## Крок 6. Drive-папка для фото

1. У Google Drive створи папку `FinanceTracker` → всередині `Receipts`.
2. Розшарь на email нареченої (Editor).
3. Скопіюй folder ID з URL (`https://drive.google.com/drive/folders/{FOLDER_ID}`).
4. Внеси у `Config.DRIVE_FOLDER_ID`.

Apps Script автоматично створюватиме підпапки `YYYY-MM/` всередині для організації по місяцях.

## Крок 7. Gemini API key

1. Зайди на [aistudio.google.com](https://aistudio.google.com/) тим самим Google-акаунтом.
2. Створи API key.
3. Через Apps Script editor (`clasp open`) → меню Project Settings → Script Properties → додай:
   - Key: `GEMINI_API_KEY`
   - Value: `<api key>`

**Не** клади ключ у код. Не комміть у Git.

## Крок 8. Розшарити Sheet

1. У Sheet → Share → додай email нареченої з правами Editor.
2. Підтверди.

## Крок 9. Перший push і deploy

```bash
npx clasp push    # завантажує src/* у Apps Script проєкт
```

Через `clasp open` → Deploy → New deployment:
- Type: Web app
- Description: "Finance Tracker MVP v0.1"
- Execute as: **User accessing the web app**
- Who has access: **Only myself** (поки тестуємо), потім переключити на **Anyone with Google account** з обмеженням через перевірку email на серверній стороні.

Скопіюй deployment URL — це буде вхідна точка для тебе і нареченої.

## Крок 10. Перевірка identity (Session.getActiveUser)

**Це треба зробити рано**, бо є відомий quirk: для personal Gmail без Workspace `Session.getActiveUser().getEmail()` повертає `""`.

У Phase 1 — перший smoke test:

```javascript
function testIdentity() {
  const email = Session.getActiveUser().getEmail();
  Logger.log(`Active user: "${email}"`);
}
```

Запусти з editor для свого акаунта — побачиш email або порожній рядок.

### Якщо повертає `""`

Fallback: при першому відкритті UI показуємо selector "Хто ти?" з обома іменами, зберігаємо в `localStorage`. `paid_by` береться з localStorage, не з `Session`.

Це треба буде закласти у `webapp.js` шаблон. Документуємо тут, щоб не забути.

## Крок 11. Додавання запису про себе у localStorage

Перший раз відкривши web app — у консолі браузера:

```javascript
localStorage.setItem('financeTracker.userEmail', 'yurii@example.com');
```

(Це лише на випадок проблеми з кроку 10. У стабільному UI ми зробимо це через UI-діалог.)

## Перевірка

- [ ] Sheet відкривається у тебе і нареченої з правами Editor.
- [ ] `clasp push` проходить без помилок.
- [ ] Web app deployment URL відкривається у тебе і нареченої.
- [ ] `testIdentity()` повертає твій email (або готовий fallback через localStorage).
- [ ] Drive-папка `FinanceTracker/Receipts` доступна обом.
- [ ] Gemini API ключ збережено у Script Properties.

## Подальша робота

З цього моменту цикл розробки:

```bash
# редагуєш src/* локально
npm run lint            # ESLint
npm run typecheck       # TypeScript checkJs (Apps Script API surface)
npm run test            # node:test (Domain + Storage + Fx + fixtures)
npm run push            # lint + typecheck + tests + clasp push
# тестуєш у браузері через deployment URL
git add . && git commit -m "..."
```

Якщо хтось правив код у браузері Apps Script — `npx clasp pull` синхронізує локально (рідкісний випадок; уникай).

### Linting

ESLint flat config у `eslint.config.mjs` ловить:
- **SyntaxError-и** включно з класичною JSDoc-міною — `*/` всередині `/** ... */` блоку (приклад з реального досвіду цього проєкту).
- **Виклики undefined globals.** Preset `globals.googleappsscript` знає Apps Script API: `SpreadsheetApp`, `UrlFetchApp`, `Utilities`, `LockService`, `XmlService`, тощо.
- **Cross-file project globals.** Apps Script ділить один глобальний scope, тому `Config`, `Domain`, `Storage`, `Fx`, `Smoke` (та Phase 2 заглушки `AiClient`, `Gemini`, `OpenAi`, `Anthropic`) задекларовані у конфігу.
- **Невикористані змінні** як warning. Префікс `_` ігнорується (`^_` rule) — для приватних helper-ів типу `_Config_requireProp`.

Команди:

| Команда | Що робить |
|---|---|
| `npm run lint` | ESLint для `src/` і `tests/` |
| `npm run typecheck` | `tsc --noEmit` — TypeScript checkJs з `@types/google-apps-script` |
| `npm run test` | `node --test` — усі тести (Domain unit + Storage/Fx integration + fixtures) |
| `npm run push` | lint + typecheck + tests + clasp push — **рекомендований** шлях |
| `npm run push:force` | clasp push без перевірок — escape hatch |

Якщо ESLint помилково заблокує валідний код — або `push:force`, або додай вузький disable-коментар (`/* eslint-disable-next-line no-undef */`) і подумай, чи rule справді корисний (можливо, бракує global у конфігу).

### Тестування — три рівні

#### Рівень 1: TypeScript checkJs

`tsconfig.json` із `allowJs: true`, `checkJs: true`, `strict: true` + `@types/google-apps-script`. Запускається `npm run typecheck`.

**Ловить:**
- Виклики неіснуючих Apps Script API (typo: `SpreadsheetApp.openId` замість `openById`).
- Wrong-type аргументи.
- Property access на nullable (з певними обмеженнями @types).

**Не ловить:**
- Runtime quirks, які @types не моделюють (приклад: `LockService.getDocumentLock()` повертає null для standalone — типи цього не показують).

`src/globals.d.ts` декларує project namespaces (Config, Domain, Storage, Fx, Smoke + Phase 2 заглушки) як `any`. Cross-module type safety — out of scope; мета — Apps Script API surface.

#### Рівень 2: Юніт- + integration-тести

`node --test` (Node-native, нуль зовнішніх раннерів). Структура:

| Файл | Що покриває |
|---|---|
| `tests/domain.test.js` | Domain pure logic (ULID, rounding, parsers, validators, factories) |
| `tests/storage.test.js` | Storage CRUD з in-memory FakeSpreadsheetApp, cascade delete, lock invocation |
| `tests/fx.test.js` | Fx ECB parser, NBU date helpers, getRate fallback |

**Apps Script fakes** — `tests/fakes/`. Самописні (250 рядків), не community libs:
- `SpreadsheetApp.js` — in-memory Sheet, getRange/setValues/appendRow/deleteRow.
- `UrlFetchApp.js` — stub-based, `_setStub(url, response)`.
- `LockService.js` — завжди success, з лічильником для асертів.
- `Session.js` — fixed email через `_setUserEmail`.
- `XmlService.js` — обгортка над `@xmldom/xmldom`.
- `DriveApp.js` — заглушка (не використовується в Phase 1).

`tests/bootstrap.js` ставить fakes + project модулі на `global` (Apps Script semantic), повертає accessors. Integration-тести роблять `require('./bootstrap')` замість `'./setup'`.

#### Рівень 3: Fixtures + drift detection

`tests/fixtures/` містить **реальні snapshots** ECB XML і NBU JSON. `tests/fixtures.test.js` асертить:

- ECB feed містить мажорні валюти (USD, JPY, GBP, CHF, PLN, CZK, HUF, CAD, AUD).
- ECB feed **НЕ** містить UAH (документована відсутність — мотивація NBU integration).
- USD rate у плавзих межах (sanity check).
- NBU response має правильну форму (`exchangedate` як DD.MM.YYYY).

Якщо ECB колись прибере GBP — тест почервоніє. Refresh fixtures:
```
curl https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml > tests/fixtures/ecb-daily-sample.xml
```

#### CommonJS shims

Кожен `src/*.js` закінчується:
```js
if (typeof module !== 'undefined') module.exports = { Module };
```

В Apps Script `module` undefined → no-op. У Node — exports для тестів. Без цього shim Node test runner не зміг би `require('../src/Storage')`.

#### Що тести **НЕ** ловлять (чесні межі)

- Real Apps Script behavior quirks, які наш fake не моделює (треба `tests/fakes/*.js` оновлювати при виявленні).
- API недоречно змінений @types (тип в `@types/google-apps-script` не збігається з реальним runtime).
- Schema drift у Sheet (відбувається лише runtime).
- Зовнішні API drift, окрім тих, що покриті fixture-тестами (ECB/NBU).

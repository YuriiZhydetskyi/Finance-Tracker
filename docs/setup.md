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
3. Створи 5 листів (вкладки): `Receipts`, `Items`, `Products`, `Categories`, `FxRates`. Видали дефолтний `Sheet1`.
4. У кожному листі заповни заголовки колонок строго за схемою з [data-model.md](data-model.md). Один заголовок = одна клітинка в першому рядку.
5. У листі `Categories` заповни початковий seed (20 категорій з data-model.md).
6. Скопіюй Sheet ID з URL. URL виглядає як `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit` — потрібна частина між `/d/` і `/edit`.

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
git add . && git commit -m "..."
npx clasp push
# тестуєш у браузері через deployment URL
```

Якщо хтось правив код у браузері Apps Script — `npx clasp pull` синхронізує локально (рідкісний випадок; уникай).

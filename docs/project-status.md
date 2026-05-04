# Project Status — Handoff Document

> **Призначення:** цей документ — точка входу для нової chat-сесії. Прочитавши його (і файли, на які він посилається), нова сесія матиме повний контекст і зможе продовжити роботу без перезапитування.

**Дата останнього оновлення:** 2026-05-04

---

## 1. Що це за проєкт

**Finance Tracker** — особистий фінансовий трекер для пари (користувач Юрій + наречена). Живуть у Берліні. Метa: фотографувати чеки → AI парсить на товари → редагуєш → зберігаєш у Google Sheet → бачиш аналітику. Плюс ручне введення онлайн-витрат. Плюс редагування минулих записів.

**Ключові вимоги:**
- Обоє користуються з телефона і ноутбука без власних додатків.
- Sheet — single source of truth, доступний обом.
- AI-розпізнавання чеків (Gemini 2.5 Flash) із розбиттям на line items.
- Підтримка EUR (база) і UAH (рідко, онлайн).
- Категоризація + опційний каталог продуктів для регулярних покупок.
- Аналіз: хто скільки витратив, на які категорії, скільки зекономили на знижках, скільки втратили на зіпсованому.

**Жорстко фіксований стек:**
- **Storage:** Google Sheets (4 листи: Receipts, Items, Products, Categories). Курси валют не зберігаються в окремому листі — конвертація live з NBU при збереженні UAH-чеку.
- **Runtime:** Google Apps Script web app (`clasp` + Git).
- **AI/OCR:** Gemini 2.5 Flash через AI Studio API (з тонкою AiClient-абстракцією для майбутньої заміни на OpenAI/Anthropic).
- **UI** (Phase 3): Alpine.js + Chart.js, без build-pipeline.
- **Мова:** документація українською; код / коментарі / JSDoc — англійською.

---

## 2. З чого почати нову сесію (read this first)

Прочитати у такому порядку:

1. **`docs/architecture.md`** — шари, потік даних, точки розширення (~1 стор.).
2. **`docs/data-model.md`** — авторитетна схема Sheet з усіма правилами (identity, money, FX fallback, locks, snapshots, schema evolution).
3. **`docs/decisions/`** — 9 ADR-ів. Особливо 0001 (Sheets), 0002 (Apps Script), 0003 (Gemini), 0004 (multi-currency), 0007 (Products).
4. **`docs/setup.md`** — 11 кроків розгортання з нуля. Користувач уже пройшов кроки 1–11.
5. **`docs/extending.md`** — рецепти на додавання категорій, листів, LLM-провайдерів, fakes, типів.
6. **Цей файл** — current state + next steps.

Опційно для розуміння історії:
- **`conversation.md`** — повний chat-log усіх дизайн-сесій (15+ повідомлень). Довгий, але задокументовано всі рішення з мотиваціями. Корисно якщо нова сесія хоче зрозуміти ЧОМУ щось зроблено саме так.

---

## 3. Поточний стан коду

### Структура репо

```
finance-tracker/
├── README.md
├── conversation.md                      ← повний chat-log (історія)
├── docs/
│   ├── project-status.md                ← ЦЕЙ ФАЙЛ
│   ├── architecture.md
│   ├── data-model.md
│   ├── setup.md
│   ├── extending.md
│   └── decisions/                       ← 9 ADR-ів (MADR short)
├── src/
│   ├── appsscript.json                  ← timezone Europe/Berlin, OAuth scopes
│   ├── globals.d.ts                     ← ambient declarations для tsc
│   ├── Config.js                        ← Script Properties getters + public constants
│   ├── Domain.js                        ← types, ULID, validators, factories
│   ├── Storage.js                       ← CRUD з LockService.getScriptLock
│   ├── Fx.js                            ← live NBU lookup для UAH (без зберігання курсів)
│   ├── Smoke.js                         ← 6 manual smoke tests
│   └── (Phase 2+: Gemini.js, AiClient.js, OpenAi.js, Anthropic.js)
│   └── (Phase 3+: Web.js, ui/*.html)
├── tests/
│   ├── bootstrap.js                     ← Apps Script fakes + project namespaces на global
│   ├── setup.js                         ← мінімальні стаби (Utilities.formatDate)
│   ├── domain.test.js                   ← 33 case
│   ├── storage.test.js                  ← 19 case
│   ├── fx.test.js                       ← 7 case (getRateLive + walk-back)
│   ├── fixtures.test.js                 ← 2 case (NBU shape drift detection)
│   ├── fakes/                           ← in-memory Apps Script services
│   │   ├── SpreadsheetApp.js
│   │   ├── UrlFetchApp.js
│   │   ├── LockService.js
│   │   ├── Session.js
│   │   ├── XmlService.js
│   │   ├── DriveApp.js
│   │   └── index.js                     ← installAllFakes / resetAllFakes
│   └── fixtures/
│       └── nbu-uah-sample.json          ← NBU response shape snapshot
├── .clasp.json                          ← scriptId, rootDir: ./src
├── .gitignore
├── .editorconfig
├── eslint.config.mjs                    ← flat config, Apps Script + Node globals
├── tsconfig.json                        ← allowJs + checkJs + strict
└── package.json
```

### npm scripts

| Команда | Дія |
|---|---|
| `npm run lint` | ESLint (src + tests) |
| `npm run typecheck` | tsc --noEmit (TypeScript checkJs) |
| `npm run test` | node --test (всі тести) |
| `npm run push` | lint + typecheck + test + clasp push (рекомендований) |
| `npm run push:force` | clasp push без перевірок (escape hatch) |
| `npm run pull` / `open` / `deploy` / `logs` | clasp wrappers |

### Тестова матриця

```
✅ npm run lint        → 0 errors, 0 warnings
✅ npm run typecheck   → 0 errors
✅ npm run test        → 69 pass / 0 fail (33 Domain + 19 Storage + 13 Fx + 7 fixtures)
```

### git state (на момент створення цього документа)

- Гілка `main`, ahead of origin/main by 2 commits (Phase 0 docs + Phase 1 backbone).
- **Незакоммічені зміни:** UAH-через-NBU фікс, getDocumentLock→getScriptLock фікс, 3 рівні тестів, ESLint оновлення, doc updates.
- Користувач збирається коммітити це зараз окремим коммітом (запропоновано: `Fix lock + UAH via NBU; add Domain unit tests` АБО трьома атомарними).

---

## 4. Що вже зроблено

### Phase 0 — Documentation foundation ✅ COMMIT 1

Усі docs у `docs/` написано і закоммічено:
- README.md
- architecture.md (шари, потік даних, точки розширення)
- data-model.md (повна схема + правила: ULID, money rounding, FX fallback, locks, snapshots, schema evolution)
- setup.md (11 кроків від zero до deployed)
- extending.md (8 рецептів: категорія, лист, LLM, поле, валюта, fake, types, promote-product)
- 9 ADR (MADR short): Sheets, Apps Script, Gemini, multi-currency, Alpine, separate pages, Products optional, prices computed, notes columns

### Phase 1 — Backbone ✅ COMMIT 2 + Незакоммічені фікси

**Зроблено і працює:**
- Sheet створено (SHEET_ID у Script Properties), 5 листів з заголовками за схемою, 20 категорій seed.
- Drive folder `FinanceTracker/Receipts/` (DRIVE_FOLDER_ID у Script Properties).
- Apps Script standalone webapp проєкт (scriptId у `.clasp.json`).
- clasp setup, npm scripts, ESLint flat config, TypeScript checkJs.
- 6 src файлів написано: appsscript.json, Config.js, Domain.js, Storage.js, Fx.js, Smoke.js.
- 4 test файли: domain (unit), storage (integration з fakes), fx (integration з fakes), fixtures (drift).
- Apps Script fakes — самописні, ~300 рядків.

**Незакоммічені зміни:**
- Звуження FX-скоупу до **EUR + UAH only**, видалення листа `FxRates` і ECB-інтеграції. Курси отримуються live з NBU при збереженні UAH-чеку (`Fx.getRateLive`); зберігаються тільки на самому чеку як audit (`fx_rate_eur`). Див. ADR-0004 changelog.
- Smoke `smokeFxBackfill` + `smokeFxLookup` замінено на `smokeFxLive`.
- Тести/fakes оновлено: `UrlFetchApp` fake тепер коректно поводиться при `muteHttpExceptions:true`.

### Phase 1 — User-side acceptance

- ✅ Script Properties встановлено (SHEET_ID, DRIVE_FOLDER_ID; GEMINI_API_KEY — для Phase 2).
- ✅ Smoke-тести зелені у Apps Script editor (lock fix + UAH через NBU підтверджено).
- ✅ `smokeIdentity` дав очікуваний результат (повідомлено користувачем; email повернувся).
- ⚠️ Після поточного рефакторингу (видалення FxRates) треба:
  - `npm run push` для деплою.
  - Запустити `smokeFxLive` у Apps Script editor — переконатись, що NBU live-fetch працює.
  - Видалити лист `FxRates` зі Sheet (вручну) — він більше не використовується.

---

## 5. Що треба зробити НЕГАЙНО (після початку нової сесії)

### 5.1. Деплоїти поточні зміни

```bash
npm run push     # lint + typecheck + test + clasp push
```

Після push: F5 у вкладці Apps Script editor.

### 5.2. Перевірити нову FX-логіку

У Apps Script editor → dropdown → запустити:
- `smokeFxLive` → очікую `EUR → EUR: 1` і `UAH → EUR: ≈0.022` (або близько; залежить від поточного курсу).
- `smokeReceiptRoundtrip` → "Roundtrip OK".
- `smokeLockService` → "Lock acquired … Lock released".

### 5.3. Прибрати лист `FxRates` зі Sheet (вручну)

Лист більше не використовується. Можна видалити його у Google Sheet (правий клік на вкладці → Delete). Не критично — ніщо в коді на нього не посилається.

### 5.4. Phase 1 acceptance criteria

Phase 1 вважається завершеною коли:
- [x] `smokeIdentity` дав визначений результат.
- [ ] Після поточного push — усі 6 smoke-тестів зелені.
- [ ] `smokeFxLive` повертає реалістичні курси (EUR=1, UAH≈0.022).
- [ ] `smokeReceiptRoundtrip` створює і прибирає тестовий receipt без сирітних рядків у `Receipts`/`Items`.

---

## 6. Що далі — Phase 2: Gemini integration

Деталізований план готується в окремій plan-сесії перед стартом. Скоуп:

### 6.1. AiClient + provider stubs

- `src/AiClient.js` — switch на 3 рядки за `Config.AI_PROVIDER`.
- `src/Gemini.js` — реалізація:
  - `parseReceipt(imageBytes, ctx) → ParsedReceipt`.
  - Виклик `generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` через `UrlFetchApp.fetch`.
  - API key з `Config.GEMINI_API_KEY` (Script Property).
  - Promp із JSON schema, structured output.
  - Контекст промпту: список категорій + список ~100 існуючих Products + обидва imena (his/hers) + store-aliases.
  - Temperature: 0.1 (детермінізм).
- `src/OpenAi.js`, `src/Anthropic.js` — заглушки з тією самою сигнатурою (`Error('Not implemented')`).

### 6.2. AI matching: 3 outcomes per item

Для кожного item у відповіді AI повертає:
- `existing_product_id` (якщо confidence ≥ 0.8) — лінк до існуючого Product.
- `proposed_canonical_name` — створити новий Product (товар явно канонічний).
- `null` — не каталогувати (commodity, one-off, ambiguous).

Евристика для null задокументована в ADR-0007.

### 6.3. Тести Phase 2

- `tests/gemini.test.js` — з мокованим UrlFetchApp і JSON-schema-сумісним response. Перевіряє shape ParsedReceipt.
- `tests/aiclient.test.js` — switch правильно делегує.
- Fixture: `tests/fixtures/gemini-receipt-response.json`.

### 6.4. Acceptance Phase 2

- Запустити `Gemini.parseReceipt` з тестовим фото в Apps Script editor.
- Bachelor: бачимо JSON із item-ами + match suggestions.

---

## 7. Що далі — Phase 3: Web UI

Найбільша фаза. Окремий plan перед стартом.

### 7.1. Сторінки (всі окремі HTML, спільні Alpine-компоненти — рішення в ADR-0006)

```
src/ui/
├── index.html              ← landing з 3 кнопками: Photo / Manual / Recent
├── photo.html              ← upload → parse → review → save (INSERT)
├── manual.html             ← порожня форма → save (INSERT)
├── edit.html               ← завантажити по ID → редагувати → save (UPDATE) / delete
├── recent.html             ← список останніх ~30 чеків з лінками на edit
└── shared/
    ├── ItemsTable.html     ← Alpine x-data: редагований список товарів
    ├── Summary.html        ← total + Chart.js pie chart категорій
    └── webapp.js           ← Promise wrapper над google.script.run
```

### 7.2. Web.js (`src/Web.js`)

- `doGet(e)` — роутинг сторінок через `e.parameter.page`.
- Функції викликаються через `google.script.run`:
  - `parseReceipt(base64, ctx)` → JSON
  - `saveReceipt(receiptData, items)` → receipt_id
  - `updateReceipt(receiptData, items)` → success
  - `getReceipt(id)` → Receipt + Items + Product info
  - `listRecent(limit)` → Receipt[]
  - `deleteReceipt(id)` → success

### 7.3. Гострі кути для Phase 3

- `google.script.run` callback API — обгорнути в `runServer(fnName, args) → Promise` у `webapp.js` (це задокументовано в ADR-0005).
- Service Worker не працює в iframe — PWA дає "add to home screen" icon, але **не offline**.
- HtmlService include для shared компонентів — нетривіальний `<?!= include('shared/ItemsTable') ?>` syntax. Тестується рано.
- Якщо `Session.getActiveUser` повернув `""` (див. 5.1) — додати UI-toggle "Хто ти?" з localStorage.
- Soft client-side timeout (~25с) на upload-photo, з friendly error UI.

### 7.4. Phase 3 acceptance

- Можна сфотографувати чек на телефоні, побачити пропоновані item-и, поправити їх, зберегти, побачити в Sheet.
- Можна вручну додати онлайн-витрату.
- Можна відкрити recent → клікнути → відредагувати → зберегти.
- Працює з обох акаунтів (твій + наречена).
- Web app deploy doable і дозволяє доступ обом email.

---

## 8. Phase 4 — Looker Studio dashboard

- Підключити Sheet як data source.
- Дашборд: витрати по місяцях, по категоріях, по користувачу, top-10 продуктів, тренди.
- Зекономлено vs втрачено (з `wasted_qty`).
- Зберегти у Drive поряд з Sheet.

Без коду. Окремий artefact у Looker.

---

## 9. Phase 5 — Polish

- `Errors` лист — логування помилок API/UI.
- Daily CSV backup у Drive (Apps Script time trigger).
- `prices.html` — search для live порівняння цін у магазинах.
- `products.html` — управління каталогом (rename, merge duplicates).
- Daily Gemini cost cap через `PropertiesService` counter.

---

## 10. Знайдені нюанси (lessons learned — не наступай знову)

1. **`LockService.getDocumentLock()` повертає `null` для standalone web apps**. Працює тільки для container-bound скриптів. Завжди `getScriptLock()` для нашого setup.
2. **`globals.googleappsscript` preset НЕ існує** в npm `globals` пакеті. Apps Script API treba listати вручну в ESLint config.
3. **ECB Reference Rates НЕ публікує UAH** (28 валют, верифіковано). Тому використовуємо NBU. У 2026-05-04 повністю перейшли на live-NBU без зберігання курсів — див. ADR-0004 changelog.
4. **JSDoc `*/` всередині `/** ... */`** закриває коментар передчасно і ламає parser. Уникати "Domain.make*/applyPatch" у коментарях.
5. **clasp create може покласти `.clasp.json` всередину `src/`** — переносити у корінь репо.
6. **Apps Script editor НЕ автооновлюється** після `clasp push`. F5 обов'язковий.
7. **`Session.getActiveUser().getEmail()` повертає `""`** для personal Gmail (не Workspace) — потрібен fallback через UI-toggle + localStorage.
8. **Cyrillic .sort() за code point** — `І` (U+0406) йде перед `А` (U+0410). Не за алфавітом!
9. **Float `0.1 + 0.2 = 0.30000000000000004`** — `Domain.roundMoney` округлює всі гроші на write до 2dp.
10. **Sheet cell limit 50 000 chars** — `raw_ocr_json` capped на 45 000 (validator throws).
11. **Service Worker НЕ працює** в Apps Script iframe — true offline неможливий. Тільки "Add to Home Screen".
12. **Function picker в Apps Script editor показує тільки top-level functions** — методи всередині `const Module = {}` не видно. Тому в Smoke.js і Fx.js є top-level wrappers.
13. **TypeScript flag `useUnknownInCatchVariables`** з strict mode ламає `catch(e) { e.message }` — disabled у tsconfig для legacy code.

---

## 11. Безпека / Workflow reminders

### Що ніколи не робиться

- ❌ API keys у код / у chat / у Git. **Завжди** у Apps Script Properties (server-side).
- ❌ SHEET_ID, DRIVE_FOLDER_ID у `Config.js` — теж у Script Properties (для портабельності).
- ❌ `git push` без `npm run push` (lint + typecheck + test).
- ❌ `npm run push:force` — лише в emergency.

### Що завжди робиться

- ✅ `npm run push` для deploy.
- ✅ F5 в editor після push.
- ✅ ADR при нетривіальному рішенні.
- ✅ Оновлення `data-model.md` при зміні схеми.

### Якщо API key витік у chat

1. aistudio.google.com/apikey → видалити старий.
2. Створити новий.
3. Покласти у Script Properties → НЕ показувати чату.

---

## 12. Open questions / decisions deferred

- **`smokeIdentity` result** — впливає на Phase 3 UI design. Чекаємо від користувача.
- **Phase 2 sample receipts** — потрібно ~5–10 фото реальних чеків для тестування Gemini промпту. Користувач збирає сам.
- **Looker Studio шаблон** — створювати з нуля чи знайти community template? Phase 4.
- **Subscriptions tracking** (ADR відкладено) — Phase 5 чи later.
- **Promote-item-to-product workflow** — Phase 5 при потребі.
- **Bank statement import** — out of MVP, можливо ніколи.

---

## 13. Як стартувати нову chat-сесію

1. Скажи новій сесії: "Read `docs/project-status.md` first, then read the docs it references in section 2."
2. Дай їй prompt: "Continue Phase X work — focus on [specific next step]."
3. Якщо потрібен історичний контекст рішень — `conversation.md` має повну розмову.

Plan-файл попередньої сесії живе у `~/.claude/plans/adaptive-jumping-puddle.md` — може бути переписаний новою задачею.

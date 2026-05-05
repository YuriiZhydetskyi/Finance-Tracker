# Project Status — Handoff Document

> **Призначення:** цей документ — точка входу для нової chat-сесії. Прочитавши його (і файли, на які він посилається), нова сесія матиме повний контекст і зможе продовжити роботу без перезапитування.

**Дата останнього оновлення:** 2026-05-05 (Phase 3.5 done)

---

## 1. Що це за проєкт

**Finance Tracker** — особистий фінансовий трекер для пари (користувач Юрій + наречена). Живуть у Берліні. Метa: фотографувати чеки → AI парсить на товари → редагуєш → зберігаєш у Google Sheet → бачиш аналітику. Плюс ручне введення онлайн-витрат. Плюс редагування минулих записів.

**Ключові вимоги:**
- Обоє користуються з телефона і ноутбука без власних додатків.
- Sheet — single source of truth, доступний обом.
- AI-розпізнавання чеків (Gemini Flash, `gemini-3-flash-preview`) із розбиттям на line items.
- Підтримка EUR (база) і UAH (рідко, онлайн).
- Категоризація + опційний каталог продуктів для регулярних покупок.
- Аналіз: хто скільки витратив, на які категорії, скільки зекономили на знижках, скільки втратили на зіпсованому.

**Жорстко фіксований стек:**
- **Storage:** Google Sheets (4 листи: Receipts, Items, Products, Categories). Курси валют не зберігаються в окремому листі — конвертація live з NBU при збереженні UAH-чеку.
- **Runtime:** Google Apps Script web app (`clasp` + Git).
- **AI/OCR:** Gemini Flash (`gemini-3-flash-preview`) через AI Studio API (з тонкою AiClient-абстракцією для майбутньої заміни на OpenAI/Anthropic).
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

Phase 1 — ✅ завершена. Усі 6 smoke-тестів зелені; UAH через NBU live працює; Receipts/Items round-trip працює; lock працює.

---

## 6. Phase 2: Gemini integration — ✅ implemented (потребує real-API verification)

### 6.1. Реалізовано

- [src/AiClient.js](../src/AiClient.js) — switch на 3 рядки за `Config.AI_PROVIDER`.
- [src/Gemini.js](../src/Gemini.js) — `parseReceipt(imageBytes, ctx)` (синхронний return). Дзвонить `gemini-3-flash-preview:generateContent` з inline-base64 image і `responseJsonSchema`. Pure helpers `_buildPrompt`, `_buildSchema`.
- [src/OpenAi.js](../src/OpenAi.js), [src/Anthropic.js](../src/Anthropic.js) — заглушки з ідентичною сигнатурою.
- [src/Domain.js](../src/Domain.js) — `ParsedReceipt`/`ParsedItem` typedefs + `validateParsedReceipt` (soft validator).
- [src/Smoke.js](../src/Smoke.js) — `smokeGeminiParse`: читає першу JPG з Drive folder, викликає Gemini, логує items.
- [tests/aiclient.test.js](../tests/aiclient.test.js), [tests/gemini.test.js](../tests/gemini.test.js) — 16 нових тестів (switch + prompt/schema/parseReceipt).

### 6.2. AI matching — НЕ в цій фазі

Gemini у Phase 2 повертає тільки `category_suggestion` (одна з категорій або null). Match до існуючих Products → UI-side у Phase 3. Простіше і дешевше per-request.

### 6.3. Acceptance Phase 2

- [x] `npm run lint`, `npm run typecheck`, `npm run test` — все зелене (74+ tests).
- [ ] `npm run push` → F5 в editor → запустити `smokeGeminiParse` з реальною JPG в Drive folder. Очікую: structured items з category_suggestion.
- [ ] (опційно) Перевірити, що неправильний API key дає чіткий error message з кодом і початком тіла відповіді.

### 6.4. Risk: Gemini cost / rate limits

Phase 5 polish — додати `daily_gemini_calls` counter через `PropertiesService` з cap (наприклад 100/день) для захисту від випадкового drain бюджету.

---

## 7. Phase 3: Web UI — ✅ implemented (потребує deploy + manual end-to-end)

### 7.1. Реалізовано

- [src/Web.js](../src/Web.js) — `doGet` + endpoints: `parseReceipt`, `saveReceipt`, `updateReceipt`, `getReceipt`, `deleteReceipt`, `listRecent`, `getCategories`, `listProducts`, `whoAmI`. Items-replace strategy (delete+append) для update — простіше за diff. FX перерахунок при зміні currency/date.
- [src/ui/index.html](../src/ui/index.html) — landing з 3 pill кнопками + identity modal (localStorage fallback для personal Gmail). **Edit `identityOptions` array** — підстав свої email і email нареченої.
- [src/ui/recent.html](../src/ui/recent.html) — листинг 30 останніх з лінками на edit.
- [src/ui/manual.html](../src/ui/manual.html) — форма з ItemsTable + Summary, save через `Web.saveReceipt`.
- [src/ui/photo.html](../src/ui/photo.html) — upload → клієнтський resize до 1600px (JPEG q=0.8) → `parseReceipt` → review → save (з photo upload у Drive).
- [src/ui/edit.html](../src/ui/edit.html) — load by ?id → ItemsTable → save через `updateReceipt` АБО delete з confirm.
- [src/ui/shared/](../src/ui/shared/) — head.html, webapp.html (`runServer` Promise wrapper), styles.html, ItemsTable.html, Summary.html.
- [src/Smoke.js](../src/Smoke.js) — `smokeWebRoutes`: dry-run doGet для всіх сторінок.
- [tests/web.test.js](../tests/web.test.js) — 23 нових тести (97 total). DriveApp fake тепер in-memory; HtmlService fake мінімальний.
- [src/appsscript.json](../src/appsscript.json) — `webapp.access: ANYONE_WITH_GOOGLE_ACCOUNT` per ADR-0010.

### 7.2. User-side acceptance (потрібно зробити)

1. **Налаштуй identity options.** У [src/ui/index.html](../src/ui/index.html) знайди `identityOptions` array і впиши свій email + email нареченої. Це quick-pick кнопки в "Хто ти?" modal — також доступно вільне введення.
2. **`npm run push`** — деплой змін.
3. **Smoke check.** У Apps Script editor → запусти `smokeWebRoutes`. Очікую: 5 рядків з preview контенту + один з warning для unknown page.
4. **Deploy as Web App.** У editor: Deploy → New deployment → Type: Web app → Execute as: User accessing → Who has access: **Anyone with a Google account** → Deploy. URL зберегти.
5. **Manual end-to-end:**
   - Відкрити URL → identity modal → вибрати свій email.
   - Photo: завантажити чек → перевірити що Gemini розпізнав items → save → у Sheet новий Receipt + Items, у Drive нове фото.
   - Manual: додати онлайн-витрату → save → recent показує.
   - Recent → клік на чек → edit → змінити category → save → у Sheet оновлено.
   - Recent → клік → edit → Delete → confirm → у Sheet receipt+items зникли.
6. **Поділись URL з нареченою.** Перший вхід — авторизує scopes; identity modal → вибрати її email. Подальші save'и приходять з її email у `paid_by`.

### 7.3. Гострі кути

- `Session.getActiveUser` повертає "" → fallback на localStorage в `index.html` modal (підтверджено для personal Gmail у Phase 1).
- HtmlService include — `<?!= include('shared/X') ?>` (note: `<?!=` без HTML-escape; `<?=` — з escape). `Web.include(name)` додає `ui/` префікс і використовує `createHtmlOutputFromFile` (raw, без re-evaluation) — це уникає nested-template eval, який ламає Apps Script Java-proxy. Shared files мають бути scriptlet-free; per-page scriptlets живуть у `<head>` кожної сторінки.
- Soft timeout у photo.html — 35с-ий setTimeout на UI-сторінці без cancel; повідомляє користувача якщо щось зависло. Cancel самого `google.script.run` Apps Script не дає.
- AI matching до існуючих Products — UI-side через `<datalist>` autocomplete у ItemsTable. AI повертає тільки `category_suggestion`. Promote-item-to-product workflow — Phase 5.

---

## 7.5. Phase 3.5 — Testing pyramid completion ✅ done (2026-05-05)

### Реалізовано

- **HtmlService fake тепер реальний evaluator.** [tests/fakes/HtmlService.js](../tests/fakes/HtmlService.js) обробляє `<? ?>`, `<?= ?>`, `<?!= ?>` проти template props через `with(__props__)`. Тести можуть assert-ити справжній render.
- **Render-truth assertions у `tests/web.test.js`** — 7 нових тестів:
  - `<base href>` populated from scriptUrl.
  - "no `<?` residue" регресія для всіх `Web.PAGES`.
  - Transitive include of shared/styles content.
  - shared/webapp script body present (transitive).
  - edit page queryParams meta carries id.
  - every page declares `<base target="_top">`.
- **JSDOM + Alpine UI tests.** [tests/uiHarness.js](../tests/uiHarness.js) рендерить кожну сторінку, ставить stub-и над `google.script.run`, evaluates Alpine source. [tests/ui.test.js](../tests/ui.test.js) — 11 тестів (per-page Alpine boot smoke + identity flow + recent listing + edit form populate + photo file input + manual form).
- **`tests/fakes/ScriptApp.js`** — мінімальний fake для `ScriptApp.getService().getUrl()`.
- **Bootstrap exposes top-level `include`** функцію на global, щоб scriptlets ходили через справжній `Web.include`.
- **Навігаційний фікс довершено.** Inline `<head>` у всіх 5 сторінках; `shared/head.html` видалено; `shared/webapp.html` читає SCRIPT_URL з `<base href>` і QUERY_PARAMS з `<meta>`. Scriptlets ТІЛЬКИ в HTML-атрибутах (IDE не флагує errors).

### Test counts

```
✅ npm run lint        → 0 errors, 0 warnings
✅ npm run typecheck   → 0 errors
✅ npm run test        → 113 pass / 0 fail
                        (33 Domain + 19 Storage + 13 Fx + 7 fixtures
                         + 4 AiClient + 12 Gemini + 25 Web + 11 UI)
```

### Accepted ceiling

- Apps Script `HtmlTemplate` Java-proxy quirks (e.g. methods becoming unreachable after custom property assignment) **не відтворюються** plain-JS evaluator-ом. Mitigation — sub-block C (опційний `npm run smoke` через Apps Script Execution API). Не зроблено у цій ітерації; додамо коли часті релізи стануть нормою.
- JSDOM ≠ браузер: file pickers, layout, real iframe postMessage, real google.script.run cross-frame — не симулюються. Stub-имо `runServer`. Catch logic, не visual.

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
14. **Fake stub trap.** Phase 3 пройшла 97 локальних тестів зеленими, але двічі впала на live deploy. Корінь: `tests/fakes/HtmlService.js` була no-op заглушкою, що ніколи не обчислювала scriptlets. Після Phase 3.5 — fake реально парсить `<?= ?>` / `<?!= ?>` / `<? ?>`. Урок: stub-only fakes ловлять контракт, не семантику; для UI рендера потрібен працюючий evaluator.
15. **Apps Script HtmlTemplate — Java-проксі.** Встановлення custom properties (`tpl.scriptUrl = '...'`) на ньому всередині nested template eval ламає prototype lookup — `tpl.evaluate is not a function`. Тому Web.include використовує `createHtmlOutputFromFile` (raw), а scriptlets живуть тільки на верхньому рівні page template. JS evaluator у тестах цей quirk не повторює — це accepted ceiling, mitigated by smokeWebRoutes у real Apps Script.
16. **`<a href="?page=...">` всередині Apps Script iframe** навігує googleusercontent.com (хост iframe), а не parent script.google.com (хост web app). Фікс: `<base href="<?= scriptUrl ?>" target="_top">` у `<head>` кожної сторінки.
17. **Apps Script web app access modes naming** — manifest `ANYONE` = Deploy UI label "Anyone with a Google account" (sign-in required). `ANYONE_ANONYMOUS` = справжній публічний без auth. ADR-0010 фіксує цей quirk. Manifest enum НЕ приймає `ANYONE_WITH_GOOGLE_ACCOUNT`.

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

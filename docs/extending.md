# Extending — рецепти на розширення

> Цей документ — список **чеклістів**. Кожен рецепт — нумеровані кроки, які можна виконати без розкопок коду.

Перш ніж щось додати — переконайся, що:
- Зміна не порушує [schema-evolution rule](data-model.md#schema-evolution-rule) (додавати тільки в кінець листа).
- Якщо зміна не очевидна — створи новий ADR у [decisions/](decisions/) перед кодом.

---

## Рецепт 1: Додати категорію

**Сценарій:** Після року використання помічаєш, що "Інше" має забагато записів — потрібна нова категорія "Догляд за домашніми тваринами".

1. Відкрий Google Sheet → лист `Categories`.
2. Додай новий рядок: `name = "Тварини"`, `group = "Побут"`.
3. Готово. AI підхопить нову категорію в наступному парсі (бо `Config.js` бере список з Sheet).

**Не треба:** змінювати код, деплоїти, перебудовувати.

> **Корисна порада для німецьких чеків.** Додай категорію `name="Pfand"`, `group="Побут"` (або `"Інше"`) — Gemini промпт автоматично присвоюватиме її depositним рядкам ("Pfand", "Leergut Entl.allg.", "Leergut Einw.allg.") і refund-рядкам тари. Без цієї категорії вони припадуть на `null` і потребуватимуть ручного assign-ення в UI перед save.

---

## Рецепт 2: Додати новий лист (наприклад, `Subscriptions`)

**Сценарій:** Хочеш окремо відстежувати підписки з періодичністю (місячні / річні), щоб бачити "сумарне навантаження на місяць".

1. **Документація.** Додай схему листа в [data-model.md](data-model.md): кожна колонка з типом, форматом, прикладом.
2. **ADR.** Якщо рішення нетривіальне (наприклад, як модельувати recurring vs. one-time) — створи ADR у `docs/decisions/`. Інакше можна без ADR.
3. **Sheet.** Створи лист у Google Sheet з заголовками точно як у data-model.md.
4. **JSDoc типи.** Додай у `src/Domain.js`:
   ```javascript
   /**
    * @typedef {Object} Subscription
    * @property {string} id - ULID
    * @property {string} name
    * @property {number} amount_eur
    * @property {'monthly'|'yearly'} period
    * @property {string} started_at - ISO 8601
    * @property {?string} canceled_at
    */
   ```
5. **Storage.** Додай функції в `src/Storage.js`:
   ```javascript
   function appendSubscription(sub) { /* ... */ }
   function listSubscriptions() { /* ... */ }
   function updateSubscription(id, patch) { /* ... */ }
   ```
   Не забудь обгорнути multi-row writes у `LockService.getScriptLock()` (`getDocumentLock()` повертає null для standalone скриптів).
6. **Web.js.** Додай функції-handlers, що викликаються через `google.script.run`:
   ```javascript
   function saveSubscription(data) {
     Domain.validateSubscription(data);
     return Storage.appendSubscription(data);
   }
   ```
7. **UI.** Додай нову HTML сторінку (`subscriptions.html`) і кнопку в `index.html`.
8. **Looker Studio.** Підключи новий лист як datasource (Phase 4 dashboard).

---

## Рецепт 3: Заміна LLM-провайдера (Gemini → OpenAI / Anthropic)

**Сценарій:** Anthropic випустив model 5.0 і ти хочеш спробувати її замість Gemini для парсингу чеків.

Reference implementation: [src/Gemini.js](../src/Gemini.js) (Gemini 3 Flash через `responseJsonSchema`).

1. **Реалізуй провайдер у заглушці.** Файл `src/Anthropic.js` уже існує як заглушка з ідентичною сигнатурою:
   ```javascript
   /**
    * @param {number[] | string} imageBytes - bytes from Blob.getBytes() or pre-encoded base64
    * @param {{categories: string[], products: Product[]}} ctx
    * @returns {ParsedReceipt}
    */
   parseReceipt(imageBytes, ctx) {
     // Замінити Error('Not implemented') на реальний виклик Anthropic API
   }
   ```
   Реалізуй виклик `https://api.anthropic.com/v1/messages` через `UrlFetchApp.fetch`. Серверна сторона **синхронна** (UrlFetchApp блокує) — повертай `ParsedReceipt` напряму, не Promise. Перед `return` обов'язково виклич `Domain.validateParsedReceipt(parsed)` — як це робить `Gemini.parseReceipt`.
2. **Будуй промпт і schema через ті самі ctx-параметри.** Дивись `Gemini._buildPrompt(ctx)` і `Gemini._buildSchema(ctx)` — приклади pure helpers, які тестуються окремо.
3. **API key.** У Apps Script editor → Project Settings → Script Properties → додай `ANTHROPIC_API_KEY`. У `Config.js` додай геттер за аналогією з `GEMINI_API_KEY`.
4. **Переключи провайдера.** У `src/Config.js` зміни:
   ```javascript
   AI_PROVIDER: 'anthropic'  // було 'gemini'
   ```
5. **Тести.** Скопіюй `tests/gemini.test.js` як `tests/anthropic.test.js`, адаптуй endpoint/response shape до Anthropic API.
6. **Push:** `npm run push`.
7. **Тест у Apps Script:** запусти `smokeGeminiParse` (можна перейменувати, але не обов'язково — він викликає `AiClient.parseReceipt`, не Gemini напряму).

**Не треба:** чіпати UI, Storage, Domain (окрім додавання нового геттера в Config), Web. Тільки провайдерський файл, Config-getter і опційно тести.

---

## Рецепт 4: Додати поле в існуючий лист

**Сценарій:** Хочеш додати `tax_amount` колонку в `Receipts` (для бухгалтерії в майбутньому).

1. **Schema-evolution rule.** Додавай тільки **в кінець** листа. Не переставляй.
2. **Документація.** Додай рядок у таблицю `Receipts` в [data-model.md](data-model.md): тип, формат, nullability, приклад.
3. **Sheet.** У листі `Receipts` додай нову колонку **в кінці** — після останньої існуючої. Заголовок — точно як у data-model.md.
4. **Domain.** Якщо поле обов'язкове — додай у JSDoc-тип `Receipt` і у `Domain.validateReceipt()`. Якщо опційне — лише в JSDoc.
5. **Storage.** Storage-код посилається на колонки **за іменем** (через map header→index при init), тому додавання колонки в кінець — безпечно. Просто розшир `appendReceipt()` і `getReceipt()`, щоб включали нове поле.
6. **AI prompt (якщо AI має заповнювати поле).** Розшир Gemini-промпт у `Gemini.js` — додай поле в JSON schema і в evidence-приклади.
7. **UI.** Додай поле в edit/manual форми, якщо потрібно.
8. **Backfill (для існуючих рядків).** Якщо поле обов'язкове, треба заповнити старі рядки якимось дефолтом — або змінити тип на nullable і поступово заповнити при наступних редагуваннях. Скрипт-помічник у `Apps Script editor`:
   ```javascript
   function backfillTaxAmount() {
     const sheet = SpreadsheetApp.openById(Config.SHEET_ID).getSheetByName('Receipts');
     // ... fill empty cells with 0 or computed value
   }
   ```

---

## Рецепт 5: Promote item → product (майбутнє, поки не реалізовано)

**Сценарій (post-MVP):** Помічаєш, що часто купуєш "Помідори чері Aldi 250g" — хочеш почати трекати ціну на них.

Поки не реалізовано в MVP. Коли робимо:
1. У `recent.html` або `edit.html` — додаємо кнопку "Promote to Product".
2. На клік — створюється новий `Product` з даних item; `item.product_id` оновлюється.
3. Опційно: fuzzy-search схожих історичних items без `product_id`, пропонує лінкувати партіями.

Створи ADR-XXXX перед реалізацією.

---

## Рецепт 6: Додати нову валюту

**Сценарій:** Поїхали в Польщу, треба підтримка PLN.

> Поточно підтримуються тільки **EUR (база) + UAH (через NBU)**. Інші валюти треба додавати точково в `Fx.getRateLive`. Це усвідомлене рішення — див. [ADR-0004](decisions/0004-multi-currency-eur-base.md).

1. **Знайди джерело курсу для нової валюти.** Варіанти:
   - ECB Reference Rates — `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` (PLN, USD, GBP, JPY, CHF, CZK, HUF, ... ~30 валют). Не містить UAH, RUB.
   - NBU — тільки UAH.
   - Інші API — новий ADR з обґрунтуванням.
2. **Розшир `Fx.getRateLive`** у [src/Fx.js](../src/Fx.js):
   ```javascript
   getRateLive(currency, date) {
     if (currency === Config.BASE_CURRENCY) return 1.0;
     if (currency === 'UAH') return Fx._fetchNbuUahRate(date);
     if (currency === 'PLN') return Fx._fetchEcbRate('PLN', date);  // нова гілка
     throw new Error(`FX lookup not supported for "${currency}". ...`);
   }
   ```
3. **Реалізуй fetcher.** Додай приватну функцію `_fetchEcbRate(currency, date)` яка робить `UrlFetchApp.fetch` на ECB feed, парсить XML (через `XmlService`), повертає `Domain.roundFxRate(1 / ecb_rate)`. Не забудь fallback на попередні дні (як `_fetchNbuUahRate`).
4. **Тести.** У [tests/fx.test.js](../tests/fx.test.js) додай case для нової валюти зі stubbed XML.
5. **Тестовий чек.** Створи manual receipt з `currency: 'PLN'`. Переконайся, що `fx_rate_eur` і `total_eur` коректні.

**Альтернатива:** якщо потрібна підтримка ~5+ валют одночасно — є сенс повернутись до архітектури з листом `FxRates` + daily fetch (це було реалізовано до 2026-05-04, дивись історію в Git і ADR-0004 changelog).

---

---

## Рецепт 7: Додати fake для нового Apps Script API

**Сценарій:** Додаєш код, який викликає `CalendarApp` чи `MailApp`. Тести падають із "X is not defined".

1. Створи новий fake у `tests/fakes/X.js` за шаблоном:
   ```js
   function makeFakeX() {
     return {
       someMethod(args) { /* in-memory implementation */ },
       _reset() { /* reset state */ },
     };
   }
   module.exports = { makeFakeX };
   ```
2. Додай в `tests/fakes/index.js`:
   - `const { makeFakeX } = require('./X');`
   - У `installAllFakes`: `_fakes.X = makeFakeX(); global.X = _fakes.X;`
   - У `resetAllFakes`: `_fakes.X._reset();`
3. Додай global у `eslint.config.mjs` (APPS_SCRIPT_GLOBALS): `X: 'readonly'`.
4. Додай global у `src/globals.d.ts` для tsc (опційно, якщо tsc починає скаржитись).
5. Тести можуть тепер використовувати `fakes.X.someMethod(...)`.

---

## Рецепт 8: Замінити `any` на справжні типи в `globals.d.ts`

**Сценарій:** Хочеш cross-module type safety поверх API surface checking. Розширений варіант Рівня 1 тестування.

1. У `src/globals.d.ts` заміни:
   ```ts
   declare var Domain: any;
   ```
   на:
   ```ts
   declare interface DomainModule {
     ulid(): string;
     roundMoney(value: number): number;
     // ... (мати сигнатури з src/Domain.js)
   }
   declare var Domain: DomainModule;
   ```
2. Запусти `npm run typecheck`. Виправ помилки в коді, що випливуть з вузьких типів.
3. Те саме для решти модулів.

Це YAGNI до моменту, коли cross-module баги стають частими. Поки ESLint + smoke tests + integration tests ловлять достатньо.

---

## Рецепт 9: Додати нову UI сторінку

**Сценарій:** Хочеш окрему сторінку `prices.html` для пошуку товару у каталозі і порівняння цін у магазинах (Phase 5 polish).

1. **HTML файл.** Створи `src/ui/prices.html` за шаблоном існуючих:
   ```html
   <!DOCTYPE html>
   <html lang="uk">
   <head>
     <?!= include('shared/head') ?>
   </head>
   <body x-data="pricesPage()" x-init="init()" x-cloak>
     <div class="topbar">
       <a href="?page=index">← Назад</a>
     </div>
     <main>
       <h1>Ціни</h1>
       <!-- ... -->
     </main>
     <script>
       function pricesPage() {
         return {
           async init() { /* ... */ },
         };
       }
     </script>
   </body>
   </html>
   ```
   Завжди підключай `shared/head` — це налаштує Alpine + `runServer`. Reusable компоненти: `<?!= include('shared/ItemsTable') ?>`, `<?!= include('shared/Summary') ?>`.

2. **Зареєструй сторінку.** У [src/Web.js](../src/Web.js) додай ім'я в `Web.PAGES` array. Без цього doGet відправить на `index` як unknown page.

3. **Server endpoint (опц.).** Якщо сторінка кличе нову server-функцію — додай її як метод на `Web` об'єкті, додай top-level wrapper, додай у `/* exported ... */`. Тести (`tests/web.test.js`) — за паттерном існуючих.

4. **Лінк.** Додай посилання у `src/ui/index.html` (pill-buttons block) або з якоїсь іншої сторінки.

5. **Smoke + тест.** `smokeWebRoutes` автоматично підхопить нову сторінку (читає `Web.PAGES`). Локальний тест у `tests/web.test.js`:
   ```js
   test('Web.doGet: prices page renders', () => {
     setupSheet();
     const out = Web.doGet({ parameter: { page: 'prices' } });
     assert.match(out.getContent(), /ui\/prices/);
   });
   ```

**Не треба:** торкати Storage / Domain / Fx якщо логіка існуючих сутностей не змінюється. Сторінка — це тонкий клієнт над уже існуючими endpoints.

---

## Рецепт 10: Додати UI-тест для нової сторінки

**Сценарій:** Створив `prices.html` (Recipe 9). Хочеш ловити Alpine init regressions і broken click handlers локально, без push до Apps Script.

1. **Базовий smoke вже є.** [tests/ui.test.js](../tests/ui.test.js) має `UI: every page boots Alpine without throwing` — він автоматично ітерує `Web.PAGES`. Якщо новий `prices` додано в `Web.PAGES`, він уже вкритий цим тестом.
2. **Додай специфічний тест:**
   ```js
   const { renderPage } = require('./uiHarness');

   test('UI prices: search returns matching products', async () => {
     const { document } = await renderPage({
       page: 'prices',
       runServerStubs: {
         whoAmI: () => 'me@x',
         searchPrices: (q) => [
           { product_name: 'Молоко 1L', store: 'Lidl', avg_price: 0.99 },
         ],
       },
     });
     // Trigger Alpine model update via input event:
     const input = document.querySelector('input[x-model="query"]');
     input.value = 'мол';
     input.dispatchEvent(new document.defaultView.Event('input'));
     await new Promise(r => setTimeout(r, 20));
     // Now assert results render.
     assert.match(document.body.textContent, /Молоко 1L/);
   });
   ```
3. **Що stub-ити:** будь-який endpoint, який сторінка викликає через `runServer(...)` у `init()` чи в обробниках. Не stub-нутий → harness кидає `runServer stub missing for "X"`.
4. **JSDOM не браузер.** Тест ловить логіку, не layout/visual. Real-Apps-Script проблеми (Java-proxy, iframe sandbox) ловить лише `smokeWebRoutes`.

---

## Out of MVP — потенційні майбутні фічі

Перелічуємо, щоб майбутній-ти не починав з нуля. **НЕ** реалізовуй це поки не з'явиться явна потреба.

- **Settlements** (хто кому винен). Окрема таблиця `Settlements`, новий ADR.
- **Bulk історичний імпорт** (наприклад, з банківських виписок CSV).
- **True offline (Service Worker)**. Вимагає переходу на Cloudflare Pages SPA.
- **Promote item → product** з backfill схожих історичних items.
- **Products management** сторінка (`products.html`) для merge duplicates.
- **Bank statement import** з CSV/PDF.
- **Multi-event spoilage** (заміна `wasted_qty` колонки на таблицю `Spoilage`).
- **ProductPrices матеріалізована таблиця** (тільки якщо аналітика стане повільною).
- **Audit log** (хто/коли редагував рядок).
- **Soft-delete з `deleted_at`** (тільки якщо знайдемо use-case).
- **Daily Gemini cost cap** через `PropertiesService` counter (Phase 5 polish).

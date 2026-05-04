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

1. **Реалізуй провайдер у заглушці.** Файл `src/Anthropic.js` уже існує як заглушка з ідентичною сигнатурою:
   ```javascript
   /**
    * @param {Uint8Array} imageBytes
    * @param {ParseContext} ctx
    * @returns {Promise<ParsedReceipt>}
    */
   function parseReceipt(imageBytes, ctx) {
     // Замінити Error('Not implemented') на реальний виклик Anthropic API
   }
   ```
   Реалізуй виклик `https://api.anthropic.com/v1/messages` через `UrlFetchApp`. Дотримуйся повернення `ParsedReceipt` точно як його повертає `Gemini.js` — це контракт з `AiClient`.
2. **API key.** У Apps Script editor → Project Settings → Script Properties → додай `ANTHROPIC_API_KEY`.
3. **Переключи провайдера.** У `src/Config.js` зміни:
   ```javascript
   AI_PROVIDER: 'anthropic'  // було 'gemini'
   ```
4. **Push:** `npx clasp push`.
5. **Тест:** Відкрий photo.html → завантаж тестовий чек → переконайся, що `ParsedReceipt` повертається у тому ж форматі і UI рендерить його коректно.

**Не треба:** чіпати UI, Storage, Domain, Web. Тільки провайдерський файл і Config.

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

1. **Перевір ECB.** PLN є в [ECB Reference Rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html). Якщо немає — потрібне альтернативне джерело (новий ADR).
2. **Перевір `Fx.js`.** Daily fetch має бути конфігурований підтягувати курси для всіх валют, які можуть з'явитись. Зазвичай ECB CSV/XML feed містить ~32 валюти автоматично — нічого додавати не треба.
3. **Тестовий чек.** Створи manual receipt з `currency: 'PLN'`. Переконайся, що:
   - `fx_rate_eur` коректно підставляється з `FxRates`.
   - `total_eur = round(total_orig * fx_rate_eur, 2)` відображається коректно.
4. Готово. Жодних змін у схемі чи коді.

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

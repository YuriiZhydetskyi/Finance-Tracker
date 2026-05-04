# Обговорення проєкту Finance Tracker

Дата початку: 2026-05-03

---

## Повідомлення 1 — Користувач

Я хочу зробити один проєкт, але треба з тобою про все порадитись, обговорити. Тому я пропоную, щоб ти записував у окремий md файл нашу розмову: все, що я тебе питаю і що ти відповідаєш. Ми дослідимо проблему і придумаємо як можемо її вирішити. Гаразд?

## Відповідь 1 — Claude

Гаразд, домовились. Я створив файл [conversation.md](conversation.md) у корені проєкту і буду записувати туди все наше обговорення — твої повідомлення і мої відповіді — у хронологічному порядку.

Кілька уточнень, щоб я краще тебе зрозумів:

1. **Про який проєкт йдеться?** З назви папки бачу "Finance Tracker" — це трекер особистих фінансів, бізнесових, інвестицій, чи щось інше?
2. **Яку проблему ти хочеш вирішити?** Існуючі застосунки тебе чимось не влаштовують, чи це навчальний/портфельний проєкт, чи реальна потреба?
3. **Який у тебе досвід?** Це щоб я міг говорити на правильному рівні — чи ти розробник, чи тільки вчишся, на яких технологіях працюєш.
4. **Який формат обговорення зручніший?** Спочатку дослідити проблему і вимоги вглиб, а потім переходити до технічних рішень? Чи паралельно?

Розкажи, з чого почнемо.

---

## Повідомлення 2 — Користувач

(переклад з англійської; оригінал нижче)

Ми з нареченою хочемо відстежувати наші фінанси. Потрібен інструмент. Хочу персональний інструмент, щоб мати можливість максимально підлаштувати його під наші потреби. Але, можливо, ти знайдеш існуючий інструмент із такими можливостями.

Вимоги:
- Відстежувати витрати **окремо** і **разом**.
- Знати, **хто** і **на що** витратив.
- Мати можливість **аналізувати** ці дані.

Ідея: використати **Google Sheets**. Робити фото чеків із продуктових магазинів, надсилати фото у **Google Gemini** і просити додати чек у таблицю витрат, **розбиваючи його на окремі товари**. Потім можна перевірити, скільки наречена витратила на шоколад, скільки на лосось тощо. Дуже зручно — фотографуєш, а не вводиш руками.

Чому Google Sheets:
- Базовий інструмент, легко налаштовується (і нареченою теж).
- Доступ із комп'ютера і телефона.
- Спільний доступ — одна таблиця на двох, без власного сервера.

Недолік: вигляд не дуже гарний. Було б круто зробити **UI поверх таблиці**, який можна використовувати опційно — інколи UI, інколи звичайний Sheets. Чув, що Google дає інструменти для побудови програм, які використовують Sheets як базу даних — досліди це.

Альтернатива: якщо потреб небагато, можемо створити програму самі (через AI-агентів типу Claude Code), а синхронізацію тримати на сервері в **Azure** — там може бути безкоштовний тариф для такого малого використання.

Також у Azure є інструмент для аналізу чеків/інвойсів за шаблонами. Оскільки ми ходимо лише в ~4 магазини, можна зробити шаблони для кожного.

Прохання: розклади проблему на менші частини, проаналізуй кожну і представ результат.

### Оригінал англійською

> Me with my bride want to track our finances. And we need some tool for this. I want to have some personal tool because I want to have ability to adjust it for my needs as much as I can. But maybe you can find some tool for this that already has these abilities. But let me explain it first. We need to track our expense Separately and together. We need to track who spent what and for what. And then to have some ability to analyze this. I thought that using Google Sheets would be a good idea. Because we can make a photo of our receipts from grocery stores Send this photo to Google Gemini And ask it to add the bill to our expenses table and split it by products So afterwards, we can check how much My knee was bent to some chocolates. How much we spent to salmon. And so on. I think it's very convenient if you can just send a picture and not type it manually. So this is the reason why I think that we can use Google Sheet for this. But may there is already some service for this. But I just don't fully trust it. Because when it's open source or self made, then you can control it. And if something doesn't work as you want, you can change it. But maybe there is already some good open source solution for this Because, actually, expenses striking is pretty common and simple problem. And I guess that there are many open source projects. I like the idea with using Google Sheets because it's, like, a basic tool and it's very easy to adjust. And not only me, but also my bride can do this. And, also, I like the approach because you can do it from computer. Or for from your mobile phone. And also it's shared. So we have one table for two of us. And we don't need some server for this. But the drawback of this table is that the view is not very nice. It will be cool if we can make some UI for our table. And use it dependently. Like, in some cases, use our UI. In some cases, use it just like a regular Google Sheet. I heard that there is a possibility for this, and Google provide you with such tools. To make programs that use Google Sheet like a database. Please investigate this as well.
>
> If we don't need a lot of of staff, then maybe we can just create such program by ourselves. Using AI agents like Claude code. And then do synchronize changes I can have some server. On Azure. Maybe there is some freaky for such low using. Also, I know that in as there is a tool to Analyze bills, receipts, invoices, and extract data from this. You just need to create templates for this. And then it will work. And as we usually visit only 4 grocery stores. I can just create templates for all of them.
>
> Please dissasemble this problem to smaller pieces. And then analyze them one by one and present me with your analyzed result.

## Відповідь 2 — Claude

Я виділив **8 підпроблем** і провів дослідження по кожній.

### A. Існуючі рішення — чи варто будувати?

| Проєкт | Що добре | Чого бракує | Ліцензія |
|---|---|---|---|
| [Receipt Wrangler](https://github.com/Receipt-Wrangler/receipt-wrangler) | AI-сканування чеків, **розбиття на товари**, спільні чеки, нативні iOS+Android+web | Слабка довгострокова аналітика по категоріях/товарах | AGPL-3.0 |
| [TaxHacker](https://github.com/vas3k/TaxHacker) | Найкраще AI-витягування line items, свій LLM-ключ | Один користувач, без моделі "він/вона/спільне" | MIT |
| [Spliit](https://github.com/spliit-app/spliit) | Хто за що заплатив, поділ боргів, GPT-4 Vision для чеків | Чек = одна витрата, **без line items** | MIT |
| [Actual Budget](https://github.com/actualbudget/actual) | Зріла аналітика, бюджети, мульти-юзер | **Жодного OCR і line items** | MIT |
| Firefly III | Split-транзакції, тривалий проєкт | Майнтейнер відмовився від OCR; не "пара-орієнтований" | AGPL-3.0 |
| Maybe | — | Архівований 07.2025, форк [Sure](https://github.com/we-promise/sure) | AGPL-3.0 |

**Висновок:** жоден проєкт не закриває одночасно (1) фото→товари, (2) парний облік "хто за що", (3) аналітика по товарах. Найближчий — Receipt Wrangler. Радив би спочатку підняти його в Docker і протестувати тиждень — це найдешевше "ні" перед побудовою свого.

### B. Шар зберігання — Sheets чи власна БД?

**За Sheets:** нуль інфраструктури, обоє редагуєте без додатків, наречена може виправити вручну якщо UI зламаний, бекапи автоматичні, якщо проєкт надоїсть — дані залишаються в зрозумілому форматі.

**Проти Sheets:** ліміти Apps Script (6 хв/виконання, 20 000 URL Fetch/день) — для пари з ~200 чеків/міс **далеко за межами реальності**.

**Вердикт:** Sheets — правильний вибір для вашого масштабу. Не міняти.

### C. Модель даних — це найважливіше рішення

Мінімальна схема з 4 листів:

1. **`Receipts`** — `id`, `date`, `store`, `total`, `paid_by`, `photo_url`, `raw_ocr_json`
2. **`Items`** — `receipt_id`, `product_name`, `category`, `qty`, `unit_price`, `total`, `consumed_by` (ти / наречена / 50-50 / інший %)
3. **`Categories`** — щоб AI не вигадував категорії щоразу
4. **`Settings`** — імена, валюта, аліаси магазинів

**Ключове:** `consumed_by` ≠ `paid_by`. Платить один (картка), споживають обоє в різних пропорціях. Без цього розрізнення вимога "хто скільки витратив на шоколад" не працює.

### D. Сканування чеків — Gemini vs Azure Document Intelligence

| Критерій | Gemini 2.5 Flash | Azure Doc Intelligence (prebuilt receipt) |
|---|---|---|
| Ціна 100 чеків/міс | **~$0.18** | ~$1.00 (free до 500 стор/міс) |
| Точність на продуктах | **Краще** — розуміє "KRGR 2% MLK" контекстуально | Слабший на абревіатурах і обгорнутих рядках |
| Шаблони на 4 магазини | Не потрібні | Тренувати кастом-модель ($30/1000 стор інференсу) |
| Гнучкість логіки | Можна "розпізнай категорію", "знайди акцію" | Жорстка схема |

**Вердикт:** Gemini 2.5 Flash з структурованим JSON-виводом. Дешевше, точніше для продуктів. Azure Doc Intelligence — для регулярних інвойсів, не для касових чеків.

### E. UI — як виглядає інтерфейс

1. Нативний Sheets — некрасиво на мобільному.
2. **Apps Script Web App** — безкоштовно, у Google, фото→Gemini→Sheet. **Рекомендований MVP-шлях.**
3. AppSheet — ~$10–$20/міс на двох у продакшні. Викидаємо.
4. Власна SPA на Cloudflare Pages — робити лише якщо Apps Script тісно.

Варіант 2 + опційний доступ до сирого Sheets — саме те, що ти описав ("то UI, то звичайний Sheet").

### F. Багатокористувацький доступ

- Один Sheet, розшарений на два Google-акаунти.
- Apps Script web app з опцією "Execute as user accessing" + обмежити двома email-ами.
- `Session.getActiveUser().getEmail()` → автоматично проставляється `paid_by`.

Жодних окремих логінів і серверів авторизації.

### G. Аналіз і звіти

- **Pivot-таблиці у Sheet** — швидко, обмежено візуально.
- **Looker Studio** поверх Sheet — повноцінні дашборди, без обмежень.

Не ускладнювати, поки запит не вийде за ці два варіанти.

### H. Хостинг — якщо вийдемо за Apps Script

- **Cloudflare Pages + Workers** — 100k запитів/день, простота, кастомний домен. Найкращий вибір.
- **Azure Static Web Apps Free** — 100 GB трафіку + Functions (1M викликів/міс). Якщо MS-екосистема.
- Azure App Service F1 — викинути: засинає, без custom SSL.

### Підсумкова рекомендація

1. **Тиждень 0:** Receipt Wrangler у Docker — можливо, закриє 80% потреб.
2. **Якщо ні — Тиждень 1–2 (MVP):** Sheet за схемою C + Apps Script web app (фото→Gemini→запис у Sheet) + share на двох + PWA-ярлик на телефон.
3. **Тиждень 3:** Looker Studio дашборд.
4. **Через місяць:** SPA на Cloudflare Pages, якщо Apps Script тісно.

**Вартість:** ~$0.20/міс Gemini API. Хостинг нуль.

### Питання, які треба прояснити

1. Скільки чеків на місяць (10? 50? 200?) — впливає на вибір моделі.
2. Спільна картка/рахунок — чи завжди платить хтось один?
3. Доходи теж відстежувати, чи лише витрати?
4. Офлайн на телефоні (фото без інтернету в магазині)?
5. Готовий витратити вечір на Receipt Wrangler перед тим, як будувати своє?

---

## Повідомлення 3 — Користувач

Receipt Wrangler не підходить — мало зірочок на GitHub, мало довіри. Йдемо одразу до Google Sheets.

Щодо Gemini — я мав на увазі, що Gemini вміє редагувати Google Sheet і я міг би просто кидати чек у чат, а він би все додавав. Це включено в мою місячну підписку, безкоштовно. $0.18/міс за API теж не проблема.

Щодо URL фотографії — не знаю, наскільки потрібно. Можливо, розпаршеної буде досить.

Якщо через Apps Script web app завантажуємо фото і парсимо через Gemini API, то одразу можна гарно відобразити список продуктів і цін, щоб користувач переглянув і відредагував, якщо щось не так. І показати pie chart по категоріях цього чеку.

## Відповідь 3 — Claude

### Gemini чат vs Gemini API — несумісні підходи

Те, що ти описав в кінці (UI з редагованим списком + pie chart), **несумісне** з підходом "кинути фото в Gemini чат → він сам допише". Чат — fire-and-forget, без проміжної перевірки. Якщо хочеш UI з review/edit — потрібен **Apps Script + Gemini API**.

Чат як основний потік не раджу через три причини:

1. **Немає review-кроку.** Gemini іноді читає "Lays 50г" як "Lays 500г" — без перевірки це попадає в аналітику назавжди.
2. **Не дотримається схеми.** Чат не знає, що в `consumed_by` має бути одне зі значень з фіксованого списку, і не запитає "це твоє, її чи спільне?".
3. **Категоризація плаватиме.** Сьогодні "молоко" → `Молочка`, завтра → `Продукти` — аналітика розповзеться.

**Висновок:** Apps Script + Gemini API як основний шлях. Gemini чат — для ad-hoc запитів типу "скільки на каву в березні" по вже структурованому Sheet.

### Фото — зберігати

Аргументи за:
- Apps Script через `DriveApp.createFile()` — 3 рядки коду.
- Drive 15 GB безкоштовно, чек ~500 KB → ~30 000 чеків.
- Через 4 місяці побачиш "Морозиво — 280 грн" і подумаєш "не може бути". З фото — 2 секунди перевірки.
- Якщо Gemini щось спарсив криво — без оригіналу не виправиш.

Дешева страховка. Видалити встигнеш, якщо набридне.

### Review UI + pie chart — потік

1. Користувач відкриває web app, тисне "Додати чек" → камера/галерея.
2. Фото → Apps Script `doPost` → Gemini API з JSON-схемою → масив items.
3. UI показує **редаговану таблицю**: товар / категорія / к-сть / ціна / хто спожив.
4. Збоку — pie chart по категоріях чеку (Chart.js у HTML Service).
5. Зверху селектор `paid_by`.
6. Кнопка "Зберегти" → рядки в `Receipts` + `Items`, фото в Drive.

**Деталь:** `consumed_by` за замовчуванням — найважливіше. Для продуктів розумно "50/50" автоматично, з можливістю швидко тицьнути на рядок і змінити. Інакше набридне і перестанеш користуватись. Gemini у промпті може ставити підказку "явно жіноче/чоловіче" — економить тицяння.

### Чесно про pie chart на один чек

Корисний рідше, ніж здається. У продуктовому чеку домінують 4-5 категорій (м'ясо/молочка/овочі), шоколад там 5%. Pie щоразу показує одне і те саме.

Реальна цінність pie chart — на **місячному дашборді** (Looker Studio або своя сторінка). Там видно патерн "20% бюджету на каву".

З review-екрану не викидаємо — він безкоштовний у реалізації — але головна цінність далі.

### Критичне питання перед кодом

Модель оплати:
- Завжди платить один (ти своєю карткою)?
- Спільна картка/рахунок?
- Кожен своєю — потім вирівнюєте борги?

Це впливає на: чи потрібне поле `paid_by` взагалі; чи потрібен лист `Settlements` (хто кому винен); чи показувати "її борг = X грн" в UI.

---

## Повідомлення 4 — Користувач

Погоджуюсь із порадами. Відповіді на питання:

1. Кожен платить своєю карткою.
2. Settlements — поки не треба.
3. Борг — теж не треба.

Витрати можуть бути в різній валюті — переважно EUR (фотографії чеків — завжди EUR), іноді UAH (онлайн).

Архітектура: проєкт має бути легко підтримувати, легко розвивати, легко переключитись на іншу технологію за потреби. І все документувати.

## Відповідь 4 — Claude

### Що насправді означає "легко переключитись на іншу технологію"

Для проєкту на 2 людей переносимість коду — ілюзія. Якщо колись перейдемо з Sheets на Postgres, Apps Script код не "портнеться" — він буде викинутий і переписаний. Реальність малих проєктів.

Реальна переносимість забезпечується:

1. **Переносимі дані** — чиста схема, осмислені назви колонок, стабільні ID, узгоджені формати. Експорт у CSV → імпорт у будь-що.
2. **Переносиме знання** — задокументовані рішення, щоб майбутній-ти за рік розумів *чому*, а не лише *що*.

**НЕ використовуємо** repository pattern, dependency injection, абстрактні інтерфейси сховища — enterprise-фетиш, який для 2 людей лише сповільнить розробку. Натомість — дисципліна даних і документації.

### Мульти-валютна модель

Зберігаємо **і оригінал, і нормалізацію** + курс на момент фіксації.

**`Receipts`:** id, date, store, currency, total_orig, fx_rate_eur, total_eur, paid_by, photo_url, source, raw_ocr_json, created_at

**`Items`:** id, receipt_id, product_name, category, qty, unit_price_orig, total_orig, total_eur, consumed_by, notes

`total_eur` дублюється в Items навмисно — денормалізація для аналітики без джойнів. `SUM(total_eur) WHERE category='Шоколад'` замість трирівневого join.

Курс — з [ECB](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html) (безкоштовно, без API key). Лист `FxRates` (date / currency / rate_to_eur), Apps Script тригер тягне раз на день.

`fx_rate_eur` зберігається **на чеку** — це історична істина. Якщо ECB переглянуть значення — наш звіт не змінюється заднім числом.

### Структура проєкту

```
finance-tracker/
├── README.md
├── conversation.md
├── docs/
│   ├── architecture.md
│   ├── data-model.md
│   ├── setup.md
│   └── decisions/
│       ├── 0001-sheets-as-storage.md
│       ├── 0002-gemini-vs-azure-doc-intelligence.md
│       ├── 0003-apps-script-runtime.md
│       └── 0004-multi-currency-strategy.md
├── src/
│   ├── appsscript.json
│   ├── Web.js          — doGet/doPost
│   ├── ReviewUI.html
│   ├── Domain.js       — JSDoc типи, валідація
│   ├── Storage.js      — Sheet I/O
│   ├── Gemini.js       — API + промпт
│   ├── Fx.js           — курси
│   └── Config.js
├── .clasp.json
└── package.json
```

8 файлів коду, 4 ADR-и. Більше = ознака over-engineering.

### Критична інфра — clasp + Git

[`@google/clasp`](https://github.com/google/clasp) — код локально в Git, `clasp push` деплоїть. Без цього "easy to maintain" не виходить.

### Документація без перебору

- **README.md** — "що це, як додати чек, як дивитись звіт" для двох. ~1 стор.
- **docs/architecture.md** — потік даних + чому ці рішення. ~1 стор.
- **docs/data-model.md** — схема + правила (формати, ULID, ISO 4217). Єдине джерело істини.
- **docs/setup.md** — розгортання з нуля. На випадок reset через 2 роки.
- **docs/decisions/** — короткі ADR (Context / Decision / Consequences) для рішень, де був вибір.

Жодних doxygen, README в кожній папці чи ARCHITECTURE на 30 стор.

### ID

ULID (час-сортовані, 26 символів). Не номер рядка (змінюється при сортуванні), не автоінкремент (Sheets не вміє).

### План кроків

1. Створити структуру папок + README + 4 ADR-и (без коду).
2. `docs/data-model.md` з фінальною схемою.
3. Підключити clasp + порожній Apps Script.
4. Код по модулях.

Питання перед стартом: **базова валюта точно EUR, не UAH?** Бо нормалізуємо все до неї, змінювати потім дорого.

---

## Повідомлення 5 — Користувач

EUR як базова валюта — ОК. Може колись знадобиться розширення (нові категорії, нові таблиці). UI буду суттєво допрацьовувати з часом — кодова частина має мати хорошу архітектуру. Можливо, перейду на ChatGPT API або Claude API — це теж має бути просто. Тепер сплануй все, що треба зробити.

## Відповідь 5 — Claude

### Цілі MVP
- Фото чеку → Apps Script → Gemini → редагований список → Sheet.
- Обоє користуються з телефона.
- Дашборд для місячного аналізу.
- Чиста схема, документація, готовність до розширень.

### Не-цілі MVP
- Ручне введення онлайн-витрат через UI (поки прямо в Sheet).
- UAH-витрати (Phase 5).
- Редагування минулих чеків через UI.
- Імпорт історичних даних.
- Settlements/борги.

### Архітектура — 3 шари + 2 точки розширення

```
UI Layer (HTML + Alpine.js)        ← змінюється часто
   ↕ google.script.run / fetch JSON
API Layer (Web.js)                 ← стабільний
   ├─ AI Layer (AiClient.js)
   │    ├ Gemini.js  ←
   │    ├ OpenAi.js
   │    └ Anthropic.js
   └─ Storage Layer (Storage.js)
        ↕
      Google Sheet
   
Domain.js  ← JSDoc типи + валідація
Config.js  ← константи + AI_PROVIDER
Fx.js      ← курси
```

**Точки розширення:**

1. **LLM swap** — `AiClient.js` це switch на 3 рядки. Кожен провайдер — окремий файл з однаковою сигнатурою. Зміна провайдера = зміна одного рядка в Config.

2. **Категорії/таблиці** — Categories живуть **у Sheet**, не в коді. Нова категорія = новий рядок. Нова таблиця = новий лист + код у Storage.js + типи в Domain.js + рядок у data-model.md.

### UI: Alpine.js (не React)

Реактивний, без build, працює в Apps Script HtmlService, ~15kb з CDN. Якщо колись стане замало — переносимо UI на Cloudflare Pages SPA проти тих самих JSON-ендпоїнтів. API стабільне, UI замінюється.

### Фази

**Phase 0 — Documentation foundation (без коду)**
- README.md, docs/architecture.md, docs/data-model.md, docs/setup.md, docs/extending.md
- 5 ADR: 0001-sheets-as-storage, 0002-apps-script-runtime, 0003-gemini-with-provider-abstraction, 0004-multi-currency-eur-base, 0005-alpine-for-ui
- .gitignore, package.json

**Phase 1 — Backbone**
- Sheet з 4 листами: Receipts, Items, Categories (~15 категорій), FxRates
- Apps Script + clasp + Git
- Domain.js (JSDoc типи + валідація), Config.js, Storage.js (з ULID)
- Smoke test

**Phase 2 — AI parsing**
- Gemini.js — повна реалізація
- OpenAi.js, Anthropic.js — заглушки з контрактом
- AiClient.js — switch

**Phase 3 — Web UI MVP**
- Web.js (doGet/doPost: /parse, /save)
- index.html (upload), review.html (Alpine + Chart.js pie)
- Deploy, PWA-маніфест

**Phase 4 — Dashboard**
- Looker Studio підключений до Sheet
- Витрати по місяцях/категоріях/користувачу, top-10, тренди

**Phase 5 — FX + UAH**
- ECB daily fetch у FxRates (time trigger)
- Fx.js — convert(amount, fromCurrency, date)
- Селектор валюти в UI

**Phase 6 — Polish**
- Error handling
- Daily backup CSV у Drive
- Лог помилок у лист Errors

### docs/extending.md — рецепти на майбутнє

- Як додати категорію (1 рядок у Sheet).
- Як додати нову таблицю (5 кроків).
- Як замінити LLM (3 кроки).
- Як додати новий тип витрат (4 кроки).

### Питання перед Phase 1

1. Імена в UI — `his` / `hers` / `shared` у даних, реальні імена з Config у UI. Згода?
2. Категорії: Молочка, М'ясо/риба, Овочі/фрукти, Бакалія, Солодке, Алкоголь, Хімія/гігієна, Аптека, Кафе/ресторани, Транспорт, Розваги, Одяг, Електроніка, Послуги, Інше — додати щось специфічне?
3. Часовий пояс — Київ (UTC+2/3)? Дати YYYY-MM-DD, числа з крапкою?
4. Який Google акаунт — власник Apps Script + Sheet?

---

## Повідомлення 6 — Користувач

Розширити MVP:
- Введення онлайн-витрат через UI.
- UAH-витрати.
- Редагування минулих чеків через UI.
- Покупки додаються вручну і через картинку.

Відповіді:
1. Поки email, потім alias на email.
2. Авто, оренда житла, курси, підписки. З часом розширити.
3. Часовий пояс — Берлін.
4. Власник — мій акаунт.

## Відповідь 6 — Claude

### Зміни в архітектурі від нового скоупу

**1. FX рухається на Phase 1.** UAH у MVP → курси потрібні від початку.

**2. `review.html` стає універсальним екраном з 3 режимами:**

| Режим | Звідки беремо стан | Save |
|---|---|---|
| `?mode=photo&id=...` | Gemini парсить фото | INSERT |
| `?mode=manual` | Порожній шаблон | INSERT |
| `?mode=edit&id=...` | Завантажуємо існуючий чек | UPDATE |

Один файл, одна Alpine-компонента, відрізняється початковим станом і submit-шляхом.

**3. Storage.js росте** — додаються `getReceipt(id)`, `getItemsByReceipt(receiptId)`, `updateReceipt`, `updateItem`, `deleteItem`, `deleteReceipt`, `listRecent(limit)`. Лінійний скан по ULID-колонці.

**4. Нова сторінка `recent.html`** — список останніх ~30 чеків, клік → edit-режим review.

**5. Видалення — hard delete.** Sheet version history (~30 днів) досить для 2-юзер сценарію.

### Оновлені фази

| Phase | Скоуп |
|---|---|
| 0 | Docs + ADR (без коду) |
| 1 | Sheet + Apps Script + clasp + Domain + Config + Storage CRUD + **Fx з ECB** |
| 2 | Gemini + AiClient switch + заглушки OpenAi/Anthropic |
| 3 | Web UI: index (3 кнопки) + review (3 режими) + recent + PWA |
| 4 | Looker Studio дашборд |
| 5 | Polish: error logging, daily CSV backup |

### Категорії (20 шт., колонка group)

```
Продукти:    Молочка, М'ясо/риба, Овочі/фрукти, Бакалія, Солодке, Алкоголь
Побут:       Хімія/гігієна, Аптека, Одяг, Електроніка
Житло:       Оренда житла, Комуналка
Транспорт:   Авто (бензин/ТО/страх.), Транспорт (квитки/таксі)
Розваги:     Кафе/ресторани, Розваги
Сервіси:     Курси/освіта, Підписки, Послуги
Інше:        Інше
```

### Запис відповідей у систему

1. `paid_by`/`consumed_by` — email. `Config.EMAIL_ALIASES` — мапа для UI (fallback на частину до `@`).
2. Категорії — список вище, розширюється рядками у Sheet.
3. `Europe/Berlin` у `appsscript.json` timeZone.
4. Твій акаунт — власник, шариш Sheet на її email (Editor). Web app deploy: `Execute as: user accessing`, доступ обмежений двома email.

### Нове ADR

**ADR-0006: review.html як універсальний екран із 3 режимами** — нетривіальне рішення, треба пояснити в документації.

### Формати дат

Дати — рядки `YYYY-MM-DD`. Timestamp-и — ISO 8601 `2026-05-03T14:30:00+02:00`. Не залежить від локалі Sheet, переносиме всюди.

---

## Повідомлення 7 — Користувач

Не впевнений щодо "review.html як універсальний екран із 3 режимами". Чому його не розділити?

## Відповідь 7 — Claude

Слушна критика. Аргумент за об'єднанням був "форма однакова", але **оточуюча поведінка** у трьох режимах різна:

| Аспект | Photo | Manual | Edit |
|---|---|---|---|
| Початковий стан | Парс із Gemini, з помилками | Порожньо | Завантаження з Sheet |
| Header | "Перевір розпізнане" + "Перепарсити" | "Новий онлайн-запис" | "Редагування від {date}" |
| Item-список | Pre-populated, focus on review | Empty, focus on add | Existing, обережне редагування |
| Save | INSERT | INSERT | UPDATE |
| Видалення | — | — | Delete item, delete receipt |
| Cancel | Викинути парс | Викинути ввід | Повернути оригінал |
| Errors | "Не вдалось розпарсити" | Валідація форми | "Не знайшли запис" |

Це не 90% спільного — це 3 різні задачі. Плюс UI буде сильно еволюціонувати → об'єднаний файл = ризик зламати два режими, фіксячи третій.

### Виправлений підхід — 3 файли + спільні компоненти

```
src/ui/
├── photo.html      ← upload → parse → review
├── manual.html     ← порожня форма
├── edit.html       ← завантажує по ID
├── recent.html     ← список
├── index.html      ← landing
└── shared/
    ├── ItemsTable.html   ← редагований список товарів (Alpine x-data)
    ├── Summary.html      ← total + pie chart
    └── webapp.js         ← API клієнт
```

DRY через компоненти (`<items-table>`, `<receipt-summary>`), кожен екран читається сам по собі.

### Зміни в плані

- **ADR-0006** перейменовано: "Separate pages per mode with shared UI components" — щоб майбутній-ти не "почистив" це через рік.
- Phase 3 трохи довша, але код здоровіший.
- Storage.js не змінюється.

Об'єднання було прихованим YAGNI — здавалося DRY, а насправді колокація різних задач під одним дахом.

---

## Повідомлення 8 — Користувач

Дати ОК. Додати ще:
- Коментарі до чеку і товару (чому купили: знижка / святкування / спробувати).
- Стандартні ціни продуктів у різних магазинах (Pesto Barilla 3.49 в Aldi/Lidl/Rewe, інколи 1.49). Трекати знижки, рахувати скільки зекономили.
- Псуття: купили зі знижкою, не з'їли — позначити, рахувати втрачене на знижках.
- Live порівняння: в Edeka бачимо спаржу 10 €/кг, дивимось у програмі — в Aldi 8, не купуємо.

Подумай про найкращу інтеграцію. Може окрема таблиця? Оціни варіанти, спираючись на найкращі практики.

## Відповідь 8 — Claude

Три фічі обертаються навколо однієї концепції — **продукт як окрема сутність**. Коментарі та псуття — окремі простіші задачі.

### Огляд варіантів

| | A: текст | B: нормалізація | C: Products+FK ✅ | D: Products+Prices+Spoilage |
|---|---|---|---|---|
| Точна історія цін | ❌ | 50/50 | ✅ | ✅ |
| Виявлення знижок | ❌ | 50/50 | ✅ | ✅ |
| "Aldi vs Edeka" | ❌ | ❌ | ✅ | ✅ |
| Складність | низька | середня | середня | висока |
| Ризик пошкодити дані | низький | високий | низький | середній |
| YAGNI | ✅ | ✅ | ✅ | ❌ |

**Вибір — C.** D — прематурна оптимізація: ProductPrices як кеш від Items = баг-генератор синхронізації. Spoilage окремою таблицею потрібен лише при багатоетапному списанні — рідкість.

Відповідні принципи:
- **Single Responsibility:** Products = ідентичність, Items = події, Receipts = контекст
- **YAGNI:** ціни не матеріалізуємо до появи проблеми з продуктивністю
- **Fail-open:** product_id nullable; AI не зматчив → save все одно проходить
- **Доменна модель** збігається з ментальною: Product — "Pesto Barilla 190г" (тип), Item — "купив 03.05 за 1.49" (подія)

### AI-матчинг продуктів

1. У промпт Gemini передаємо ~100 релевантних існуючих продуктів (~10-20 KB JSON).
2. Для кожного item Gemini повертає `existing_product_id` (якщо ≥80% similarity), `proposed_canonical_name` (якщо новий), `match_confidence`.
3. UI у review показує: existing match з [▼] для override, або editable input для нового.
4. На save: existing → лінк, proposed → створюємо Product + лінк.
5. Окрема сторінка `products.html` (Phase 5) — ручне злиття дублікатів.

### Коментарі — тривіально

- `Receipts.note`, `Items.note` — текст. Іконка 📝 в UI.
- AI не заповнює — мотивацію не вгадає.

### Псуття — колонка, не таблиця

- `Items.wasted_qty` (default 0).
- `wasted_value_eur = (wasted_qty / qty) * total_eur`
- UI кнопка "позначити зіпсоване" в recent/edit.
- Якщо колись потрібно багатоетапне списання — додамо `Spoilage` таблицю без ламання.

### Live price comparison — UI, не дані

Сторінка `prices.html`: search → знаходить Product → таблиця "store / avg / min / max / last_seen / N". Все рахується з Items (single source of truth).

### Оновлена схема

| Лист | Колонки |
|---|---|
| `Receipts` | id, date, store, currency, total_orig, fx_rate_eur, total_eur, paid_by, photo_url, source, raw_ocr_json, **note**, created_at, updated_at |
| `Items` | id, receipt_id, **product_id**, product_name (snapshot), category, qty, unit_price_orig, total_orig, total_eur, consumed_by, **note**, **wasted_qty** |
| `Products` | id, name, category, unit, unit_size, notes, created_at, updated_at |
| `Categories` | name, group |
| `FxRates` | date, currency, rate_to_eur |

**Важливо:** `Items.product_name` залишається як snapshot — копія на момент покупки. Перейменування Product не зачіпає історію.

### Вплив на MVP

| Фіча | Складність | Можна відкласти? |
|---|---|---|
| Notes | низька | можна, але додати одразу |
| Products + AI matching | **висока** | **ні** — потім бекфіл історії |
| Reference prices в UI | низька | можна |
| Spoilage column | низька | додати одразу, UI пізніше |
| Live price page | середня | Phase 5 |

**Рекомендація:** Products + AI matching у MVP. Notes і wasted_qty колонка — теж. Spoilage UI і prices.html — пізніше.

### Нові ADR

- **ADR-0007:** Products as separate entity with FK from Items
- **ADR-0008:** Reference prices computed from Items history (no separate prices table until perf justifies)
- **ADR-0009:** Notes as plain columns on Receipt/Item; spoilage as `wasted_qty` column

---

## Повідомлення 9 — Користувач

Не завжди може бути продукт у таблиці Products. Рідкісну покупку немає сенсу додавати. Має працювати і без продукту в таблиці. Якщо є — можна подивитись деталі. Інакше стане надто складно. Помідори — багато видів і цін, важко правильно обробити. Колись дійдуть руки додати, але на початку має бути гнучкість.

## Відповідь 9 — Claude

Підсилює існуючий дизайн (`product_id` був nullable), але загострює поведінку AI.

### AI тепер має 3 результати

1. **Лінк до існуючого** — впевнений матч.
2. **Запропонувати новий продукт** — канонічний товар (бренд + розмір), варто каталогувати.
3. **`product_id = null`** — не варто каталогувати.

User завжди може override у review.

### Евристика для null у промпті

Не створюй Product, якщо: немає бренду, багато сортів, ціна за вагу, одноразово, назва занадто загальна.

Створюй Product, якщо: чіткий бренд+розмір, регулярна покупка, стабільна ідентичність.

### UI: 3-стан pill

```
[🔗 Pesto Barilla 190g  ▼]   linked
[✨ New: Coca Cola 500ml ▼]  proposed new
[—  No product           ▼]   null
```

### Аналітика без product_id

| Запит | Працює? |
|---|---|
| Витрати по категорії | ✅ |
| Середній чек у магазині | ✅ |
| Хто скільки витратив на солодке | ✅ |
| Середня ціна Pesto Barilla | ❌ (потрібен product_id) |
| Де дешевше Coca Cola | ❌ |

Базова аналітика працює на category-рівні. Product-level — бонус для каталогованих.

### "Помідори"

- Перший чек: AI бачить "помідори чері 250г" → null. Item зберігається з product_name snapshot, category="Овочі/фрукти".
- Аналітика "скільки на овочі-фрукти" — через category.
- Якщо колись захочеш стежити саме за "Помідори чері Aldi 250г" — кнопка "Add to Products catalog" в recent.html (майбутнє розширення).

### Promote item → product (майбутнє, не MVP)

Кнопка в edit/recent → створює Product з item, опційно fuzzy-search схожих історичних items для бекфілу.

### ADR-0007 уточнено

> Products — необов'язковий покажчик, не обов'язковий вимір. Items з product_id=null валідні і повноцінні. AI створює Product тільки для канонічних товарів. Дві крайні цінності: глибокий аналіз для регулярних, низьке тертя для одноразових.

### Зміни в плані

Реалізаційно — лише: правила null у Gemini промпті, 3-стан pill в UI, документація ADR-0007. Phase 0-5 без змін.

### Скоуп MVP остаточно

- 4 листи + Products
- Notes на Receipt/Item
- wasted_qty колонка (UI пізніше)
- AI матчинг 3-результатний (link / new / null)
- Multi-currency з UAH
- 3 окремі UI: photo / manual / edit
- recent.html

---

## Повідомлення 10 — Користувач

Так, склади план реалізації і давай будемо створювати.

## Відповідь 10 — Claude

### Plan mode

Перейшов у plan mode. Запустив:

1. **Glob** для перевірки стану директорії — порожньо крім conversation.md і .claude/.
2. **Plan агента** для валідації архітектури і деталізації Phase 0.

### Ризики, виявлені валідаційним агентом (12 шт.)

Plan-агент знайшов нюанси, які попередній дизайн пропустив:

1. `doPost` 6-min timeout (Gemini + Drive + Sheet за один запит)
2. **`google.script.run` ≠ fetch** — callback API, не Promise. Треба обгортка `runServer()`.
3. **LockService обов'язковий** для multi-row writes — інакше гонки при одночасному save.
4. **ECB fallback** — нема курсів сб/нд/свята; UAH є з 2014.
5. ULID inline-генератор (~40 рядків).
6. **Sheet cell limit 50 000 chars** — `raw_ocr_json` тримати ≤45 000.
7. **Service Worker не працює в iframe Apps Script** — true offline неможливий, тільки home-screen icon.
8. **`Session.getActiveUser().getEmail()` повертає `""`** для personal Gmail — fallback через UI-toggle + localStorage.
9. clasp login через 2FA — recovery procedure.
10. Hard-delete + 30-day version history — daily CSV backup мітигує (Phase 5).
11. **Money у float** — `0.1 + 0.2 ≠ 0.3` — rounding-on-write до 2dp.
12. **`updated_at` був на Receipts, але не на Items** — без аудиту правок.

Усі задокументовано в data-model.md і відповідних ADR.

### Уточнюючі питання → відповіді

1. **Документація:** українською. Код, JSDoc, коментарі — англійською.
2. **Гроші:** float, округлений до 2 знаків (rounding-on-write).

### План у файлі

Створено `C:\Users\Yurii-PC\.claude\plans\adaptive-jumping-puddle.md` з повним описом Phase 0 (структура файлів, MADR-формат, document responsibility split, order of operations, acceptance criteria).

### Користувач затвердив план

ExitPlanMode → схвалено → починаю Phase 0.

---

## Phase 0 — execution

Створено 17 файлів за порядком (data-model.md → 9 ADR → architecture → setup → extending → decisions/README → README):

```
finance-tracker/
├── .gitignore
├── .editorconfig
├── package.json
├── README.md
├── conversation.md
├── docs/
│   ├── architecture.md
│   ├── data-model.md
│   ├── extending.md
│   ├── setup.md
│   └── decisions/
│       ├── README.md
│       ├── 0001-google-sheets-as-storage.md
│       ├── 0002-apps-script-runtime-and-clasp.md
│       ├── 0003-gemini-with-provider-abstraction.md
│       ├── 0004-multi-currency-eur-base.md
│       ├── 0005-alpine-for-ui-no-build.md
│       ├── 0006-separate-pages-per-mode.md
│       ├── 0007-products-as-optional-dimension.md
│       ├── 0008-prices-computed-from-items.md
│       └── 0009-notes-columns-and-wasted-qty.md
└── src/
    └── .gitkeep
```

Документація — українською, ADR-и — у MADR 3.0 short.

`data-model.md` — авторитетне джерело істини про схему. Включає всі правила: identity (ULID), date/time formats, money precision, currency, FX fallback, snapshot, hard-delete, lock, schema-evolution.

Залишилось: запитати користувача перед `git init` і першими коммітами.

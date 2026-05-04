# Архітектура

> Цей документ описує **структуру** і **потоки даних**. Схема даних — у [data-model.md](data-model.md). Технологічні рішення — у [decisions/](decisions/).

## Шари

```
┌────────────────────────────────────────────────────────┐
│ UI Layer (HTML + Alpine.js + Chart.js)                 │  ← змінюється часто
│   index.html  photo.html  manual.html  edit.html       │
│   recent.html  shared/{ItemsTable,Summary,webapp}.*    │
└─────────────────────────┬──────────────────────────────┘
                          │ runServer(fnName, args) → Promise
                          │ (обгортка над google.script.run)
┌─────────────────────────▼──────────────────────────────┐
│ API Layer (Web.js)                                     │  ← стабільний
│   doGet  /index, /photo, /manual, /edit, /recent       │
│   doPost (через google.script.run): parseReceipt,      │
│           saveReceipt, updateReceipt, deleteReceipt,   │
│           getReceipt, listRecent, refreshFx            │
└──────────┬──────────────────────────┬──────────────────┘
           │                          │
┌──────────▼─────────────┐  ┌─────────▼──────────────────┐
│ AI Layer               │  │ Storage Layer (Storage.js) │
│   AiClient.js (switch) │  │   Receipts / Items /       │
│     ├ Gemini.js  ✅    │  │   Products / Categories    │
│     ├ OpenAi.js (stub) │  └────────────┬───────────────┘
│     └ Anthropic.js     │               │
└────────────────────────┘               ▼
                          ┌──────────────────────────────┐
                          │ Google Sheet (storage)       │
                          └──────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ Cross-cutting modules                                  │
│   Domain.js  ← JSDoc типи + валідація + ULID generator │
│   Config.js  ← константи, AI_PROVIDER, EMAIL_ALIASES   │
│   Fx.js      ← live NBU lookup для UAH (без зберігання)│
└────────────────────────────────────────────────────────┘
```

## Файлова відповідальність

Один файл — одна задача. По одному рядку, що він робить:

| Файл | Що робить |
|---|---|
| `src/appsscript.json` | Apps Script manifest: `timeZone: Europe/Berlin`, scopes, web app config. |
| `src/Web.js` | `doGet` (роутинг сторінок), функції що викликаються через `google.script.run` (parseReceipt, saveReceipt, updateReceipt, deleteReceipt, getReceipt, listRecent). |
| `src/Domain.js` | JSDoc типи (`Receipt`, `Item`, `Product`, `ParsedReceipt`, `ParsedItem`); валідація; ULID-generator; парсер `consumed_by` синтаксису. |
| `src/Storage.js` | CRUD для всіх 4 листів. Усі multi-row writes обгорнуті `LockService.getScriptLock()`. Rounding-on-write для money. |
| `src/Fx.js` | `getRateLive(currency, date)` — live запит до NBU при збереженні UAH-чеку; для EUR одразу повертає 1.0. Нічого не персистить. |
| `src/Config.js` | Константи: SHEET_ID, AI_PROVIDER, EMAIL_ALIASES, DRIVE_FOLDER_ID, категорії-список (seed). |
| `src/AiClient.js` | Switch між провайдерами на основі `Config.AI_PROVIDER`. |
| `src/Gemini.js` | Виклик Gemini 2.5 Flash; промпт-будівник; парс структурованого JSON-output. |
| `src/OpenAi.js` | Заглушка з ідентичною сигнатурою (`Error('Not implemented')`). |
| `src/Anthropic.js` | Те саме. |
| `src/ui/index.html` | Landing з 3 кнопками: Photo / Manual / Recent. |
| `src/ui/photo.html` | Upload фото → parseReceipt → review pre-populated → save (INSERT). |
| `src/ui/manual.html` | Порожня форма → save (INSERT). |
| `src/ui/edit.html` | Завантаження по ID → редагування → save (UPDATE) або delete. |
| `src/ui/recent.html` | Список останніх ~30 чеків з лінками на edit. |
| `src/ui/shared/ItemsTable.html` | Alpine `x-data` компонент: редагування рядків (категорія, qty, price, consumed_by, note, product-pill). |
| `src/ui/shared/Summary.html` | Alpine компонент: total + Chart.js pie за категоріями. |
| `src/ui/shared/webapp.js` | `runServer(fnName, args) → Promise`-обгортка над `google.script.run`. |

## Потік даних: photo → save

Найскладніший потік. Розкладений по кроках для розуміння timeout-ризиків і lock-меж.

```
Користувач  ──[1. select photo]──>  photo.html
photo.html  ──[2. base64-encode]──> runServer('parseReceipt', [base64, ctx])
                                    │
                                    ▼
Web.js     ──[3. parseReceipt]───>  AiClient.parseReceipt(bytes, ctx)
                                    │
                                    ▼
AiClient   ──[4. switch provider]>  Gemini.parseReceipt(bytes, ctx)
                                    │
                                    ▼
Gemini.js  ──[5. UrlFetchApp]────>  Gemini API (~3-15s)
                                    │
                                    ▼
                                    JSON: { items: [...], store, date, total, suggestions }
                                    │
                                    ▼
Web.js     ──[6. validate]───────>  Domain.validateParsedReceipt(json)
                                    │
                                    ▼
                                    Повертається в photo.html через Promise

photo.html ──[7. show ItemsTable]>  Користувач редагує (override match,
                                    змінює category, додає note, тощо)
                                    │
                                    ▼
photo.html ──[8. submit]─────────>  runServer('saveReceipt', [reviewedData])
                                    │
                                    ▼
Web.js     ──[9. saveReceipt]────>  LockService.tryLock(30000)
                                    │
                                    ├─ Storage.appendReceipt(...)
                                    ├─ Storage.appendItems(...)
                                    ├─ Storage.appendNewProducts(...)
                                    │  (для proposed_canonical_name)
                                    └─ Drive.createFile(photo) → photo_url
                                    │
                                    ▼
                                    LockService.release()
                                    │
                                    ▼
                                    Повертається { receipt_id } у photo.html
photo.html ──[10. redirect]──────>  recent.html (показ нового запису)
```

### Timeout-ризики на цьому потоці

- **Крок 5** (Gemini) — найдовший, 3–15с. Якщо більше 30с — show timeout error в UI.
- **Крок 9** (lock + writes) — миттєвий (<1с) для типового чеку (50 items).
- **Крок 9 Drive write** — секунда чи дві.
- Сумарно — типовий save вкладається у 5–20с. 6-хвилинний ліміт `doPost` далеко не загрозливий.

## Точки розширення

Дві справжні точки розширення в архітектурі:

### 1. Заміна LLM-провайдера

Файл: `src/AiClient.js`. Switch на 3 рядки. Кожен провайдер — окремий файл з ідентичною сигнатурою `parseReceipt(imageBytes, ctx) → Promise<ParsedReceipt>`. Заміна провайдера = зміна одного рядка у [`Config.js`](data-model.md#) + написання нового файлу за існуючим контрактом.

Дивись рецепт у [extending.md](extending.md#заміна-llm-провайдера).

### 2. Категорії і нові таблиці

`Categories` живуть **у Sheet**, не в коді. Додати категорію = додати рядок у листі.

Додати новий **лист**:
1. Оновити схему в [data-model.md](data-model.md).
2. Додати JSDoc-тип у `Domain.js`.
3. Додати CRUD-функції в `Storage.js`.
4. (Опційно) Додати UI або API-ендпоїнт.

Дивись рецепти у [extending.md](extending.md).

## Чому ця архітектура

Три ключові тези:

1. **Real switchability — це переносимість даних, не коду.** Якщо колись перейдемо з Sheets на Postgres — Apps Script код буде викинутий і переписаний. Що залишиться — це чисті дані з ULID-ID, осмисленими колонками, з зафіксованими `fx_rate_eur` на кожному чеку як audit trail конвертації. Експорт у CSV → імпорт у нову систему за годину. Тому ми **не** будуємо repository-pattern, DI, service-locator. Ми будуємо чисту схему даних і документуємо її як authoritative. Див. [ADR-0001](decisions/0001-google-sheets-as-storage.md).

2. **API-шар стабільний; UI-шар змінюється.** UI еволюціонує сильно — рідкісно, що логіка save-receipt змінюється. Тому `Web.js` ендпоїнти — стабільний контракт. Якщо UI колись переноситься на SPA — він стукає в ті ж ендпоїнти.

3. **Тонкі швидкі модулі.** Domain.js, Storage.js, Fx.js, AiClient.js, Gemini.js — кожен з чіткою задачею. Ніяких "service" / "manager" / "factory" obscurations. JSDoc типи замість TypeScript build-pipeline.

## Гострі кути, до яких готуємось

Адресовано в коді / документації; ось список, щоб майбутній-ти не наступив:

- **`google.script.run` ≠ `fetch`** — все клієнт-серверне через `runServer()` Promise-обгортку. Див. [ADR-0005](decisions/0005-alpine-for-ui-no-build.md).
- **6-хв timeout на `doPost`** — щодо тривалих операцій додаємо client-side soft timeout (~25с) і user-friendly error.
- **`Session.getActiveUser().getEmail()` повертає `""`** для personal Gmail без Workspace. Fallback: explicit user-toggle у UI з `localStorage`. Тестується рано в Phase 1.
- **Service Worker не працює в iframe Apps Script** — true offline неможливий. PWA-маніфест дає home-screen icon. Якщо потрібен offline — це сигнал переходу на Cloudflare Pages.
- **Конкурентні writes** — обов'язковий `LockService` для multi-row writes. Див. [data-model.md lock rule](data-model.md#lock-rule-concurrent-writes).
- **Sheet cell limit 50 000 chars** — `raw_ocr_json` тримаємо ≤ 45 000.
- **Float money** — rounding-on-write до 2dp у `Storage.js`. Див. [ADR-0004](decisions/0004-multi-currency-eur-base.md).
- **NBU не публікує курси у вихідні/свята** — `Fx._fetchNbuUahRate` walks back до 7 днів. Якщо NBU API недоступний у момент збереження — save UAH-чеку впаде з помилкою; повтори. Див. [data-model.md FX lookup rule](data-model.md#fx-lookup-rule).
- **Hard-delete + 30-day version history** — daily CSV backup у Drive (Phase 5).

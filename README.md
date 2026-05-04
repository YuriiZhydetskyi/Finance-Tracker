# Finance Tracker

Особистий фінансовий трекер для двох. Фотографуєш чек → Gemini розпізнає товари → ти редагуєш і зберігаєш у Google Sheet. Обоє можемо додавати, редагувати, аналізувати — з телефона і з ноутбука, без власних серверів.

## Quick start (як ним користуватись)

### Як я додаю чек із магазину

1. Відкрий [web app](#) (URL після Phase 3).
2. Тицяй "Photo Receipt" → камера/галерея → знімаєш чек.
3. Чекаєш ~10 секунд, поки Gemini розпарсить.
4. Перевіряєш список товарів. Виправляєш категорії, нотатки, поділ "хто спожив". Поправляєш `consumed_by` для товарів специфічних (її косметика → `hers`, моє пиво → `his`).
5. Тиснеш "Зберегти". Готово.

### Як вона додає онлайн-витрату

1. Відкриває той самий web app.
2. Тицяє "Manual Entry" → вибирає магазин/сервіс, дату, валюту.
3. Додає рядки товарів вручну.
4. Зберігає.

### Як редагувати минулу покупку

1. "Recent" → тицяй на чек у списку.
2. Правиш що треба.
3. "Зберегти" — оновить, або "Видалити" — приберемо.

## Де живуть дані

- **Google Sheet** "Finance Tracker" — single source of truth. URL після Phase 1.
- **Drive folder** `FinanceTracker/Receipts/YYYY-MM/` — фото чеків.
- **Looker Studio dashboard** — місячна аналітика. URL після Phase 4.

## Tech stack

- Google Sheets як сховище ([ADR-0001](docs/decisions/0001-google-sheets-as-storage.md))
- Google Apps Script + clasp + Git як runtime/toolchain ([ADR-0002](docs/decisions/0002-apps-script-runtime-and-clasp.md))
- Gemini 2.5 Flash для парсингу чеків ([ADR-0003](docs/decisions/0003-gemini-with-provider-abstraction.md))
- Alpine.js + Chart.js для UI ([ADR-0005](docs/decisions/0005-alpine-for-ui-no-build.md))

## Documentation

- [docs/architecture.md](docs/architecture.md) — шари, потік даних, точки розширення
- [docs/data-model.md](docs/data-model.md) — авторитетна схема Sheet
- [docs/setup.md](docs/setup.md) — розгортання з нуля
- [docs/extending.md](docs/extending.md) — рецепти на додавання категорій, листів, провайдерів
- [docs/decisions/](docs/decisions/) — 9 ADR-ів з причинами рішень
- [conversation.md](conversation.md) — повна історія дизайн-дискусії

## Status / Roadmap

| Phase | Скоуп | Статус |
|---|---|---|
| **0** | Документація: README, ADR-и, схема, setup, extending | 🟢 In progress |
| **1** | Sheet + Apps Script scaffold + Domain/Config/Storage CRUD + Fx (ECB) | ⚪ Pending |
| **2** | Gemini.js + AiClient switch + OpenAI/Anthropic stubs + product matching | ⚪ Pending |
| **3** | Web UI: index, photo, manual, edit, recent + shared компоненти + PWA | ⚪ Pending |
| **4** | Looker Studio dashboard | ⚪ Pending |
| **5** | Polish: error log, daily CSV backup, prices.html, products.html | ⚪ Pending |

## License

Personal project, all rights reserved.

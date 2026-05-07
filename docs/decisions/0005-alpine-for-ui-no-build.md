# ADR-0005: Alpine.js для реактивності UI; без build-pipeline

- Status: superseded by [ADR-0013](0013-migrate-to-react-supabase.md) (2026-05-08)
- Date: 2026-05-04

## Context and Problem Statement

UI буде сильно еволюціонувати з часом (за словами користувача). Потрібна реактивна модель для редагування списку товарів, відображення pie chart, обробки 3-state pill для product matching. При цьому:
- Apps Script `HtmlService` рендерить HTML у sandboxed iframe.
- `google.script.run` — callback API, не fetch/Promise.
- Будь-який build-pipeline всередині Apps Script — біль.

## Considered Options

1. **Alpine.js** з CDN, без build.
2. **Vanilla JS** + руками написаний state-management.
3. **Preact + HTM** (no JSX, no build).
4. **React + Vite** з білдом і копіюванням dist у Apps Script.
5. **Окремий SPA** на Cloudflare Pages (Apps Script тільки як JSON API).

## Decision Outcome

Обрано **Alpine.js з CDN**.

UI-структура (Phase 3):
- Кожна сторінка — окремий HTML-файл (`photo.html`, `manual.html`, `edit.html`, `recent.html`, `index.html`).
- Спільні Alpine-компоненти живуть у `src/ui/shared/` як include-файли (`HtmlService.createTemplateFromFile().include()`).
- `Chart.js` з CDN для pie chart.
- `webapp.js` обгортає `google.script.run` у Promise-API:

```javascript
function runServer(fnName, args = []) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)
      [fnName](...args);
  });
}
```

Це **критична деталь**: вся UI-логіка пише `await runServer('saveReceipt', [data])` замість боротьби з callback API.

## Consequences

### Позитивні
- Нуль build, нуль npm у runtime, ~15kb gzipped Alpine з CDN.
- Декларативний стиль (`x-data`, `x-show`, `x-for`) добре вкладається в HtmlService шаблони.
- Окремі сторінки + спільні Alpine-компоненти — DRY без abstraction-fetish.
- Якщо UI стане замалим — переносимо на Cloudflare Pages SPA, JSON API залишається.

### Негативні / гострі кути
- **Service Worker не працює** в iframe Apps Script — true offline неможливий. PWA-маніфест дає home-screen icon. Якщо потрібен offline — це сигнал переходити на Cloudflare Pages.
- **Apps Script include syntax** для шаблонів — нетривіальний (`<?!= include('shared/ItemsTable') ?>`). Тестується рано.
- **Менше пакетів у екосистемі**, ніж у React. Для нашого скоупу не критично.
- **`google.script.run` ≠ `fetch`** — без `webapp.js`-обгортки UI-код стає callback hell. Worth one ADR sentence: вся клієнт-серверна комунікація мусить йти через `runServer()`.

## Pros and Cons of the Options

### 1. Alpine.js + CDN (обрано)
- ✅ Зеро build, легка реактивність, добре працює в HtmlService.
- ❌ Менше абстракцій ніж у React — для росту до десятків компонент перенос на SPA.

### 2. Vanilla JS
- ✅ Найпростіше.
- ❌ State-management руками для редагування item-списку — зростає в spaghetti.

### 3. Preact + HTM
- ✅ Reactivity без JSX і build.
- ❌ Менш популярно за Alpine; HTM-template-literals менш читаються в HtmlService-include-схемі.

### 4. React + Vite + dist у Apps Script
- ✅ Багатий екосистем.
- ❌ Build-pipeline + копіювання dist у `clasp push` — постійний біль.

### 5. SPA на Cloudflare Pages
- ✅ Свобода, true offline (Service Worker), CDN.
- ❌ Ще одна інфраструктурна одиниця, auth, CORS, окремий repo. Робиться лише при справжній потребі.

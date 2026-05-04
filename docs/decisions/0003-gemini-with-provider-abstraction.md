# ADR-0003: Gemini Flash для парсингу чеків + тонка AiClient-абстракція

- Status: accepted (revised)
- Date: 2026-05-04
- Revised: 2026-05-04 — модель `gemini-3-flash-preview` (раніше планувалось `gemini-2.5-flash`); серверна сигнатура `parseReceipt` повертає синхронно `ParsedReceipt`, не `Promise` (див. Changelog).

## Context and Problem Statement

Потрібно перетворити фото чеку (зокрема продуктових з європейських магазинів) на структурований список товарів з категоріями та матчингом до каталогу `Products`. Користувач хоче можливість легко мігрувати на іншого LLM-провайдера (OpenAI, Anthropic) у майбутньому.

## Considered Options

1. **Google Gemini Flash** (`gemini-3-flash-preview`) через AI Studio API + тонкий switch (AiClient.js) з заглушками для OpenAI/Anthropic.
2. **Azure Document Intelligence** prebuilt receipt model.
3. **Azure Document Intelligence** custom-trained моделі для 4 знайомих магазинів.
4. **OpenAI GPT-4o** як основний.

## Decision Outcome

Обрано **Gemini Flash** (`gemini-3-flash-preview`) з тонкою провайдер-абстракцією.

`AiClient.js` — це switch на 3 рядки:

```javascript
function parseReceipt(imageBytes, ctx) {
  switch (Config.AI_PROVIDER) {
    case 'gemini':    return Gemini.parseReceipt(imageBytes, ctx);
    case 'openai':    return OpenAi.parseReceipt(imageBytes, ctx);
    case 'anthropic': return Anthropic.parseReceipt(imageBytes, ctx);
    default: throw new Error(`Unknown AI_PROVIDER: ${Config.AI_PROVIDER}`);
  }
}
```

Кожен провайдер — окремий файл (`Gemini.js`, `OpenAi.js`, `Anthropic.js`) з ідентичною сигнатурою `parseReceipt(imageBytes, ctx) → ParsedReceipt`. Серверна сторона — синхронна (Apps Script `UrlFetchApp.fetch` блокує). Promise-обгортка з'являється на клієнті у Phase 3 через `runServer()` поверх `google.script.run`. Спільні типи (`ParsedReceipt`, `ParsedItem`) — у `Domain.js`.

У MVP реалізуємо тільки `Gemini.js`. `OpenAi.js` і `Anthropic.js` створюємо як **заглушки з тією ж сигнатурою**, що кидають `Error('Not implemented')` — щоб контракт був зафіксований у коді з самого початку.

## Consequences

### Позитивні
- ~$0.18/місяць за 100 чеків (vs ~$1.00 на Azure Document Intelligence prebuilt).
- Краща точність на грошових рядках продуктових чеків — Gemini розуміє абревіатури "KRGR 2% MLK" контекстуально.
- Не треба тренувати кастом-моделі для кожного магазину.
- Гнучкий промпт: можна додавати інструкції "матчити до існуючих Products", "пропонувати category", "ставити підказку consumed_by" — все в одному виклику.
- Заміна провайдера = зміна одного рядка `Config.AI_PROVIDER` + реалізація заглушки.

### Негативні / гострі кути
- **Token budget**: список ~100 існуючих продуктів у промпт → ~10–20 KB. Gemini Flash це тримає, але треба обмежувати context. Стратегія: топ-100 найчастіших + recent-30-днів-у-цьому-магазині.
- **`raw_ocr_json` cell-size limit (50 000 chars)**: зберігаємо тільки items array, не повну Gemini-відповідь. Див. [data-model.md](../data-model.md#лист-receipts).
- **JSON schema enforcement**: Gemini має structured output з JSON schema. Усе одно треба server-side валідація у `Domain.js` — модель може повернути хибне значення в enum-полі.
- **Vendor-specific нюанси**: image encoding (base64 vs URL), API endpoint, auth. Кожен провайдер розв'язує своє у своєму файлі.
- **AI matching не панацея**: продукт може бути неправильно зматчений до існуючого. Мітигація: 3-state pill в UI ([linked / new / null]) дає override.

### Параметри Gemini для MVP
- Модель: `gemini-3-flash-preview`.
- API: `generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent`.
- Auth: API key з AI Studio, зберігається у `PropertiesService.getScriptProperties()` (не в коді), переданий як `x-goog-api-key` header.
- Temperature: `0.1` (детермінізм важливіший за креатив).
- Response MIME: `application/json` через `generationConfig.responseMimeType` + `responseJsonSchema` для structured output.

## Pros and Cons of the Options

### 1. Gemini Flash + AiClient switch
- ✅ Найкраща ціна/якість для grocery line items, гнучкий промпт, легка заміна.
- ❌ JSON schema не гарантує bug-free parsing — server-side валідація все одно потрібна.

### 2. Azure Document Intelligence prebuilt receipt
- ✅ Готова модель, free tier 500 стор/місяць.
- ❌ Слабша на абревіатурах продуктових чеків; жорстка схема.

### 3. Azure custom-trained моделі (по 1 на магазин)
- ✅ Найкраща точність на знайомих макетах.
- ❌ Тренувати по 5+ зразків на кожен магазин; overhead не виправдовує.

### 4. OpenAI GPT-4o як основний
- ✅ Сильний multimodal.
- ❌ Дорожчий за Gemini Flash; підписка користувача — на Gemini.

---

## Changelog

### 2026-05-04 — Модель і signature

**Що змінилось:**
- Модель: `gemini-2.5-flash` → **`gemini-3-flash-preview`**. Gemini 3 Flash доступний, мультимодальний, підтримує `responseJsonSchema` як generationConfig. Старий `2.5-flash` вже не актуальний у 2026.
- Сигнатура: `parseReceipt(imageBytes, ctx) → Promise<ParsedReceipt>` → **`parseReceipt(imageBytes, ctx) → ParsedReceipt`** (синхронний return). Apps Script `UrlFetchApp.fetch` блокує; серверна сторона sync. Promise-обгортка живе на клієнті (Phase 3) через `runServer()` поверх `google.script.run`.

**Чому:**
- Користувач підтвердив актуальну модель при старті Phase 2.
- Sync return — чесніший контракт того, що реально відбувається на сервері. Менше плутанини при дебагу.

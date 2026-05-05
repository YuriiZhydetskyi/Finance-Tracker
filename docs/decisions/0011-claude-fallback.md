# ADR-0011: Claude Sonnet 4.6 як автоматичний fallback для Gemini

- Status: accepted
- Date: 2026-05-05

## Context and Problem Statement

Gemini 3 Flash періодично повертає 503 `UNAVAILABLE` ("This model is currently experiencing high demand"). У Phase 3 UI така помилка прокидається до користувача як фінальна — єдиний шлях далі це `manual.html`. Хочемо щоб тимчасова деградація одного провайдера не блокувала парсинг чеку.

ADR-0003 вже передбачив абстракцію `AiClient.js` із заглушками `OpenAi.js` та `Anthropic.js`. Залишається реалізувати fallback-логіку поверх неї.

## Considered Options

1. **Hardcoded Gemini → Claude fallback в AiClient** (одностороння ланцюжка). Реалізувати `Anthropic.js` через Messages API + tool_use.
2. **Generic provider chain** через `Config.AI_PROVIDERS = ['gemini', 'anthropic']` зі циклом `try/catch` по всіх. Симетрично в обидва боки.
3. **Класифікація помилок** (`_isTransient`): falling back лише на 5xx/429/network, не на 401 чи validator failures.
4. **Retry того ж провайдера** із exponential backoff замість заміни моделі.
5. **Залишити як є**: показати помилку, юзер натискає `manual` і вписує товари вручну.

## Decision Outcome

Обрано **Option 1**: hardcoded Gemini → Claude fallback. На будь-яку помилку Gemini викликаємо `Anthropic.parseReceipt(imageBytes, ctx)`. Якщо Claude теж падає — кидаємо combined error із обома повідомленнями.

```javascript
_geminiWithClaudeFallback(imageBytes, ctx) {
  try {
    return Gemini.parseReceipt(imageBytes, ctx);
  } catch (geminiErr) {
    Logger.log(`AiClient: Gemini failed, falling back to Claude. Gemini error: ${geminiErr.message}`);
    try {
      return Anthropic.parseReceipt(imageBytes, ctx);
    } catch (claudeErr) {
      throw new Error(`AI parsing failed (both providers). Gemini: ${geminiErr.message} | Claude: ${claudeErr.message}`);
    }
  }
}
```

`Anthropic.js` реалізовано через Messages API із forced tool_use:
- Endpoint: `https://api.anthropic.com/v1/messages`.
- Headers: `x-api-key`, `anthropic-version: 2023-06-01`.
- Модель: `claude-sonnet-4-6` (alias до останнього Sonnet 4.6 snapshot).
- Structured output: `tools: [{ name: 'record_receipt', input_schema }]` + `tool_choice: { type: 'tool', name: 'record_receipt', disable_parallel_tool_use: true }`. Парсимо `wrapper.content[].input` із tool_use блоку.
- Промпт і JSON schema **переюзаються** з `Gemini._buildPrompt(ctx)` / `Gemini._buildSchema(ctx)` напряму через cross-module call.

## Consequences

### Позитивні
- Тимчасові 5xx/429 на боці Gemini більше не пробивають у UI.
- Користувач не бачить різниці — обидві моделі повертають той самий `ParsedReceipt`, бо проходять однаковий `Domain.validateParsedReceipt`.
- Reuse `_buildPrompt`/`_buildSchema` запобігає prompt drift: завантажений prompt із інструкціями про Pfand/Leergut/cancellation не може розійтись між провайдерами.
- `Logger.log` на кожному переключенні робить fallback rate видимою у Apps Script Executions — побачимо, якщо Gemini деградує до 100%.

### Негативні / гострі кути
- **Cost**: один зайвий виклик Claude на failure path. Sonnet 4.6 при ~$3/MTok input + ~$15/MTok output, типовий чек ~3K input + 1K output → ~$0.024 за fallback. На MVP-обсягах (<10 чеків/тиждень) це <$1/місяць навіть якщо весь трафік піде у fallback.
- **Latency**: на failure path юзер чекає Gemini timeout + повний Claude call. Apps Script `UrlFetchApp` блокує, UI має лоадер — терпимо.
- **Триггер на ВСІ помилки**, не лише транзієнтні. Свідомий компроміс: 401 (bad API key) дасть один зайвий виклик Claude замість fail-fast, але це коштує копійки і простіше у коді. Validator failure (Gemini повернув malformed JSON) — Claude може зпарсити те саме фото краще, тож retry виправданий.
- **Префікс `_`** на `Gemini._buildPrompt`/`_buildSchema` — це convention "private до модуля". Виклик із `Anthropic.js` цю convention порушує. Прийнятно: prompt — це load-bearing prose, дублювання гірше за convention violation. Обидві функції — pure, без Apps Script залежностей.
- **Symmetry відсутня**: якщо `Config.AI_PROVIDER = 'anthropic'` напряму, fallback на Gemini НЕ спрацює. Це навмисно — `'gemini'` залишається default'ом, а `'anthropic'` — це manual override для дебагу.
- **JSON schema із Cyrillic enum** ("Бакалія", "Молочка"): Anthropic enforce'ить tool input_schema суворіше за Gemini. Якщо Claude почне продукувати категорії не з enum — додамо `strictEnum: false` параметр до `_buildSchema`. Поки поведінку не спостерігали.
- **Нова Script Property** `ANTHROPIC_API_KEY`. Без неї fallback кине `Missing Script Property` при першому виклику.

### Параметри Anthropic
- Модель: `claude-sonnet-4-6`.
- API: `https://api.anthropic.com/v1/messages`.
- Auth: `x-api-key` + `anthropic-version: 2023-06-01`.
- Image: `{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }` (mirror Gemini's hardcoded JPEG).
- Temperature: переюзає `Config.AI_TEMPERATURE = 0.1`.
- Max tokens: `Config.ANTHROPIC_MAX_TOKENS = 4096`.

## Pros and Cons of the Options

### 1. Hardcoded Gemini → Claude fallback (обрано)
- ✅ Мінімальна зміна архітектури; одна нова функція в AiClient.
- ✅ Легко тестується (стаб два globals у `aiclient.test.js`).
- ❌ Не екстендиться на третього провайдера без редагування коду.

### 2. Generic provider chain
- ✅ Декларативно у Config; додавання провайдера = додати рядок у масив.
- ❌ Premature abstraction для двох провайдерів. CLAUDE.md явно радить уникати таких abstractions поки не є ≥3 кейсів.

### 3. Класифікація помилок (`_isTransient`)
- ✅ Не витрачає Claude tokens на 401/конфіг-баги, які retry не виправить.
- ❌ Ще одна функція з pattern-matching на error messages — крихка (Gemini може змінити формат повідомлення). Економія в найгіршому сценарії — пара центів. YAGNI.

### 4. Retry Gemini з backoff
- ✅ Не вводить новий провайдер, не вимагає API key.
- ❌ 503 "high demand" триває хвилини; backoff на 10s не допомагає. Юзер не чекає.

### 5. Залишити як є (manual fallback)
- ✅ Нуль коду.
- ❌ Розбиває UX. Юзер уже сфоткав чек — ремаппити вручну псує сенс automation'у.

---

## Changelog

(Без змін з моменту створення.)

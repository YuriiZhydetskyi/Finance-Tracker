# ADR-0001: Google Sheets як основне сховище

- Status: superseded by [ADR-0013](0013-migrate-to-react-supabase.md) (2026-05-08)
- Date: 2026-05-04

## Context and Problem Statement

Двом людям (парі) потрібен спільний фінансовий трекер з можливістю редагувати дані з телефона і ноутбука без власних додатків. Очікуваний обсяг — до ~200 чеків на місяць, ~50 line items на чек у середньому = ~10 000 рядків `Items` на рік. Дані мають залишатися доступними і зрозумілими навіть якщо програмний шар зламається або проєкт буде покинуто.

## Considered Options

1. **Google Sheets** — спільна таблиця, обидва акаунти редактори.
2. **SQLite + self-hosted UI** на якомусь VPS / Cloudflare D1.
3. **Postgres + self-hosted backend** на Azure / Cloudflare.
4. **Firebase Firestore** з мобільним PWA.

## Decision Outcome

Обрано **Google Sheets**.

Sheet виступає як authoritative store. Apps Script виконує читання/запис через `SpreadsheetApp` API, плюс додатково забезпечує конкурентність через `LockService.getScriptLock()` для multi-row writes (правило [data-model.md](../data-model.md#lock-rule-concurrent-writes)). DocumentLock тут не підходить — він повертає null для standalone скриптів.

## Consequences

### Позитивні
- Нуль інфраструктури, нуль витрат.
- Обидва партнери можуть правити дані з будь-якого пристрою без встановлення додатків.
- Якщо UI зламається — дані залишаються повністю доступними і редагованими у Sheet.
- Резервні копії автоматичні (Google Drive version history, ~30 днів).
- Експорт у CSV для міграції — за один клік.
- Looker Studio підключається як data source без посередників.

### Негативні
- Складна аналітика (joins, віконні функції) повільніша за SQL — для нашого обсягу не критично.
- Ручне редагування у Sheet **обходить валідацію** Apps Script — користувач може зламати інваріанти. Мітигація: правила записані в [data-model.md](../data-model.md), періодична валідація в Phase 5.
- Конкурентні записи можуть гонитись — обов'язковий `LockService` навколо multi-row writes.
- Hard-delete втрачається після 30 днів version history — мітигується daily CSV backup у Phase 5.
- Apps Script має ліміти (6 хв/виконання, 20 000 URL Fetch/день) — для двох людей далеко за межами реальності.

### Schema-evolution rule (наслідок)
Для безпеки коду при ручному редагуванні Sheet:
- Додавати колонки можна тільки в **кінець** листа.
- Не переставляти, не перейменовувати, не видаляти колонки під час MVP.
- Storage-код посилається на колонки за **іменем заголовка**, не за позицією.

## Pros and Cons of the Options

### 1. Google Sheets
- ✅ Нуль інфра, обидва партнери редактори, ручний доступ як fallback, безкоштовно.
- ❌ Ручне редагування обходить валідацію; ліміти cell-size (50 000 chars).

### 2. SQLite + self-hosted UI
- ✅ Реальний SQL, повна валідація.
- ❌ Інфра, бекапи, нема ручного доступу як fallback, мобільний UI треба будувати з нуля.

### 3. Postgres + self-hosted backend
- ✅ Найпотужніший варіант для росту.
- ❌ Overkill для 2 людей; платний хостинг або складніший free-tier setup.

### 4. Firebase Firestore
- ✅ Мобільний-first, real-time sync.
- ❌ Ще одна система, vendor lock-in глибший за Sheets, нема прозорого fallback.

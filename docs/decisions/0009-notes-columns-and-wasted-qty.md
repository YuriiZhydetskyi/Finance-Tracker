# ADR-0009: Notes як прості колонки на Receipt/Item; spoilage як `wasted_qty` колонка

- Status: accepted
- Date: 2026-05-04

> **Changelog 2026-05-06**: той самий «вузька-колонка-замість-таблиці» патерн застосовано для знижок — додано колонку `Items.discount_orig`. Деталі і evolution rule — у [ADR-0012](0012-cancellation-discount-grouping.md).


## Context and Problem Statement

Користувач хоче:
1. Додавати **коментарі** до чеків і окремих товарів — "купили на знижці", "для вечірки", "вирішили спробувати".
2. Позначати **зіпсоване**: купили продукт зі знижкою, але не встигли спожити — порахувати втрати.

Питання: як це інтегрувати в схему?

## Considered Options

### Для notes
- A1. Колонки `note` на `Receipts` і `Items`.
- A2. Окрема таблиця `Notes` з `(target_type, target_id, text, created_at)`.

### Для spoilage
- B1. Колонка `wasted_qty` на `Items`.
- B2. Окрема таблиця `Spoilage` з `(item_id, qty, wasted_at, reason)`.

## Decision Outcome

### Notes — варіант A1 (колонки)
- `Receipts.note` (string, nullable).
- `Items.note` (string, nullable).
- AI **не заповнює** ці поля — він не знає мотивації покупки.
- UI показує іконку 📝 поряд з рядком; click розгортає textarea.

### Spoilage — варіант B1 (колонка)
- `Items.wasted_qty` (number, default 0, ≤ qty).
- `wasted_value_eur = (wasted_qty / qty) * total_eur` — обчислюється в Looker, не зберігається.
- UI кнопка "позначити зіпсоване" в `recent.html` або `edit.html` (Phase 3+).

## Consequences

### Позитивні (notes)
- Тривіально читати/писати. Жодних JOIN-ів.
- Одне поле = одна нотатка. Простий ментальний модель.
- AI не плутає нотатку з парсом — поле просто завжди nullable і AI не повертає його.

### Позитивні (spoilage)
- Одна цифра на item. Аналітика natural: `SUM(wasted_value_eur) GROUP BY category`.
- Net savings: `(reference_price - actual_price) * (qty - wasted_qty) - actual_price * wasted_qty`.

### Негативні / обмеження
- Notes — **одна** на receipt і **одна** на item. Якщо колись захочемо historical chain коментарів (як у issue tracker) — переносимо в окрему таблицю. Поки не треба.
- Spoilage — фіксує **загальну** кількість зіпсованого. Не підтримує "викинули в 2 етапи з різницею в днях". Якщо колись стане потрібно — заміняємо колонку на таблицю `Spoilage(item_id, qty, wasted_at)`. Backward-compatible: лишаємо колонку як derived `SUM(qty)`.

### Чому AI не заповнює notes
- "Купили на знижці" — це знання користувача, не чеку.
- "Для вечірки" — мотивація, не дані.
- AI вигадуватиме нотатки і це гірше ніж їх відсутність.

## Pros and Cons of the Options

### Notes A1 — колонки (обрано)
- ✅ Простота, нуль JOIN-ів, single-record-per-thing semantics.
- ❌ Одна нотатка на entity; немає історії змін.

### Notes A2 — окрема таблиця
- ✅ Багато нотаток на одну сутність, історія.
- ❌ Overhead для нашого use-case; кожен запит требує JOIN.

### Spoilage B1 — колонка (обрано)
- ✅ Простота, моделює реальність 1:1 для більшості випадків.
- ❌ Не підтримує multi-event списання.

### Spoilage B2 — окрема таблиця
- ✅ Аудит, multi-event.
- ❌ Overkill для пари людей; складніша агрегація.

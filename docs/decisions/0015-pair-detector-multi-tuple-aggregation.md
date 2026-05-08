# ADR-0015: Pair-detector v2 — multi-tuple support + identical-positive aggregation

- Status: accepted
- Date: 2026-05-08
- Extends: [ADR-0012](0012-cancellation-discount-grouping.md), [ADR-0014](0014-cancellations-as-zero-rows.md)

## Context and Problem Statement

Перша ітерація pair-detector обмежувала групування `if (indices.length !== 2) return` — тільки дві позиції з однаковою назвою могли скластися в пару. Це давало консервативну, але обмежену поведінку. На практиці виникли два кейси, що випадали:

1. **Cashier punched twice, voided once** — типовий фейл-сейф: касир пробив товар, помітив, що пробив зайвий раз, і відмінив один з них. Сирий чек має 3 рядки з однаковою назвою: `[+X, +X, -X]`. Користувач очікує побачити «один товар куплений + одна випадкова пара». Стара логіка пропускала всі три, лишала розгрупованими — користувач бачив три рядки замість двох.

2. **Multi-buy of identical items** — 4 ківі поштучно за €0.50 → 4 окремі рядки на чеку. Логічно показати один рядок з `qty=4`. Стара логіка лишала їх розгрупованими (4 рядки в формі — шум). User wording: «треба групувати по назві, якщо і назва і ціна співпадають».

Обмеження «rule of 2» було обрано в ADR-0012 свідомо («Conservative: 3+ занадто неоднозначно — користувач має розібратись сам»). Реальне використання показало: на практиці 3+ майже завжди має очевидну інтерпретацію (касир + voids), і консерватизм створює більше шуму, ніж захищає.

## Decision Outcome

Замінити одно-прохідний алгоритм на трипрохідний (`packages/domain/src/pair-detector.ts`):

### Pass 1 — exact cancellation pairs (per name-group)

Для кожного негативу `n` в групі (за порядком індексу) шукаємо першого *неспареного* позитиву `p` де `qty_match` (Δ ≤ 0.001) і `roundCents(p.qty × p.unit_price) === roundCents(|n.qty × n.unit_price|)`. Match → `p` стає `cancelled` (zero out price/discount), `n` skip. Працює і для груп розміру 2, і для 3+.

### Pass 2 — discount pairs (per name-group)

Для кожного *НЕспарованого* негативу `n` шукаємо неспарений позитив де `qty_match` і `pos_total > |neg_total|`. Match → `p` стає `discount-merged` з `discount_orig = |neg.unit_price|`, `n` skip. Лишок (refund > purchase, lone Pfand) — untouched.

### Pass 3 — orthogonal aggregation (across all surviving items)

Збираємо результат після Pass 1+2 (включно з cancelled і discount-merged рядками) і групуємо за композитним ключем:

```
key = (normalized_name, roundCents(unit_price_orig), roundCents(discount_orig), marker?.kind ?? 'normal')
```

Для груп розміру ≥ 2 — мердж: `qty = sum(member.qty)`, marker kind переноситься з членів (всі однакові за конструкцією ключа), `count = group.length`.

### Marker shape

```ts
type PairMarker =
  | { kind: 'cancelled'; count: number }       // count=1 default; ≥2 if Pass 3 fired
  | { kind: 'discount-merged'; count: number }
  | { kind: 'aggregated'; count: number };     // count ≥ 2; pure positives merged
```

`count` завжди present (default 1) — простіше для consumer-коду, не треба defending against undefined.

### Visual treatment in ItemRow

- **`cancelled` count=1**: amber border, "⚠ Пробито випадково · автоматично згруповано", €0 footer. (Без змін з ADR-0014.)
- **`cancelled` count ≥ 2**: same amber, badge "⚠ Пробито випадково · {count} однакові пари згруповано".
- **`discount-merged` count=1**: emerald, "🏷 Знижка · автоматично згруповано", triblock footer. (Без змін.)
- **`discount-merged` count ≥ 2**: same emerald, badge "🏷 Знижка · {count} однакові пари згруповано", triblock з summованою qty.
- **`aggregated`** (новий): subtle slate background `bg-slate-50/50`, badge "🔗 {count} рядки з чека згруповано", normal footer. **Без виразного бордеру** — user explicitly said «не сильно виділялось».

## Consequences

### Позитивні
- Реальні receipts з 3+ дубльованими назвами тепер мають очевидний UI: pair-cancel + рештку видно окремо.
- Multi-buy (4 ківі) одразу показується одним рядком — менше шуму.
- Discount/cancellation сценарії від ADR-0014 не змінюються (`count=1` поведінка ідентична).

### Негативні / обмеження
- **Heterogeneous aggregation навмисно НЕ робиться**. `[+5, +5, -1]` — тільки одна позиція має знижку — pair-merge однієї робить її key=`(name, 5, 1, discount-merged)`, інша лишається з key=`(name, 5, 0, normal)`. Різні keys → не зливаються. Per user clarification: "Якщо у нас один має знижку, а інший ні — то їх не групуємо. Згрупуємо один із них із знижкою, а інший буде окремим рядком."
- **Qty splitting не підтримується**. `[+2 × X, -1 × X]` (2 куплено, 1 повернуто) — qty mismatch у pass 1+2 → лишаються розгрупованими. Pass 3 теж не зливає (різні qty не складаються в один сабсет). User-handled manually. Edge case, рідкісний.
- **Markers не персистяться**. Aggregated row у БД виглядає як звичайний рядок з summованою `qty` — у `/edit/$id` буде показано як normal без бейджа. Це консистентно з ADR-0014 (markers — UI-only).
- **Stable ordering** для cancellation у груп з 3+: claim бере перший позитив за вхідним індексом. Альтернативи (latest first, by total) не очевидні; first-by-index — найпередбачуваніший варіант.

## Pros and Cons of the Options

### A1 — лишити rule-of-2 (status quo, відхилено)
- ✅ Найпростіше; conservative.
- ❌ Не вирішує жоден з двох виявлених кейсів. User stuck redoing pair-detection mentally.

### A2 — extend rule-of-2 → handle 3+ (обрано)
- ✅ Покриває 3-tuple cancellation; consistent з вже-існуючим UI для cancelled/discount-merged.
- ❌ Дещо більше logic; tests розширюються.

### B1 — без aggregation (відхилено)
- ✅ Simple.
- ❌ 4 ківі лишаються 4 рядками — той самий шум, що user скаржився.

### B2 — aggregation by `(name, unit_price)` тільки на ідентичних positives (відхилено в користь B3)
- ✅ Простіше.
- ❌ Не вкриває кейс «обидва товари мають однакову знижку» (B → 1 row qty=2 expected by user).

### B3 — orthogonal aggregation by composite key (обрано)
- ✅ Універсально: працює для positives, для cancelled, для discount-merged. Все за одним правилом.
- ✅ Точно покриває user's wording: дві однакові пари → одна; один з знижкою + один без → дві окремі.
- ❌ Дещо складніший composite key.

### C1 — `count` optional, only on aggregated (відхилено)
- ✅ Менший shape change.
- ❌ Consumer-код мусить розрізняти undefined vs 1; легко забути; типи ускладнюються.

### C2 — `count: number` always present, default 1 (обрано)
- ✅ Single shape; consumer reads `marker.count` без if-undefined.
- ❌ Невеликий redundancy для simple pairs.

## References
- [ADR-0012](0012-cancellation-discount-grouping.md) — оригінальний design (clientside detection + `discount_orig` column).
- [ADR-0014](0014-cancellations-as-zero-rows.md) — inversion §C1: cancellations as inline €0 rows.
- [pair-detector.ts](../../packages/domain/src/pair-detector.ts), [pair-detector.test.ts](../../packages/domain/src/pair-detector.test.ts), [ItemRow.tsx](../../web/src/features/receipts/components/ItemRow.tsx).

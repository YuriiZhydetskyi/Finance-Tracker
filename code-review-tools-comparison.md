# Порівняння інструментів code review для PR #2 (`add-manual-json-input`)

## Контекст

- **Гілка:** `add-manual-json-input` vs `main`
- **Розмір:** 2 коміти, 12 файлів, +384 / -38
- **Фіча:** "Paste AI JSON" — користувач сам прогнав prompt у external AI tool (ChatGPT / Claude desktop тощо) і пастить отриманий JSON у діалог замість round-trip через Edge Function. Валідація через `ParsedReceiptSchema`, JSON додається в існуючу batch-карусельку як новий `BatchItem` з `source: 'manual-json'`, зберігається через `useSaveReceiptMutation` (без upload фото).
- **Дата ревю:** 2026-05-25
- **Перевірені інструменти:** Qodo, Claude Code `/review` (два окремі запуски), Greptile, CodeRabbit

Нижче — сирі результати від кожного інструменту в порядку отримання, потім зведена таблиця і висновки.

---

## 1. Qodo

> Code Review by Qodo
>
> 🐞 Bugs (2) 📘 Rule violations (0)
>
> ### Action required
>
> **1. Form state reused across receipts** 🐞 Bug ≡ Correctness
>
> **Description**
>
> `BatchReviewCarousel` renders the current parsed receipt's `PhotoReviewForm` without a remount key, so navigating between parsed items can reuse the same react-hook-form instance and mutation state. This can show/edit previous receipt values and then save them for the newly selected batch item.
>
> **Code**
>
> `web/src/features/photo/components/BatchReviewCarousel.tsx[R233-239]`
>
> **Evidence**
>
> The carousel supports switching between items, but renders a single Slide for the current item without a remount key; Slide renders `PhotoReviewForm` (also without a key). `PhotoReviewForm` initializes its form via `useReceiptForm(initialFromParsed)`, and `useReceiptForm` uses `useForm({ defaultValues: ...initial })`, which does not automatically re-apply defaults when props change—so state can carry across items.
>
> - `web/src/features/photo/components/BatchReviewCarousel.tsx[145-163]`
> - `web/src/features/photo/components/BatchReviewCarousel.tsx[231-240]`
> - `web/src/features/photo/components/PhotoReviewForm.tsx[70-105]`
> - `web/src/features/receipts/hooks/use-receipt-form.ts[32-52]`
> - `web/src/features/photo/components/PhotoReviewForm.tsx[168-177]`
>
> **Agent prompt**
>
> The issue below was found during a code review. Follow the provided context and guidance below and implement a solution
>
> ### Issue description
>
> Batch navigation switches `current` item via `goto(idx)`, but the rendered `Slide`/`PhotoReviewForm` subtree is not remounted per item. Because `PhotoReviewForm` uses `useReceiptForm()` (react-hook-form `defaultValues`) and holds `useMutation()` state, switching between receipts can retain the previous receipt's form values and save/error state.
>
> ### Issue Context
>
> - `useReceiptForm()` passes `defaultValues: { ...initial }` to `useForm()`, which are applied only on initial mount.
> - The carousel allows navigation between items, but the current `Slide` is rendered without a `key`, and `PhotoReviewForm` is also rendered without a `key`.
>
> ### Fix Focus Areas
>
> - `web/src/features/photo/components/BatchReviewCarousel.tsx[145-163]`
> - `web/src/features/photo/components/BatchReviewCarousel.tsx[231-240]`
> - `web/src/features/photo/components/PhotoReviewForm.tsx[70-105]`
> - `web/src/features/receipts/hooks/use-receipt-form.ts[32-52]`
>
> ### Suggested fix
>
> Add a React `key` based on the current batch item id (e.g. `key={current.id}` on `<Slide ... />` or `key={item.id}` on `<PhotoReviewForm ... />`) so the form/mutation state remounts per receipt. Alternatively, implement an explicit `methods.reset(...)` in `PhotoReviewForm` when `parsed` changes, but keying is simpler and avoids subtle state leaks.
>
> ---
>
> ### Remediation recommended
>
> **2. Dialog state persists when closed** 🐞 Bug ☼ Reliability
>
> **Description**
>
> `ManualJsonImportDialog` returns `null` when `open` is `false` but remains mounted, so `jsonText`, `error`, and `copyState` persist across close/reopen. Closing via Cancel/Close can reopen the dialog with stale pasted JSON, previous validation errors, or a stuck "Copied/Copy failed" state.
>
> **Code**
>
> `web/src/features/photo/components/ManualJsonImportDialog.tsx[R101-107]`
>
> **Evidence**
>
> The dialog stores `jsonText`, `error`, and `copyState` in component state and hides itself via `return null` when closed; both Close and Cancel call only `onClose()` (no state reset). Because the parent keeps rendering the component and only toggles `open`, the component remains mounted and state will persist across open/close cycles.
>
> - `web/src/features/photo/components/ManualJsonImportDialog.tsx[101-107]`
> - `web/src/features/photo/components/ManualJsonImportDialog.tsx[118-135]`
> - `web/src/features/photo/components/ManualJsonImportDialog.tsx[146-206]`
> - `web/src/routes/photo.tsx[67-79]`
>
> **Agent prompt**
>
> The issue below was found during a code review. Follow the provided context and guidance below and implement a solution
>
> ### Issue description
>
> The dialog component is always rendered by the parent and uses `if (!open) return null;`, which hides it but does not unmount it. As a result, local state (`jsonText`, `error`, `copyState`) persists between openings unless explicitly reset.
>
> ### Issue Context
>
> - Users can close the dialog via "Close" or "Cancel" without submitting.
> - Only `jsonText` is cleared on successful submit; `error` and `copyState` are never reset.
>
> ### Fix Focus Areas
>
> - `web/src/features/photo/components/ManualJsonImportDialog.tsx[101-135]`
> - `web/src/features/photo/components/ManualJsonImportDialog.tsx[146-206]`
>
> ### Suggested fix
>
> Introduce an internal `handleClose()` that resets `jsonText`, `error`, and `copyState` to initial values before calling `onClose()`, and use it for both Close/Cancel buttons. Optionally also reset state in a `useEffect` when `open` transitions from true → false.

**Примітка:** Qodo пізніше залишив той самий Issue #1 у вигляді inline-коментаря на `BatchReviewCarousel.tsx:233-239`. Це дубль першого пункту, не нова знахідка.

---

## 2. Claude Code `/review` — запуск 1

> ### Code Review — branch `add-manual-json-input` vs main
>
> (No gh CLI on this machine, so I reviewed the local branch directly. 2 commits, 12 files, +384/-38.)
>
> **Overview**
>
> Adds a "Paste AI JSON" entry point on `/photo` so a user can paste a receipt JSON they already parsed with an external AI (ChatGPT/Claude desktop, etc.) instead of round-tripping through the Edge Function. The pasted JSON is validated by `ParsedReceiptSchema`, pushed into the existing batch carousel as a new `BatchItem` kind (`source: 'manual-json'`, no blob, no preview), and saved via `useSaveReceiptMutation` (bypassing photo upload) when `PhotoReviewForm` sees no blob.
>
> Also adds `.coderabbit.yml` (chill profile, ESLint disabled because CI already runs it, docstrings off to match project convention).
>
> **What's good**
>
> - Reducer/hook extension is clean: a new `BatchAction` (`manualParsed`) instead of overloading `enqueued`, and the carousel handles it via the existing `parsed` status branch.
> - Validation happens at the right boundary — `ParsedReceiptSchema.safeParse` in the dialog, before anything reaches the form. Matches the ports-and-adapters discipline in CLAUDE.md.
> - Reuses `PhotoReviewForm` rather than forking it; the `photoBlob?: Blob | null` widening + conditional `savePhoto` vs `saveReceipt` is a small, localized change.
> - Tests cover the reducer (`batch-reducer.test.ts:79-100`), the hook (`use-batch-parser.test.tsx:211-225`), and the carousel `makeItem` shape update for `source`.
> - `normalizeCandidate` quietly unwraps the common `{ receipt: {...}, items: [...] }` shape AI tools often produce — nice touch.
>
> **Issues worth addressing**
>
> **1. `source: 'photo'` is hardcoded for pasted-JSON receipts (likely a data-integrity bug)**
>
> `PhotoReviewForm.tsx:132`: `source: 'photo' as const` is set regardless of whether a `photoBlob` exists. A manually-pasted-JSON receipt lands in the DB with `source = 'photo'` and `photo_url = null`. That's indistinguishable from "photo upload failed mid-save", and it pollutes any stats/filtering segmented by `source`.
>
> The schema already supports `'manual' | 'photo' | 'edit'` (`schemas.ts:37`). Suggest threading the `BatchItem` source through the form (or accept a `source` prop) and emit `'manual'` for pasted-JSON. Worth confirming intent with the user — if the goal is "this still came from AI, just not our Edge Function", a new `'photo'` variant or a fourth enum value would communicate that better.
>
> **2. `ManualJsonImportDialog` has no tests**
>
> The dialog contains the most fragile new logic (fenced-code extraction, `{...}` slice fallback, `normalizeCandidate`, Zod error formatting) and zero coverage. At minimum: a unit test for `parseJsonText` covering raw JSON, ` ```json ` fences, ` ``` ` fences, leading/trailing prose around `{...}`, and empty input. These are pure functions — easy to extract and test.
>
> **3. Dialog UX: no Esc, no backdrop click, no focus management**
>
> `ManualJsonImportDialog.tsx:137-209` is a `role="dialog"` overlay built on a plain `<div>`. Missing:
>
> - Esc-to-close
> - Backdrop click closes
> - Focus moves into the dialog on open, returns to the trigger on close
> - Form state (`jsonText`, `error`) persists across close/reopen — opening it again shows stale paste + error from the last attempt
>
> The rest of the codebase uses the native `<dialog>` element with `showModal()` (`DeleteConfirmDialog` per CLAUDE.md "things that bit us"). Switching to that would handle Esc + focus trap for free; jsdom-stub pattern is already documented for tests.
>
> **4. Zod error message drops `issue.path`**
>
> `ManualJsonImportDialog.tsx:126`: `parsed.error.issues.map((issue) => issue.message).join('; ')`. When a paste fails because (say) `items[3].qty` is 0, the user just sees "qty must be positive number" with no hint which item. Suggest `${issue.path.join('.')}: ${issue.message}`.
>
> **5. `aria-modal="true"` on the `<form>` instead of a wrapping `<div>`**
>
> Minor markup nit: combining `role="dialog"` + `aria-modal` on the same element that's also a `<form>` is unusual. Screen readers will treat it correctly, but conventional structure is `<div role="dialog">…<form>…</form>…</div>`. Will resolve itself if you switch to native `<dialog>` (item 3).
>
> **Smaller notes**
>
> - `fileName: 'Pasted AI JSON'` is duplicated as a string literal in two places (`use-batch-parser.ts:89` and the test); a shared constant would help, and labelling repeat pastes (`Pasted AI JSON #2`, …) would make the carousel dots distinguishable when the user pastes multiple times.
> - `addParsedReceipt` sets `currentIndex` to the new item, so pasting yanks focus mid-batch. Probably intended (it's an explicit user action), but worth confirming if pastes can happen while other items are still parsing.
> - `.coderabbit.yml` rationale comments are good; consider adding `path_filters:` to skip `legacy/apps-script/` so the bot doesn't review frozen code.
> - `useSaveReceiptMutation` is `import { useSaveReceiptMutation }` next to `useSavePhotoReceiptMutation` — fine, but a tiny refactor opportunity: the per-mutation `isPending`/`error` merge in `PhotoReviewForm.tsx:172-177` would disappear if `useSavePhotoReceiptMutation` accepted an optional blob and delegated internally.
>
> **Risk**
>
> - Highest: issue #1 — wrong `source` is a persistent DB-level artifact that compounds over time. Cheap to fix now, awkward to backfill later.
> - Medium: issues #2, #3 — quality-of-life, not correctness.
> - Low: everything else.
>
> **Suggested CI gate before merge**
>
> Per CLAUDE.md "Before declaring code changes done": run `npm run lint && npm run typecheck && npm run test` — the pre-commit hook only runs Prettier, so ESLint will fire first in CI.

---

## 3. Greptile

> **greptile-apps Bot reviewed 3 hours ago**
>
> `web/src/features/photo/components/PhotoReviewForm.tsx`
> Comment on lines +132 to +155
>
> ```ts
>       source: 'photo' as const,
>       note: values.note ?? null,
>       raw_ocr_json: values.raw_ocr_json ?? null,
>     };
>     const items = values.items.map((it) => ({
>       product_id: it.product_id ?? null,
>       product_name: it.product_name,
>       store_product_code: it.store_product_code ?? null,
>       category: it.category,
>       qty: it.qty,
>       unit_price_orig: it.unit_price_orig,
>       consumed_by: it.consumed_by,
>       note: it.note ?? null,
>       wasted_qty: it.wasted_qty ?? 0,
>       wasted_at: it.wasted_at ?? null,
>       discount_orig: it.discount_orig ?? 0,
>     }));
>
>     const result = photoBlob
>       ? await savePhoto.mutateAsync({ receipt, items, photoBlob })
>       : await saveReceipt.mutateAsync({
>           receipt: { ...receipt, photo_url: null },
>           items,
>         });
> ```
>
> **P1 `source: 'photo'` hardcoded for the no-photo save path**
>
> Every manual JSON receipt is persisted to the DB with `source = 'photo'` even though no photo was uploaded (`photo_url` is `null`). The Postgres enum is `('photo', 'manual', 'edit')` and `'manual'` already exists precisely for receipts that weren't created via the photo pipeline. Any future query or UI that filters by `source` to find "real" photo receipts will incorrectly include these manual-import rows.
>
> The fix is to make `source` conditional on whether `photoBlob` is present:
>
> ```ts
> source: photoBlob ? ('photo' as const) : ('manual' as const),
> ```
>
> ---
>
> `web/src/features/photo/components/ManualJsonImportDialog.tsx`
> Comment on lines +101 to +116
>
> ```ts
> export function ManualJsonImportDialog({ open, categories, products, onClose, onImported }: Props) {
>   const prompt = useMemo(() => buildPrompt(categories, products), [categories, products]);
>   const [jsonText, setJsonText] = useState('');
>   const [error, setError] = useState<string | null>(null);
>   const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
>
>   if (!open) return null;
>
>   const handleCopyPrompt = async () => {
>     try {
>       await navigator.clipboard.writeText(prompt);
>       setCopyState('copied');
>     } catch {
>       setCopyState('failed');
>     }
>   };
> ```
>
> **P2 Dialog state persists between opens — stale error and copy indicator**
>
> Because `if (!open) return null` short-circuits the render without unmounting the component, all `useState` values (`jsonText`, `error`, `copyState`) survive across close/reopen cycles. A user who gets a validation error, closes the dialog, and reopens it will still see the red error banner from the previous attempt. `copyState` also never resets to `'idle'`, so the "Copied" label is sticky for the entire page session.
>
> Adding a `useEffect` that resets transient UI state when `open` transitions to false would fix both:
>
> ```ts
> useEffect(() => {
>   if (!open) {
>     setError(null);
>     setCopyState('idle');
>   }
> }, [open]);
> ```
>
> If keeping `jsonText` on reopen is intentional (so users can continue where they left off), it can be omitted from the reset.

---

## 4. CodeRabbit

> `web/src/features/photo/components/ManualJsonImportDialog.tsx`
> Comment on lines +67 to +77
>
> ```ts
> function normalizeCandidate(value: unknown): unknown {
>   if (value && typeof value === 'object' && !Array.isArray(value)) {
>     const record = value as Record<string, unknown>;
>     if (
>       record.receipt &&
>       typeof record.receipt === 'object' &&
>       !Array.isArray(record.receipt) &&
>       Array.isArray(record.items)
>     ) {
>       return { ...(record.receipt as Record<string, unknown>), items: record.items };
>     }
> ```
>
> **coderabbitai Bot — ⚠️ Potential issue | 🟡 Minor | ⚡ Quick win**
>
> **Handle nested `receipt.items` payloads in normalization.**
>
> `normalizeCandidate` currently misses `{ receipt: { ..., items: [...] } }`, so valid pasted payloads can fail schema validation unnecessarily.
>
> **Proposed fix**
>
> ```diff
>  function normalizeCandidate(value: unknown): unknown {
>    if (value && typeof value === 'object' && !Array.isArray(value)) {
>      const record = value as Record<string, unknown>;
> +    const receipt =
> +      record.receipt && typeof record.receipt === 'object' && !Array.isArray(record.receipt)
> +        ? (record.receipt as Record<string, unknown>)
> +        : null;
> +
>      if (
> -      record.receipt &&
> -      typeof record.receipt === 'object' &&
> -      !Array.isArray(record.receipt) &&
> -      Array.isArray(record.items)
> +      receipt &&
> +      (Array.isArray(record.items) || Array.isArray(receipt.items))
>      ) {
> -      return { ...(record.receipt as Record<string, unknown>), items: record.items };
> +      return { ...receipt, items: (record.items ?? receipt.items) as unknown[] };
>      }
>    }
>    return value;
>  }
> ```
>
> ---
>
> `web/src/features/photo/components/ManualJsonImportDialog.tsx`
> Comment on lines +101 to +107
>
> ```ts
> export function ManualJsonImportDialog({ open, categories, products, onClose, onImported }: Props) {
>   const prompt = useMemo(() => buildPrompt(categories, products), [categories, products]);
>   const [jsonText, setJsonText] = useState('');
>   const [error, setError] = useState<string | null>(null);
>   const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
>
>   if (!open) return null;
> ```
>
> **coderabbitai Bot — ⚠️ Potential issue | 🟡 Minor | ⚡ Quick win**
>
> **Reset dialog-local state on close/open cycles.**
>
> Because the component stays mounted, previous JSON/error/copy status persists after closing. Reopening with stale state is confusing.
>
> **Proposed fix**
>
> ```diff
> -import { useMemo, useState, type FormEvent } from 'react';
> +import { useEffect, useMemo, useState, type FormEvent } from 'react';
> @@
>  export function ManualJsonImportDialog({ open, categories, products, onClose, onImported }: Props) {
> @@
>    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
> +
> +  useEffect(() => {
> +    if (!open) {
> +      setJsonText('');
> +      setError(null);
> +      setCopyState('idle');
> +    }
> +  }, [open]);
> ```
>
> Also applies to: 109-116
>
> **🧰 Tools**
>
> **🪛 GitHub Check: SonarCloud Code Analysis**
>
> [warning] 101-101: Mark the props of the component as read-only.

---

## 5. Claude Code `/review` — запуск 2

> **Review: `add-manual-json-input` branch (2 commits, +384 / -38)**
>
> Adds a "Paste AI JSON" dialog so you can run the prompt yourself in an external AI tool, paste the JSON back, and merge it into the photo batch alongside file-based receipts. Adds `.coderabbit.yml` too.
>
> **What the PR does well**
>
> - **Clean state-shape extension.** The `BatchItem.source: 'file' | 'manual-json'` discriminator + new `manualParsed` reducer action is the right shape — it keeps the existing parse-loop untouched and lets the reducer skip the parser entirely. Reducer test covers the new action.
> - **No duplication of `detectPairs`.** Dialog emits only `ParsedReceipt`; `addParsedReceipt` calls `detectPairs` itself. Single source of truth.
> - **Schema reuse at the trust boundary.** Validation goes through `ParsedReceiptSchema.safeParse`, matching the Edge Function's post-AI validation policy (`docs/data-model.md`, `schemas.ts:167`). Good — never trust pasted text.
> - **`useSaveReceiptMutation` reused** instead of forking a new mutation. The `photoBlob ? savePhoto : saveReceipt` branch in `PhotoReviewForm.tsx:150-155` keeps both flows on the same form.
> - **No new ESLint port violations** — dialog doesn't reach into `supabase-client` directly.
>
> **Issues worth fixing before merge**
>
> **1. `source: 'photo'` is hardcoded for manual-JSON receipts.** `PhotoReviewForm.tsx:132` writes `source: 'photo' as const` regardless of how the data arrived. The schema enum is `'photo' | 'manual' | 'edit'` (`schemas.ts:37`), and CLAUDE.md treats `source` as audit-grade attribution ("snake_case end-to-end" + "no abbreviations" suggest the field is meant to be meaningful). After this PR, manual-JSON receipts will show up in stats/filters as `photo`, which is wrong — a JSON paste is closer to manual than photo (there's no photo at all). At minimum either pass `source` through `PhotoReviewForm` as a prop from the slide, or set it from `item.source` in `BatchReviewCarousel.tsx:236`. Worth a brief discussion: do you want a third enum value (`manual-json`)? Or fold under `manual`?
>
> **2. `ManualJsonImportDialog` has zero tests.** This is the most complex new logic in the PR — `parseJsonText` (handles fenced ` ```json ` blocks, brace-extraction fallback), `normalizeCandidate` (un-nests `{receipt: {...}, items: [...]}` AI variants), schema-validation error mapping, copy-prompt success/failure. The project has ~155 tests in <5s; adding 4–5 unit tests for the pure helpers (`parseJsonText`, `normalizeCandidate`) would catch regressions cheaply. They're already importable as named exports if you split them out of the component.
>
> **3. No test for the new `PhotoReviewForm` branching.** The `photoBlob ? savePhoto : saveReceipt` path is the second important new behavior and isn't covered. `useSavePhotoReceiptMutation` does upload-then-save + orphan cleanup (`use-save-photo-receipt-mutation.ts:42-52`); the new path skips the upload entirely — easy to break silently if someone later refactors `PhotoReviewForm`.
>
> **Smaller issues**
>
> - **Language inconsistency.** Dialog UI is English ("Paste AI JSON", "Copy prompt", "Preview receipt", "Could not parse JSON.") while the surrounding photo flow is Ukrainian ("Зберігаю...", "Скасувати", "Чек 1 з 2"). CLAUDE.md says UI strings aren't covered by the Ukrainian-docs rule, but the user-facing inconsistency is jarring.
> - **Dialog a11y gaps.** No ESC-to-close, no backdrop-click-to-close, no focus trap, no focus restoration to the trigger button. The codebase already has `<DeleteConfirmDialog>` using native `<dialog>` (the jsdom workaround is noted in CLAUDE.md as a known gotcha) — consider following that pattern for consistency. As a workaround at minimum: `onKeyDown` on the form for Escape.
> - **Copy-state never resets to `'idle'`.** Once "Copied" / "Copy failed" is shown, it stays until the dialog unmounts. A `setTimeout(() => setCopyState('idle'), 2000)` would fix it.
> - **`'Pasted AI JSON'` filename is identical for every manual import.** If a user pastes two receipts in one batch, the carousel dots/tabs become indistinguishable except by status color. Consider numbering: `'Pasted AI JSON #1'`, or appending the parsed store if present.
> - **`buildPrompt` slices products to first 50 with no comment on why.** Worth a one-line WHY (token budget? prompt length?). Otherwise a future reader will wonder.
> - **`parseJsonText` brace-extraction fallback** (`indexOf('{')` / `lastIndexOf('}')`) will misbehave on JSON containing `}` inside a string before the real closing brace. Edge case for a power-user paste flow — fine, but worth a comment.
>
> **Security**
>
> No new vulnerabilities. `JSON.parse` is safe; Zod re-validates the shape before it reaches the save path; RLS still gates the insert. Clipboard read is not used (only write). Prompt-injection risk is zero — the prompt is not sent anywhere; the user copies it manually.
>
> **Performance / correctness**
>
> No concerns. `useMemo` on `prompt`, `pairResult` computed once in `addParsedReceipt`, no extra re-renders.
>
> **Summary**
>
> Solid feature with clean state-machine integration, but ships with the `source` attribution bug and no tests for the new dialog. I'd block on (1) and (2); the rest are nice-to-haves.

---

## Зведена таблиця

15 окремих знахідок між усіма інструментами. Стовпці: `Q` = Qodo, `Cr1` = Claude `/review` запуск 1, `Cr2` = Claude `/review` запуск 2, `G` = Greptile, `CR` = CodeRabbit.

| #   | Знахідка                                                                   |   Q   |    Cr1     |    Cr2     |   G   | CR  | Реально?                       | Severity                                      |
| --- | -------------------------------------------------------------------------- | :---: | :--------: | :--------: | :---: | :-: | ------------------------------ | --------------------------------------------- |
| 1   | `source: 'photo'` hardcoded для ручного JSON                               |   —   |   ✅ #1    |   ✅ #1    | ✅ P1 |  —  | **Так**                        | **High** — DB integrity, накопичується        |
| 2   | Form state переюзується між item'ами в карусельці (потрібен `key`)         | ✅ #1 |     —      |     —      |   —   |  —  | **Так**                        | **Medium** — рідкісний trigger, корумпує save |
| 3   | Dialog state persists across close/reopen (`error`/`copyState`/`jsonText`) | ✅ #2 |   ✅ #3    | ✅ smaller | ✅ P2 | ✅  | **Так**                        | Low–Medium                                    |
| 4   | `normalizeCandidate` пропускає вкладений `items`                           |   —   |     —      |     —      |   —   | ✅  | **Так**                        | Low — defensive edge case                     |
| 5   | Нема тестів для `ManualJsonImportDialog`                                   |   —   |   ✅ #2    |   ✅ #2    |   —   |  —  | **Так**                        | Medium                                        |
| 6   | Нема тесту для `photoBlob` branching у `PhotoReviewForm`                   |   —   |     —      |   ✅ #3    |   —   |  —  | **Так**                        | Medium                                        |
| 7   | Dialog a11y: Esc / backdrop / focus / native `<dialog>`                    |   —   |   ✅ #3    | ✅ smaller |   —   |  —  | **Так**                        | Low–Medium                                    |
| 8   | Language inconsistency (en/uk у діалозі)                                   |   —   |     —      | ✅ smaller |   —   |  —  | **Так**                        | Low (UX)                                      |
| 9   | Zod error без `issue.path`                                                 |   —   |   ✅ #4    |     —      |   —   |  —  | **Так**                        | Low (UX)                                      |
| 10  | `aria-modal` на `<form>` замість `<div>`                                   |   —   |   ✅ #5    |     —      |   —   |  —  | **Так**                        | Cosmetic                                      |
| 11  | `'Pasted AI JSON'` duplication filename                                    |   —   | ✅ smaller | ✅ smaller |   —   |  —  | **Так**                        | Low                                           |
| 12  | `addParsedReceipt` steals focus mid-batch                                  |   —   | ✅ smaller |     —      |   —   |  —  | Спірно (може бути intentional) | Low                                           |
| 13  | `buildPrompt.slice(0, 50)` без WHY-коментаря                               |   —   |     —      | ✅ smaller |   —   |  —  | **Так**                        | Trivia                                        |
| 14  | `parseJsonText` brace fallback з `}` у trailing prose                      |   —   |     —      | ✅ smaller |   —   |  —  | **Так**                        | Edge case                                     |
| 15  | `.coderabbit.yml` `path_filters` для `legacy/`                             |   —   | ✅ smaller |     —      |   —   |  —  | **Так**                        | Trivia                                        |

**Покриття за інструментом:**

| Інструмент                                  | Знайшов | З 15 загалом |
| ------------------------------------------- | ------- | ------------ |
| Claude `/review` (об'єднання обох запусків) | 13      | 87%          |
| Claude `/review` r1                         | 9       | 60%          |
| Claude `/review` r2                         | 9       | 60%          |
| Qodo                                        | 2       | 13%          |
| Greptile                                    | 2       | 13%          |
| CodeRabbit                                  | 2       | 13%          |

---

## Висновки

### Спостереження №1 — Claude `/review` недетермінований

Між двома запусками Claude `/review` на тому самому коді — лише ~5 спільних знахідок із ~13 загальних. Це означає:

- Для критичних PR має сенс запустити Claude **2 рази** й об'єднати результати.
- Покладатись на один запуск — гарантовано пропустити суттєве.
- Деякі знахідки (наприклад, `parseJsonText` edge case, language inconsistency) спливають тільки в одному з двох запусків.

### Спостереження №2 — кожен інструмент має своє "сліпе око"

Унікальні знахідки кожного інструменту:

- **Qodo** — єдиний, хто побачив **#2 (form state across batch items)**. Має сильний аналіз React component lifecycle / re-render semantics.
- **CodeRabbit** — єдиний, хто помітив **#4 (`normalizeCandidate` nested items)**. Читає тіло helper-функцій рядок-за-рядком.
- **Claude** — єдиний, хто торкнувся **тестів, conventions, a11y patterns, мовної консистентності** (#5, #6, #7, #8, #15).
- **Greptile** — без унікальних знахідок, але **обидві його знахідки = два найдорожчі баги** (#1 і #3). Найвищий signal-to-noise.

### Спостереження №3 — баги різної природи знаходяться різними інструментами

| Тип бага                                        | Знаходять             | Не знаходять                                  |
| ----------------------------------------------- | --------------------- | --------------------------------------------- |
| **Data flow / DB integrity** (#1 `source`)      | Claude, Greptile      | Qodo, CodeRabbit                              |
| **React lifecycle / hooks** (#2 key)            | Qodo                  | Claude (обидва запуски), Greptile, CodeRabbit |
| **Очевидний state-bug** (#3 persists)           | Усі 4                 | —                                             |
| **Code-coverage gaps** (#5, #6)                 | Тільки Claude         | Усі інші                                      |
| **Convention / consistency** (#7, #8, #15)      | Тільки Claude         | Усі інші                                      |
| **Defensive edge cases** (#4 nested, #14 brace) | CodeRabbit, Claude r2 | Усі інші                                      |

### Спостереження №4 — найдорожчий баг знаходять не всі

Найгірший баг у PR — `source: 'photo'` hardcoded (data integrity, накопичується, дорого backfill'ити) — пропустили **2 з 4 інструментів** (Qodo, CodeRabbit). Це підтверджує: один інструмент не страхує від критичних пропусків.

### Спостереження №5 — "low-hanging fruit" знаходять усі

Dialog state persistence (#3) — простий і помітний з шаблону `useState + if (!open) return null`. Усі 4 інструменти його зловили. Це baseline-знахідка, яка не диференціює якість.

### Рекомендований дует для регулярного use

На основі цих результатів — **Claude `/review` + Greptile** як основний дует:

- **Claude** — за широту (тести, conventions, a11y, варіативні engineering quality issues)
- **Greptile** — як критичний фільтр з найвищим signal-to-noise (мінімум шуму, максимум High-severity)
- **Qodo** додавати, якщо проєкт react-важкий — він унікально сильний на lifecycle bugs
- **CodeRabbit** додавати, якщо багато defensive helpers / парсерів — він копає в тіло функцій

### Дешевий протокол на майбутнє

Для PR із суттєвою новою логікою:

1. Запустити Claude `/review` **двічі**, об'єднати знахідки.
2. Запустити Greptile (або еквівалент) як sanity check на High-severity.
3. Якщо PR торкається React state/lifecycle — додати Qodo.
4. Якщо PR містить парсери / нормалізатори / валідатори — додати CodeRabbit.
5. **Не покладатись на один інструмент.** З 15 знахідок у цьому PR жоден інструмент сам не знайшов навіть половини.

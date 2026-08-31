import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { ParsedReceiptSchema, type ParsedReceipt } from '@finance-tracker/domain';
import { parseJsonText } from '@/shared/utils/parse-json-text';
import { formatZodIssues } from '@/shared/utils/format-zod-issues';
import { useCopyToClipboard } from '@/shared/hooks/use-copy-to-clipboard';
import { Button } from '@/shared/ui/Button';

type Props = {
  open: boolean;
  categories: string[];
  products: { name: string }[];
  onClose: () => void;
  onImported: (parsed: ParsedReceipt[]) => void;
};

const EXAMPLE_JSON = `{
  "store": "Lidl",
  "store_address": "Street 1, City",
  "date": "2026-05-25",
  "time": "14:32",
  "currency": "EUR",
  "total_orig": 12.34,
  "items": [
    {
      "product_name": "Bread",
      "product_code": null,
      "qty": 1,
      "unit_price_orig": 1.49,
      "discount_orig": 0,
      "category_suggestion": null
    }
  ]
}`;

// Cap at 50 names: keeps the prompt under typical ~8k-token context windows
// for external AI tools (ChatGPT/Claude desktop) when the product catalog grows.
const PRODUCT_HINT_LIMIT = 50;

function buildPrompt(categories: string[], products: { name: string }[]): string {
  const categoryList = categories.length > 0 ? categories.join(', ') : 'No categories supplied';
  const productHints = products
    .slice(0, PRODUCT_HINT_LIMIT)
    .map((p) => p.name)
    .join(', ');

  return [
    'Analyze the attached receipt image(s) and return only valid JSON. Do not include markdown, comments, or explanatory text.',
    '',
    'The JSON must match this shape:',
    EXAMPLE_JSON,
    '',
    'If several receipts are shown, return a JSON array of these objects instead of a single object.',
    '',
    'Rules:',
    '- store: merchant name, or null if illegible.',
    '- store_address: printed address as one line, or null.',
    '- date: YYYY-MM-DD, or null.',
    '- time: HH:MM in 24-hour time, or null.',
    '- currency: ISO 4217 code, default to EUR if not visible.',
    '- total_orig: the final amount to pay, or null.',
    '- product_name: copy the receipt text verbatim; do not translate or normalize.',
    '- product_code: per-line article/product code printed before the product name, or null.',
    '- qty: always positive. Use printed count, kg/l amount, or 1 when no quantity is shown.',
    '- unit_price_orig: price per unit in receipt currency. It may be negative for refunds, discounts, or cancellations.',
    '- discount_orig: positive discount amount for that line when printed separately; otherwise 0 or omit it.',
    '- category_suggestion: one of the allowed categories exactly, or null if uncertain. Do not invent categories.',
    '- Include negative receipt lines. Do not net out cancellations, discounts, Pfand, or Leergut refunds.',
    '',
    `Allowed categories: ${categoryList}`,
    productHints
      ? `Known product names from prior purchases, for hints only: ${productHints}`
      : 'Known product names from prior purchases: none supplied.',
  ].join('\n');
}

export function normalizeCandidate(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const receipt =
    record.receipt && typeof record.receipt === 'object' && !Array.isArray(record.receipt)
      ? (record.receipt as Record<string, unknown>)
      : null;
  if (!receipt) return value;

  const topItems = Array.isArray(record.items) ? (record.items as unknown[]) : null;
  const nestedItems = Array.isArray(receipt.items) ? (receipt.items as unknown[]) : null;
  const items = topItems ?? nestedItems;
  if (!items) return value;

  return { ...receipt, items };
}

// One pasted blob may hold a single receipt, a top-level array of receipts, or
// a { receipts: [...] } wrapper. Always returns a flat list of receipt-shaped
// candidates, each already run through normalizeCandidate.
export function toReceiptCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.map(normalizeCandidate);
  if (value && typeof value === 'object') {
    const receipts = (value as Record<string, unknown>).receipts;
    if (Array.isArray(receipts)) return receipts.map(normalizeCandidate);
  }
  return [normalizeCandidate(value)];
}

// Re-exported so existing tests importing it from this module stay green; the
// implementation now lives in shared/utils so the statement-import dialog reuses it.
export { parseJsonText };

export function ManualJsonImportDialog({ open, categories, products, onClose, onImported }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const prompt = useMemo(() => buildPrompt(categories, products), [categories, products]);
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { copyState, copy, reset: resetCopy } = useCopyToClipboard(prompt);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // jsonText is intentionally preserved across close/reopen so an accidental
  // close doesn't wipe a paste the user is mid-way through validating.
  const handleClose = () => {
    setError(null);
    resetCopy();
    onClose();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      const candidates = toReceiptCandidates(parseJsonText(jsonText));
      if (candidates.length === 0) {
        setError('JSON не містить жодного чека.');
        return;
      }

      const receipts: ParsedReceipt[] = [];
      const errors: string[] = [];
      candidates.forEach((candidate, index) => {
        const result = ParsedReceiptSchema.safeParse(candidate);
        if (result.success) {
          receipts.push(result.data);
          return;
        }
        const detail = formatZodIssues(result.error);
        // Number the receipt only when there's more than one to disambiguate.
        errors.push(candidates.length > 1 ? `Чек #${index + 1} — ${detail}` : detail);
      });

      // All-or-nothing: one bad receipt blocks the whole paste so the user fixes
      // the source rather than silently importing a partial batch.
      if (errors.length > 0) {
        setError(errors.join('\n'));
        return;
      }

      onImported(receipts);
      setJsonText('');
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося розпарсити JSON.');
    }
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) handleClose();
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    handleClose();
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        handleClose();
      }}
      onClick={handleBackdropClick}
      onKeyDown={handleDialogKeyDown}
      aria-labelledby="manual-json-title"
      className="max-h-[92vh] w-[min(96vw,64rem)] rounded-md border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <form onSubmit={handleSubmit} className="flex max-h-[92vh] flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 id="manual-json-title" className="text-base font-semibold text-slate-900">
            Вставити AI JSON
          </h2>
          <Button type="button" variant="ghost" onClick={handleClose} className="px-3">
            Закрити
          </Button>
        </div>

        <div className="grid gap-4 overflow-y-auto p-4 md:grid-cols-2">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="manual-json-prompt" className="text-sm font-medium text-slate-800">
                Prompt
              </label>
              <Button type="button" variant="secondary" onClick={() => void copy()}>
                {copyState === 'copied'
                  ? 'Скопійовано'
                  : copyState === 'failed'
                    ? 'Не вдалося скопіювати'
                    : 'Скопіювати prompt'}
              </Button>
            </div>
            <textarea
              id="manual-json-prompt"
              readOnly
              value={prompt}
              rows={18}
              className="min-h-80 w-full resize-y rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-800"
            />
          </section>

          <section className="space-y-2">
            <label htmlFor="manual-json-input" className="text-sm font-medium text-slate-800">
              JSON
            </label>
            <textarea
              id="manual-json-input"
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
              rows={18}
              placeholder={EXAMPLE_JSON}
              className="min-h-80 w-full resize-y rounded-md border border-slate-300 p-3 font-mono text-xs leading-5 text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            {error ? (
              <div
                role="alert"
                className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800"
              >
                {error}
              </div>
            ) : null}
          </section>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button type="button" variant="ghost" onClick={handleClose}>
            Скасувати
          </Button>
          <Button type="submit">Переглянути чек</Button>
        </div>
      </form>
    </dialog>
  );
}

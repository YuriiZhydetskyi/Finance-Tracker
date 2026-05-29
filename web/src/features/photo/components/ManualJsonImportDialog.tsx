import { useMemo, useState, type FormEvent } from 'react';
import { ParsedReceiptSchema, type ParsedReceipt } from '@finance-tracker/domain';
import { Button } from '@/shared/ui/Button';

type Props = {
  open: boolean;
  categories: string[];
  products: { name: string }[];
  onClose: () => void;
  onImported: (parsed: ParsedReceipt) => void;
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

/**
 * Builds a multi-line instruction prompt for an AI to analyze receipt images and output only valid JSON.
 *
 * The prompt embeds an example JSON schema, field-specific rules (store, address, date, time, currency,
 * totals, per-line fields, and category guidance), an allowed-categories list, and optional known-product hints.
 *
 * @param categories - Allowed category strings that will be included verbatim in the prompt; if empty, the prompt notes that no categories were supplied.
 * @param products - Prior product records whose names are included as hints; up to the first 50 product names are used.
 * @returns The assembled prompt string to present to the AI model.
 */
function buildPrompt(categories: string[], products: { name: string }[]): string {
  const categoryList = categories.length > 0 ? categories.join(', ') : 'No categories supplied';
  const productHints = products
    .slice(0, 50)
    .map((p) => p.name)
    .join(', ');

  return [
    'Analyze the attached receipt image(s) and return only valid JSON. Do not include markdown, comments, or explanatory text.',
    '',
    'The JSON must match this shape:',
    EXAMPLE_JSON,
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

/**
 * Flatten a wrapper object that contains `receipt` and `items` into a single receipt-shaped object.
 *
 * If `value` is an object with a `receipt` object and an `items` array, returns a new object
 * that merges the properties of `receipt` and sets `items` to the original `items` array.
 * For any other input, returns `value` unchanged.
 *
 * @param value - The parsed JSON candidate to normalize; may be any value.
 * @returns The normalized receipt-shaped object when a `{ receipt, items }` wrapper is detected, otherwise the original `value`.
 */
function normalizeCandidate(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (
      record.receipt &&
      typeof record.receipt === 'object' &&
      !Array.isArray(record.receipt) &&
      Array.isArray(record.items)
    ) {
      return { ...(record.receipt as Record<string, unknown>), items: record.items };
    }
  }
  return value;
}

/**
 * Parse JSON from a user-pasted string, supporting fenced ```json``` blocks and best-effort extraction.
 *
 * Extracts the inner contents if the input contains a fenced code block (```json ... ```), otherwise uses the full trimmed input.
 * If initial parsing fails, attempts to recover by locating the first `{` and last `}` and parsing that substring.
 *
 * @param text - The raw pasted text that should contain JSON (may include fenced code block markers).
 * @returns The parsed JavaScript value represented by the JSON text.
 * @throws Error('Paste JSON first.') if `text` is empty or only whitespace.
 * @throws Error('Could not parse JSON.') if parsing and recovery both fail.
 */
function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Paste JSON first.');

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error('Could not parse JSON.');
  }
}

/**
 * Renders a dialog allowing the user to paste AI-generated receipt JSON, validate it, and import the parsed receipt.
 *
 * The dialog shows a generated AI prompt (with a copy-to-clipboard action) and an editable JSON input prefilled with an example.
 *
 * @param open - Whether the dialog is visible. When false, the component renders nothing.
 * @param categories - Allowed category strings used to build the AI prompt.
 * @param products - Prior product names used as hints when building the AI prompt.
 * @param onClose - Callback invoked to close the dialog.
 * @param onImported - Callback invoked with the validated receipt object when import succeeds.
 * @returns The dialog UI when `open` is true, otherwise `null`.
 */
export function ManualJsonImportDialog({ open, categories, products, onClose, onImported }: Props) {
  const prompt = useMemo(() => buildPrompt(categories, products), [categories, products]);
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  if (!open) return null;

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      const parsedJson = normalizeCandidate(parseJsonText(jsonText));
      const parsed = ParsedReceiptSchema.safeParse(parsedJson);
      if (!parsed.success) {
        setError(parsed.error.issues.map((issue) => issue.message).join('; '));
        return;
      }
      onImported(parsed.data);
      setJsonText('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not parse JSON.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-3">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-json-title"
        onSubmit={handleSubmit}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-md bg-white shadow-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 id="manual-json-title" className="text-base font-semibold text-slate-900">
            Paste AI JSON
          </h2>
          <Button type="button" variant="ghost" onClick={onClose} className="px-3">
            Close
          </Button>
        </div>

        <div className="grid gap-4 overflow-y-auto p-4 md:grid-cols-2">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="manual-json-prompt" className="text-sm font-medium text-slate-800">
                Prompt
              </label>
              <Button type="button" variant="secondary" onClick={() => void handleCopyPrompt()}>
                {copyState === 'copied'
                  ? 'Copied'
                  : copyState === 'failed'
                    ? 'Copy failed'
                    : 'Copy prompt'}
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
                className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800"
              >
                {error}
              </div>
            ) : null}
          </section>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Preview receipt</Button>
        </div>
      </form>
    </div>
  );
}

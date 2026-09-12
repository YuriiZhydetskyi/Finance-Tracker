import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { PackagedProductImportSchema, type PackagedProductImport } from '@finance-tracker/domain';
import { parseJsonText } from '@/shared/utils/parse-json-text';
import { formatZodIssues } from '@/shared/utils/format-zod-issues';
import { useCopyToClipboard } from '@/shared/hooks/use-copy-to-clipboard';
import { Button } from '@/shared/ui/Button';
import { toPackagedProductCandidates } from '../utils/packaged-product-candidates';
import {
  buildPackagedProductPrompt,
  EXAMPLE_PACKAGED_PRODUCT_JSON,
  type PromptTaxonomy,
} from '../utils/build-packaged-product-prompt';
import {
  normalizeCatalogueName,
  validatePackagedProductImport,
} from '../utils/validate-packaged-product-import';
import type { PackagedProductListRow } from '../api/use-packaged-products';
import type { PackagingCandidateRow } from '../types';

export type ImportedPackagedProduct = { parsed: PackagedProductImport; raw: unknown };

type Props = Readonly<{
  open: boolean;
  categories: string[];
  taxonomy: PromptTaxonomy;
  existing: Pick<PackagedProductListRow, 'id' | 'name' | 'barcode'>[];
  /** When set, the prompt names the receipt labels this card is being created for. */
  candidate?: PackagingCandidateRow | null;
  submitting: boolean;
  onClose: () => void;
  onImported: (products: ImportedPackagedProduct[]) => void | Promise<void>;
}>;

export function PackagedProductJsonImportDialog({
  open,
  categories,
  taxonomy,
  existing,
  candidate = null,
  submitting,
  onClose,
  onImported,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const prompt = useMemo(
    () => buildPackagedProductPrompt(categories, taxonomy, candidate),
    [categories, taxonomy, candidate],
  );
  const [jsonText, setJsonText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const { copyState, copy, reset: resetCopy } = useCopyToClipboard(prompt);

  const lookups = useMemo(() => {
    const byBarcode = new Map<string, { id: string; name: string }>();
    const byName = new Map<string, { id: string; name: string }>();
    for (const row of existing) {
      if (row.barcode) byBarcode.set(row.barcode, { id: row.id, name: row.name });
      else byName.set(normalizeCatalogueName(row.name), { id: row.id, name: row.name });
    }
    return { byBarcode, byName };
  }, [existing]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // jsonText survives close/reopen so an accidental close doesn't wipe a paste
  // the user is mid-way through fixing.
  const handleClose = () => {
    setErrors([]);
    setWarnings([]);
    resetCopy();
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors([]);
    setWarnings([]);

    let candidates: unknown[];
    try {
      candidates = toPackagedProductCandidates(parseJsonText(jsonText));
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'Не вдалося прочитати JSON.']);
      return;
    }

    if (candidates.length === 0) {
      setErrors(['JSON не містить жодного товару.']);
      return;
    }

    const products: ImportedPackagedProduct[] = [];
    const collectedErrors: string[] = [];
    const collectedWarnings: string[] = [];
    // Duplicates inside one paste are caught here; the partial unique indexes
    // remain the real guard against a concurrent insert by the other user.
    const seenBarcodes = new Set<string>();

    candidates.forEach((raw, index) => {
      const label = candidates.length > 1 ? `Товар #${String(index + 1)} — ` : '';
      const result = PackagedProductImportSchema.safeParse(raw);
      if (!result.success) {
        collectedErrors.push(label + formatZodIssues(result.error));
        return;
      }

      const checked = validatePackagedProductImport(result.data, {
        categories,
        families: taxonomy.families,
        variants: taxonomy.variants,
        existingByBarcode: lookups.byBarcode,
        existingNamesWithoutBarcode: lookups.byName,
      });
      collectedErrors.push(...checked.errors.map((message) => label + message));
      collectedWarnings.push(...checked.warnings.map((message) => label + message));

      const barcode = result.data.barcode == null ? null : String(result.data.barcode);
      if (barcode) {
        if (seenBarcodes.has(barcode)) {
          collectedErrors.push(`${label}штрихкод ${barcode} повторюється в цій же вставці`);
        }
        seenBarcodes.add(barcode);
      }

      products.push({ parsed: result.data, raw });
    });

    // All-or-nothing: one bad product blocks the paste so the source gets fixed
    // rather than half a batch landing in the catalogue.
    if (collectedErrors.length > 0) {
      setErrors(collectedErrors);
      setWarnings(collectedWarnings);
      return;
    }

    setWarnings(collectedWarnings);
    await onImported(products);
    setJsonText('');
    handleClose();
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) handleClose();
  };

  // Keyboard equivalent of the backdrop click, for the rare case the dialog
  // root itself holds focus (e.g. right after showModal(), before focus moves
  // to a child). Escape already closes via the native `cancel` event above.
  const handleBackdropKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      handleClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        handleClose();
      }}
      onClick={handleBackdropClick}
      onKeyDown={handleBackdropKeyDown}
      aria-labelledby="packaged-json-title"
      className="max-h-[92vh] w-[min(96vw,64rem)] rounded-md border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="flex max-h-[92vh] flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 id="packaged-json-title" className="text-base font-semibold text-slate-900">
              Картка товару з JSON
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              {candidate
                ? `Для позиції «${candidate.product_name}» з ${candidate.store}.`
                : 'Підходить один товар, масив товарів або обʼєкт із полем products.'}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={handleClose}
            className="px-3"
          >
            Закрити
          </Button>
        </div>

        <div className="grid gap-4 overflow-y-auto p-4 md:grid-cols-2">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="packaged-prompt" className="text-sm font-medium text-slate-800">
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
              id="packaged-prompt"
              readOnly
              value={prompt}
              rows={18}
              className="min-h-80 w-full resize-y rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-800"
            />
          </section>

          <section className="space-y-2">
            <label htmlFor="packaged-json" className="text-sm font-medium text-slate-800">
              JSON
            </label>
            <textarea
              id="packaged-json"
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
              rows={18}
              placeholder={EXAMPLE_PACKAGED_PRODUCT_JSON}
              className="min-h-80 w-full resize-y rounded-md border border-slate-300 p-3 font-mono text-xs leading-5 text-slate-900 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            {errors.length > 0 ? (
              <div
                role="alert"
                className="space-y-1 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800"
              >
                {errors.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
            ) : null}
            {warnings.length > 0 ? (
              <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
                <p className="font-medium">Попередження (не блокують збереження):</p>
                {warnings.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button type="button" variant="ghost" disabled={submitting} onClick={handleClose}>
            Скасувати
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Зберігаю…' : 'Перевірити та зберегти'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

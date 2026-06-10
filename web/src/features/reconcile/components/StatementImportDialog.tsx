import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  BankStatementSchema,
  groupStatementDuplicates,
  normalizeStatementTxns,
  toStatementTxns,
  type NormalizedStatementTxn,
} from '@finance-tracker/domain';
import { parseJsonText } from '@/shared/utils/parse-json-text';
import { formatZodIssues } from '@/shared/utils/format-zod-issues';
import { formatMoney } from '@/shared/utils/format-money';
import { formatDate } from '@/shared/utils/format-date';
import { useCopyToClipboard } from '@/shared/hooks/use-copy-to-clipboard';
import { Button } from '@/shared/ui/Button';
import { SELECT_CLASS } from '@/shared/ui/select-classes';
import { buildStatementPrompt, STATEMENT_EXAMPLE_JSON } from '../reconcile-prompt';

type Props = {
  open: boolean;
  owners: string[];
  // Category names embedded in the copy-paste prompt so the AI returns one of ours.
  categories?: string[];
  onClose: () => void;
  onReconcile: (owner: string, txns: NormalizedStatementTxn[]) => void;
};

export function StatementImportDialog({
  open,
  owners,
  categories = [],
  onClose,
  onReconcile,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const prompt = useMemo(() => buildStatementPrompt(categories), [categories]);
  const [owner, setOwner] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Same-identity lines within the pasted import: the extraction prompt tells
  // the AI to dedup screenshot overlap, but if it slips, the duplicate would
  // silently persist as a "genuine" repeat purchase. First submit shows the
  // groups for review; second submit proceeds minus the unchecked lines.
  const [duplicateGroups, setDuplicateGroups] = useState<NormalizedStatementTxn[][] | null>(null);
  const [excludedIndexes, setExcludedIndexes] = useState<ReadonlySet<number>>(new Set());
  const { copyState, copy, reset: resetCopy } = useCopyToClipboard(prompt);

  const resetDuplicates = () => {
    setDuplicateGroups(null);
    setExcludedIndexes(new Set());
  };

  const toggleExcluded = (index: number) =>
    setExcludedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Reset the owner on close so a second import (a different card) can't silently
  // reconcile against the previously-selected person.
  const handleClose = () => {
    setError(null);
    setOwner('');
    resetDuplicates();
    resetCopy();
    onClose();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!owner) {
      setError('Спочатку обери, чия це картка.');
      return;
    }

    try {
      const candidates = toStatementTxns(parseJsonText(jsonText));
      if (candidates.length === 0) {
        setError('JSON не містить жодної транзакції.');
        return;
      }

      const result = BankStatementSchema.safeParse(candidates);
      if (!result.success) {
        setError(formatZodIssues(result.error));
        return;
      }

      const txns = normalizeStatementTxns(result.data);
      if (duplicateGroups == null) {
        const groups = groupStatementDuplicates(txns);
        if (groups.length > 0) {
          setDuplicateGroups(groups);
          return;
        }
      }

      onReconcile(
        owner,
        txns.filter((t) => !excludedIndexes.has(t.index)),
      );
      setJsonText('');
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося розпарсити JSON.');
    }
  };

  // No backdrop-click-to-close: a click handler on the <dialog> trips a11y (no
  // keyboard equivalent) and would risk discarding a pasted statement. Close via
  // the Close/Скасувати buttons or Esc (onCancel). Mirrors CreateStubReceiptDialog.
  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        handleClose();
      }}
      aria-labelledby="statement-import-title"
      className="max-h-[92vh] w-[min(96vw,64rem)] rounded-md border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <form onSubmit={handleSubmit} className="flex max-h-[92vh] flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 id="statement-import-title" className="text-base font-semibold text-slate-900">
            Завантажити виписку
          </h2>
          <Button type="button" variant="ghost" onClick={handleClose} className="px-3">
            Закрити
          </Button>
        </div>

        <div className="space-y-1 border-b border-slate-200 px-4 py-3">
          <label htmlFor="statement-owner" className="text-sm font-medium text-slate-800">
            Чия це картка
          </label>
          <select
            id="statement-owner"
            className={SELECT_CLASS}
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">— обери людину —</option>
            {owners.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500">
            Усі транзакції з виписки належать цій людині. Чеки, віднесені на іншу, ми запропонуємо
            виправити.
          </p>
        </div>

        <div className="grid gap-4 overflow-y-auto p-4 md:grid-cols-2">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="statement-prompt" className="text-sm font-medium text-slate-800">
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
              id="statement-prompt"
              readOnly
              value={prompt}
              rows={18}
              className="min-h-80 w-full resize-y rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-800"
            />
          </section>

          <section className="space-y-2">
            <label htmlFor="statement-json" className="text-sm font-medium text-slate-800">
              JSON
            </label>
            <textarea
              id="statement-json"
              value={jsonText}
              onChange={(event) => {
                setJsonText(event.target.value);
                resetDuplicates();
              }}
              rows={18}
              placeholder={STATEMENT_EXAMPLE_JSON}
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

        {duplicateGroups && duplicateGroups.length > 0 && (
          <div className="space-y-2 border-t border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-900">
              В імпорті є однакові транзакції. Якщо це накладання скріншотів — зніми галочку з
              дубля; якщо покупка справді повторилась — лиши як є і натисни «Звірити» ще раз.
            </p>
            <ul className="space-y-2">
              {duplicateGroups.map((group) => {
                const first = group[0]!;
                const label = first.merchant ?? first.raw ?? 'без назви';
                return (
                  <li key={first.index} className="space-y-1 text-sm text-amber-900">
                    <div>
                      {label} · {formatDate(first.date)} ·{' '}
                      {formatMoney(first.amount, first.currency)} — зустрічається {group.length}{' '}
                      разів
                    </div>
                    <ul className="space-y-1 pl-4">
                      {group.slice(1).map((txn) => (
                        <li key={txn.index}>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={!excludedIndexes.has(txn.index)}
                              onChange={() => toggleExcluded(txn.index)}
                              className="h-4 w-4 shrink-0"
                            />
                            <span>це окрема покупка — залишити</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button type="button" variant="ghost" onClick={handleClose}>
            Скасувати
          </Button>
          <Button type="submit">Звірити</Button>
        </div>
      </form>
    </dialog>
  );
}

import { FIELD_LABEL_CLASS, SELECT_CLASS } from '@/shared/ui/select-classes';
import { formatDate } from '@/shared/utils/format-date';
import { formatMoney } from '@/shared/utils/format-money';
import type { StoredReceiptMatch } from '../api/use-receipt-duplicates';
import type { PackagingReceiptSummary } from '../utils/packaging-import';
import { receiptPagesLabel } from '../utils/packaging-receipt';

type Props = Readonly<{
  pages: number[];
  /** What the JSON says about the receipt; only used to describe it and to warn about a duplicate. */
  summary: PackagingReceiptSummary | null;
  /** Why the receipt pages could not be cut out of the PDF, or null when they could. */
  cutError: string | null;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  payerOptions: string[];
  payer: string;
  onPayerChange: (payer: string) => void;
  /** Stored receipts with the same date, store and total. */
  duplicates: StoredReceiptMatch[];
  disabled: boolean;
}>;

/**
 * The «add the receipt too» line of the import review. The receipt is not parsed
 * here: its pages go to the durable receipt import (/imports) as a PDF of their own,
 * where the usual checks and the exception queue apply.
 */
export function PackagingReceiptOption({
  pages,
  summary,
  cutError,
  enabled,
  onEnabledChange,
  payerOptions,
  payer,
  onPayerChange,
  duplicates,
  disabled,
}: Props) {
  const label = receiptPagesLabel(pages);
  const described = summary
    ? [
        summary.store,
        summary.date ? formatDate(summary.date) : null,
        summary.total != null ? formatMoney(summary.total, summary.currency ?? 'EUR') : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <section className="space-y-2 rounded border border-slate-200 p-3">
      <p className="text-sm font-medium">Чек із PDF</p>
      {cutError ? (
        <p role="alert" className="text-sm text-amber-800">
          Чек зі {label} не вдалося підготувати для імпорту. {cutError.replace(/\.?$/, '.')} Картки
          збережуться без нього — додай чек окремо через імпорт чеків.
        </p>
      ) : (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={enabled}
              disabled={disabled}
              onChange={(event) => onEnabledChange(event.target.checked)}
            />
            <span>
              Чек зі {label} буде додано через імпорт чеків
              {pages.length > 1 ? (
                <span className="block text-xs text-slate-500">
                  Ці сторінки підуть одним документом, тобто як один чек. Якщо це різні чеки, зніми
                  позначку й додай їх окремо.
                </span>
              ) : null}
            </span>
          </label>
          {described ? (
            <p className="text-xs text-slate-500">За даними JSON: {described}.</p>
          ) : null}
          {enabled ? (
            <>
              {payerOptions.length > 0 ? (
                <label className="block max-w-sm space-y-1">
                  <span className={FIELD_LABEL_CLASS}>Хто оплатив чек</span>
                  <select
                    className={SELECT_CLASS}
                    value={payer}
                    disabled={disabled}
                    onChange={(event) => onPayerChange(event.target.value)}
                  >
                    {payerOptions.map((email) => (
                      <option key={email} value={email}>
                        {email}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <p className="text-xs text-slate-500">
                Чек опрацює фоновий імпорт: якщо він сумнівний, потрапить у винятки на сторінці
                імпорту. Картки товарів від цього не залежать.
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              Чек не буде додано. Додай його пізніше через імпорт чеків.
            </p>
          )}
          {duplicates.length > 0 ? (
            <div role="status" className="rounded bg-amber-50 p-2 text-sm text-amber-900">
              <p className="font-medium">Схоже, такий чек уже є в базі:</p>
              <ul className="list-disc pl-5">
                {duplicates.slice(0, 3).map((receipt) => (
                  <li key={receipt.id}>
                    {receipt.store} · {formatDate(receipt.date)} ·{' '}
                    {formatMoney(receipt.total_orig, receipt.currency)}
                  </li>
                ))}
              </ul>
              <p className="text-xs">
                Це лише попередження: імпорт чеків ще раз перевірить дублікат, а збереження карток
                не блокується.
              </p>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

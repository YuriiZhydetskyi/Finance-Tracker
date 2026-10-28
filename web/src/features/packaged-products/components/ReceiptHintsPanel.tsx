import { Link } from '@tanstack/react-router';
import { formatDate } from '@/shared/utils/format-date';
import {
  matchesReceiptHint,
  type PackagingReceiptHint,
  type ReceiptHintTarget,
} from '../utils/packaging-import';

type Props = Readonly<{
  hints: PackagingReceiptHint[];
  /** Store rows already linked to this card; a hint they satisfy is done and not shown. */
  linked: ReceiptHintTarget[];
}>;

/**
 * «The AI thought this card is printed as X at store Y» — left over from the import,
 * for the person to act on once the receipt has been processed. It links nothing by
 * itself: the button only opens the queue searched for that name, where the usual
 * «Привʼязати» does the linking.
 */
export function ReceiptHintsPanel({ hints, linked }: Props) {
  const pending = hints.filter((hint) => !linked.some((row) => matchesReceiptHint(row, [hint])));
  if (pending.length === 0) return null;

  return (
    <section className="rounded-md border border-teal-200 bg-teal-50 p-4">
      <h2 className="text-sm font-semibold text-teal-900">Підказки з імпорту: назви в чеках</h2>
      <p className="mt-1 text-xs text-teal-900">
        ШІ припустив, як цей товар надруковано в чеках. Це лише підказки, нічого не прив’язано: коли
        чек буде додано, знайди позицію в черзі «Без картки» й натисни «Привʼязати».
      </p>
      <ul className="mt-2 space-y-1 text-sm text-slate-800">
        {pending.map((hint, index) => (
          <li key={index} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {hint.store} · «{hint.receipt_label}»
              {hint.store_product_code ? ` · код ${hint.store_product_code}` : ''}
              {hint.receipt_date ? ` · чек від ${formatDate(hint.receipt_date)}` : ''}
            </span>
            <Link
              to="/packaged-products"
              search={{ tab: 'queue', q: hint.receipt_label }}
              className="text-xs text-teal-800 underline"
            >
              Знайти в черзі
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

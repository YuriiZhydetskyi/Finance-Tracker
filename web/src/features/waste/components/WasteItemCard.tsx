import { useState } from 'react';
import { roundQty } from '@finance-tracker/domain';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { formatMoney } from '@/shared/utils/format-money';
import { formatDate } from '@/shared/utils/format-date';
import type { WasteItemRow } from '../api/use-waste-items';
import { useUpdateItemWasteMutation } from '../api/use-update-item-waste-mutation';

type Props = {
  item: WasteItemRow;
};

function formatTimestampShort(iso: string): string {
  // wasted_at is a full ISO instant; we only care about the date for display.
  const dateOnly = iso.slice(0, 10);
  return formatDate(dateOnly);
}

export function WasteItemCard({ item }: Props) {
  const mutation = useUpdateItemWasteMutation();

  // Local draft of the wasted_qty input. Persisted via Save button only —
  // the receipt-form flow elsewhere is auto-validating, but here mistypes
  // are easy ("3" vs "30") and a confirm step is safer.
  const [draft, setDraft] = useState(String(item.wasted_qty));
  const draftNumber = Number(draft);
  const draftIsValid =
    draft !== '' &&
    Number.isFinite(draftNumber) &&
    draftNumber >= 0 &&
    roundQty(draftNumber) <= item.qty;

  const dirty = draftIsValid && roundQty(draftNumber) !== item.wasted_qty;
  const unitPriceEffective = item.unit_price_orig - item.discount_orig;
  const draftValue = draftIsValid ? roundQty(draftNumber) * unitPriceEffective : 0;

  const onSave = () => {
    if (!dirty) return;
    mutation.mutate({
      itemId: item.id,
      receiptId: item.receipt.id,
      wastedQty: roundQty(draftNumber),
    });
  };

  const onReset = () => {
    setDraft(String(item.wasted_qty));
  };

  const hasWaste = item.wasted_qty > 0;
  const wastedValue = (item.wasted_qty / item.qty) * item.total_orig;

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-slate-900">{item.product_name}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
              {item.category}
            </span>
            <span>{item.receipt.store}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDate(item.receipt.date)}</span>
          </div>
        </div>
        <div className="text-right text-sm tabular-nums text-slate-700">
          <div>
            {item.qty} × {formatMoney(unitPriceEffective, item.receipt.currency)}
          </div>
          <div className="font-semibold text-slate-900">
            {formatMoney(item.total_orig, item.receipt.currency)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[8rem]">
          <label className="text-xs font-medium text-slate-600" htmlFor={`waste-${item.id}`}>
            Викинути (з {item.qty})
          </label>
          <Input
            id={`waste-${item.id}`}
            type="number"
            step="0.001"
            min="0"
            max={item.qty}
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <div className="min-w-[7rem] text-right">
          <div className="text-xs text-slate-500">Ціна викинутого</div>
          <div
            className={`text-sm tabular-nums ${
              draftIsValid && draftNumber > 0 ? 'font-semibold text-red-600' : 'text-slate-400'
            }`}
          >
            {draftIsValid
              ? formatMoney(draftValue, item.receipt.currency)
              : formatMoney(0, item.receipt.currency)}
          </div>
        </div>
        <div className="flex gap-1">
          {dirty && (
            <Button variant="ghost" type="button" onClick={onReset} disabled={mutation.isPending}>
              Скинути
            </Button>
          )}
          <Button type="button" onClick={onSave} disabled={!dirty || mutation.isPending}>
            {mutation.isPending ? 'Зберігаю…' : 'Зберегти'}
          </Button>
        </div>
      </div>

      {!draftIsValid && draft !== '' && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          Має бути число від 0 до {item.qty}.
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {mutation.error.message}
        </p>
      )}

      {hasWaste && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="font-medium">🗑 Викинуто:</span> {item.wasted_qty} з {item.qty}
          {' · '}
          <span className="font-semibold">{formatMoney(wastedValue, item.receipt.currency)}</span>
          {item.wasted_at && (
            <>
              {' · '}
              <span className="text-red-700">{formatTimestampShort(item.wasted_at)}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

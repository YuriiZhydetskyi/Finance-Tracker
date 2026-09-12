import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import type { PackagedProductListRow } from '../api/use-packaged-products';
import type { PackagingCandidateRow } from '../types';

type Props = Readonly<{
  open: boolean;
  candidate: PackagingCandidateRow | null;
  products: PackagedProductListRow[];
  submitting: boolean;
  onClose: () => void;
  onLink: (packagedProductId: string) => void | Promise<void>;
}>;

const MAX_RESULTS = 25;

export function LinkStoreProductDialog({
  open,
  candidate,
  products,
  submitting,
  onClose,
  onLink,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // The search seeds from the candidate's brand so the obvious match is usually
  // already listed, but stays freely editable. Stored as an override plus a
  // render-time reset (React's "adjusting state when a prop changes" pattern)
  // rather than an effect, which would be a cascading render.
  const [queryOverride, setQueryOverride] = useState<string | null>(null);
  const [seededFor, setSeededFor] = useState<string | null>(candidate?.product_id ?? null);
  const candidateId = candidate?.product_id ?? null;
  if (seededFor !== candidateId) {
    setSeededFor(candidateId);
    setQueryOverride(null);
  }
  const query = queryOverride ?? candidate?.brand ?? '';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = needle
      ? products.filter(
          (product) =>
            product.name.toLowerCase().includes(needle) ||
            (product.brand?.toLowerCase().includes(needle) ?? false) ||
            (product.barcode?.includes(needle) ?? false),
        )
      : products;
    return pool.slice(0, MAX_RESULTS);
  }, [products, query]);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={handleBackdropClick}
      aria-labelledby="link-store-product-title"
      className="max-h-[85vh] w-[min(96vw,40rem)] rounded-md border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="flex max-h-[85vh] flex-col overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 id="link-store-product-title" className="text-base font-semibold text-slate-900">
            Привʼязати до наявної картки
          </h2>
          {candidate ? (
            <p className="mt-0.5 text-xs text-slate-600">
              «{candidate.product_name}» з {candidate.store}
              {candidate.receipt_labels.length > 0
                ? ` (у чеку: ${candidate.receipt_labels.join(' · ')})`
                : ''}
            </p>
          ) : null}
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          <Input
            aria-label="Пошук картки"
            placeholder="Назва, бренд або штрихкод"
            value={query}
            onChange={(event) => setQueryOverride(event.target.value)}
          />
          {matches.length === 0 ? (
            <p className="text-sm text-slate-600">Нічого не знайдено.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {matches.map((product) => (
                <li key={product.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{product.name}</p>
                    <p className="text-xs text-slate-500">
                      {product.category}
                      {product.barcode ? ` · ${product.barcode}` : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={submitting}
                    onClick={() => void onLink(product.id)}
                    className="px-3"
                  >
                    Привʼязати
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-200 px-4 py-3">
          <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>
            Закрити
          </Button>
        </div>
      </div>
    </dialog>
  );
}

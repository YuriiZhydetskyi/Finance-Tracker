import { useEffect, useRef, useState } from 'react';
import type { PackagingCandidateRow } from '../types';
import {
  matchesReceiptHint,
  type ImportedPackagedProduct,
  type PackagingImport,
} from '../utils/packaging-import';
import { usePackagingCandidates } from '../api/use-packaging-candidates';
import { Input } from '@/shared/ui/Input';

const KIND_LABELS = {
  front: 'Лицевий бік',
  back: 'Зворот',
  nutrition: 'Харчова цінність',
  ingredients: 'Склад',
  barcode: 'Штрихкод',
  other: 'Інше',
};

function PagePreview({ blob, label }: { blob: Blob; label: string }) {
  const image = useRef<HTMLImageElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    if (image.current) image.current.src = next;
    if (link.current) link.current.href = next;
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return (
    <figure className="w-36 rounded border border-slate-200 p-2">
      <a ref={link} target="_blank" rel="noreferrer">
        <img ref={image} alt={label} className="h-40 w-full object-contain" />
      </a>
      <figcaption className="mt-1 text-xs text-slate-600">{label}</figcaption>
    </figure>
  );
}

function ProductLinks({
  product,
  candidate,
  disabled,
  onChange,
}: {
  product: ImportedPackagedProduct;
  candidate: PackagingCandidateRow | null;
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const candidates = usePackagingCandidates({ query });
  // Keep selected rows visible while the server-side search changes.
  const [selectedRows, setSelectedRows] = useState<PackagingCandidateRow[]>([]);
  const rows = [
    ...new Map(
      [...selectedRows, ...(candidate ? [candidate] : []), ...(candidates.data ?? [])].map(
        (row) => [row.product_id, row],
      ),
    ).values(),
  ].sort(
    (a, b) =>
      Number(matchesReceiptHint(b, product.receipt_matches)) -
      Number(matchesReceiptHint(a, product.receipt_matches)),
  );
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Назви в чеках — вибери лише підтверджені відповідності</p>
      {product.receipt_matches.map((hint, index) => (
        <p key={index} className="text-xs text-slate-600">
          Підказка ШІ: {hint.store} · «{hint.receipt_label}»
          {hint.receipt_date ? ` · дата чека ${hint.receipt_date}` : ''}
          {hint.receipt_page ? ` · сторінка ${String(hint.receipt_page)}` : ''}
        </p>
      ))}
      <p className="text-xs text-slate-500">
        Схожа дата сама по собі не підтверджує товар. Можна зберегти картку без прив’язки.
      </p>
      <Input
        aria-label={`Пошук позиції для ${product.parsed.name}`}
        value={query}
        placeholder="Магазин, назва або код із чека"
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
      />
      {candidates.isError ? (
        <p role="alert" className="text-sm text-red-700">
          Не вдалося знайти позиції. Перевір мережу або збережи без прив’язки.
        </p>
      ) : null}
      {candidates.isPending ? <p className="text-xs text-slate-500">Шукаю…</p> : null}
      <div className="max-h-44 space-y-1 overflow-y-auto">
        {rows.map((row) => (
          <label
            key={row.product_id}
            className="flex items-start gap-2 rounded border border-slate-100 p-2 text-sm"
          >
            <input
              type="checkbox"
              className="mt-1"
              disabled={disabled}
              checked={product.link_product_ids.includes(row.product_id)}
              onChange={(event) => {
                if (event.target.checked) {
                  setSelectedRows((current) => [
                    ...current.filter((r) => r.product_id !== row.product_id),
                    row,
                  ]);
                  onChange([...product.link_product_ids, row.product_id]);
                } else {
                  onChange(product.link_product_ids.filter((id) => id !== row.product_id));
                }
              }}
            />
            <span>
              {row.store} · {row.product_name}
              {row.receipt_labels.length ? (
                <span className="block text-xs text-slate-500">
                  У чеку: {row.receipt_labels.join(' · ')}
                </span>
              ) : null}
              {row.last_purchased_on ? (
                <span className="block text-xs text-slate-500">
                  Остання покупка: {row.last_purchased_on}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
      {(candidates.data?.length ?? 0) >= 200 ? (
        <p className="text-xs text-slate-500">
          Показано перші 200 збігів. Уточни пошук, щоб знайти інші.
        </p>
      ) : null}
    </div>
  );
}

export function PackagingImportReview({
  batch,
  pages,
  pageCount,
  candidate,
  disabled,
  onChange,
}: {
  batch: PackagingImport;
  pages: Map<number, Blob>;
  pageCount: number | null;
  candidate: PackagingCandidateRow | null;
  disabled: boolean;
  onChange: (products: ImportedPackagedProduct[]) => void;
}) {
  const assigned = new Set([
    ...batch.receipt_pages,
    ...batch.products.flatMap((p) => p.source_pages.map((ref) => ref.page)),
  ]);
  const skipped =
    pageCount == null
      ? []
      : Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => !assigned.has(p));
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Відкрий мініатюри й звір сторінки перед збереженням. Нові фото додаються до наявної картки;
        її назва та харчові дані зберігаються без змін.
      </p>
      {batch.receipt_pages.length ? (
        <section className="space-y-2 rounded border border-slate-200 p-3">
          <p className="text-sm font-medium">Сторінки чека — лише для перевірки відповідностей</p>
          <p className="text-xs text-slate-500">
            Цей імпорт не створює чек. За потреби додай його через звичайний імпорт чеків.
          </p>
          <div className="flex flex-wrap gap-2">
            {batch.receipt_pages.map((page) => {
              const blob = pages.get(page);
              return blob ? (
                <PagePreview key={page} blob={blob} label={`Чек · сторінка ${String(page)}`} />
              ) : null;
            })}
          </div>
        </section>
      ) : null}
      {skipped.length ? (
        <p className="text-sm text-amber-800">
          Сторінки без призначення не будуть збережені: {skipped.join(', ')}. Якщо тут є фото
          товарів, повернись і виправ JSON.
        </p>
      ) : null}
      {batch.products.map((product, index) => (
        <section key={index} className="space-y-3 rounded border border-slate-200 bg-white p-3">
          <h3 className="font-semibold">{product.parsed.name}</h3>
          <p className="text-sm text-teal-800">
            {product.existing_product_id ? 'Використати наявну картку' : 'Створити нову картку'}
            {product.parsed.barcode ? ` · штрихкод ${String(product.parsed.barcode)}` : ''}
          </p>
          {!product.source_pages.length ? (
            <p className="text-sm text-amber-800">Лише дані: фото упаковки ще не додано.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {product.source_pages.map((ref) => {
              const blob = pages.get(ref.page);
              return blob ? (
                <PagePreview
                  key={ref.page}
                  blob={blob}
                  label={`${KIND_LABELS[ref.kind]} · сторінка ${String(ref.page)}`}
                />
              ) : null;
            })}
          </div>
          <ProductLinks
            product={product}
            candidate={candidate}
            disabled={disabled}
            onChange={(ids) =>
              onChange(
                batch.products.map((row, i) =>
                  i === index ? { ...row, link_product_ids: ids } : row,
                ),
              )
            }
          />
        </section>
      ))}
    </div>
  );
}

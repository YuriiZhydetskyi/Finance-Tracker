import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useCopyToClipboard } from '@/shared/hooks/use-copy-to-clipboard';
import { openPackagingPdf } from '@/shared/lib/dependencies';
import { Button } from '@/shared/ui/Button';
import {
  buildPackagedProductPrompt,
  EXAMPLE_PACKAGED_PRODUCT_JSON,
  type PromptTaxonomy,
} from '../utils/build-packaged-product-prompt';
import {
  parsePackagingImport,
  validatePackagingPages,
  validatePackagingLinks,
  type ExistingPackagingIdentity,
  type PackagingImport,
} from '../utils/packaging-import';
import {
  createPackagingSavePlan,
  type PackagingSavePlan,
  type PackagingImportSource,
} from '../api/use-save-packaged-products-mutation';
import { PackagingImportReview } from './PackagingImportReview';
import type { PackagingCandidateRow } from '../types';

export type { ImportedPackagedProduct } from '../utils/packaging-import';

type Props = Readonly<{
  open: boolean;
  categories: string[];
  taxonomy: PromptTaxonomy;
  existing: ExistingPackagingIdentity[];
  candidate?: PackagingCandidateRow | null;
  submitting: boolean;
  onClose: () => void;
  onImported: (
    plan: PackagingSavePlan,
    onProgress: (message: string) => void,
  ) => void | Promise<void>;
}>;

type Review = {
  batch: PackagingImport;
  source: PackagingImportSource | null;
  pageCount: number | null;
  pages: Map<number, Blob>;
};

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
  const savePlan = useRef<PackagingSavePlan | null>(null);
  const prompt = useMemo(
    () => buildPackagedProductPrompt(categories, taxonomy, candidate),
    [categories, taxonomy, candidate],
  );
  const [jsonText, setJsonText] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [startedSave, setStartedSave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const { copyState, copy } = useCopyToClipboard(prompt);
  const busy = preparing || saving || submitting;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const handleClose = () => {
    if (!busy) onClose();
  };

  const prepareReview = async () => {
    setError(null);
    setPreparing(true);
    try {
      const batch = parsePackagingImport(jsonText, { categories, taxonomy, existing });
      let source: PackagingImportSource | null = null;
      let pageCount: number | null = null;
      let pages = new Map<number, Blob>();
      if (pdfFile) {
        setProgress('Читаю PDF…');
        const pdf = await openPackagingPdf(pdfFile);
        try {
          pageCount = pdf.pageCount;
          validatePackagingPages(batch, pageCount);
          pages = await pdf.renderPages(
            [
              ...batch.receipt_pages,
              ...batch.products.flatMap((p) => p.source_pages.map((ref) => ref.page)),
            ],
            (done, total) => setProgress(`Готую JPEG: ${String(done)} / ${String(total)}`),
          );
          source = {
            file_name: pdfFile.name,
            fingerprint: pdf.fingerprint,
            receipt_pages: batch.receipt_pages,
            pages,
          };
        } finally {
          await pdf.close();
        }
      } else {
        validatePackagingPages(batch, null);
      }
      setReview({ batch, source, pageCount, pages });
      setConfirmed(false);
      savePlan.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося перевірити імпорт.');
    } finally {
      setPreparing(false);
      setProgress('');
    }
  };

  const save = async () => {
    if (!review || !confirmed || busy) return;
    setError(null);
    setSaving(true);
    try {
      validatePackagingLinks(review.batch.products);
      savePlan.current ??= createPackagingSavePlan(review.batch.products, review.source);
      setStartedSave(true);
      await onImported(savePlan.current, setProgress);
      setJsonText('');
      setPdfFile(null);
      setReview(null);
      setConfirmed(false);
      setStartedSave(false);
      savePlan.current = null;
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося зберегти імпорт.');
    } finally {
      setSaving(false);
      setProgress('');
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) void (review ? save() : prepareReview());
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        handleClose();
      }}
      aria-labelledby="packaged-json-title"
      className="m-auto max-h-[92vh] w-[min(96vw,64rem)] rounded-md border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <form onSubmit={submit} className="flex max-h-[92vh] flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 id="packaged-json-title" className="text-base font-semibold text-slate-900">
              Товари з JSON і PDF
            </h2>
            <p className="text-xs text-slate-600">
              {review
                ? 'Перевір фото та вибери відповідні назви в чеках.'
                : 'Скопіюй запит для ШІ, додай той самий PDF і встав отриманий JSON.'}
            </p>
          </div>
          <Button type="button" variant="ghost" disabled={busy} onClick={handleClose}>
            Закрити
          </Button>
        </div>
        <div className="space-y-4 overflow-y-auto p-4">
          {!review ? (
            <>
              <div className="rounded border border-slate-200 p-3 text-sm text-slate-700">
                Одна сторінка упаковки — один товар. Фото лицевого боку й звороту можуть бути на
                різних сторінках. Сторінки чека позначаються окремо. Номери сторінок рахуються від
                1, включно з чеком.
              </div>
              <label className="block space-y-1 text-sm font-medium">
                <span>PDF із фотографіями (до 20 МБ, необов’язково для JSON без сторінок)</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={busy}
                  className="block w-full text-sm"
                  onChange={(event) => setPdfFile(event.target.files?.[0] ?? null)}
                />
              </label>
              {pdfFile ? (
                <div className="flex items-center gap-2 text-sm">
                  <span>{pdfFile.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setPdfFile(null)}
                  >
                    Прибрати PDF
                  </Button>
                </div>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2">
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="packaged-prompt" className="text-sm font-medium">
                      Запит для ШІ
                    </label>
                    <Button type="button" variant="secondary" onClick={() => void copy()}>
                      {copyState === 'copied'
                        ? 'Скопійовано'
                        : copyState === 'failed'
                          ? 'Не вдалося скопіювати'
                          : 'Скопіювати запит'}
                    </Button>
                  </div>
                  <textarea
                    id="packaged-prompt"
                    readOnly
                    value={prompt}
                    rows={15}
                    className="w-full rounded border border-slate-300 bg-slate-50 p-3 font-mono text-xs"
                  />
                </section>
                <section className="space-y-2">
                  <label htmlFor="packaged-json" className="text-sm font-medium">
                    JSON
                  </label>
                  <textarea
                    id="packaged-json"
                    value={jsonText}
                    disabled={busy}
                    onChange={(event) => setJsonText(event.target.value)}
                    rows={15}
                    placeholder={EXAMPLE_PACKAGED_PRODUCT_JSON}
                    className="w-full rounded border border-slate-300 p-3 font-mono text-xs"
                  />
                </section>
              </div>
            </>
          ) : (
            <>
              <PackagingImportReview
                batch={review.batch}
                pages={review.pages}
                pageCount={review.pageCount}
                candidate={candidate}
                disabled={busy || startedSave}
                onChange={(products) => {
                  setReview({ ...review, batch: { ...review.batch, products } });
                  setConfirmed(false);
                }}
              />
              {review.batch.warnings.length ? (
                <div className="space-y-1 rounded bg-amber-50 p-3 text-sm text-amber-900">
                  {review.batch.warnings.map((warning, i) => (
                    <p key={i}>{warning}</p>
                  ))}
                </div>
              ) : null}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy || startedSave}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                Я перевірив сторінки, наявні картки та вибрані прив’язки. Сторінки без призначення
                можна пропустити.
              </label>
            </>
          )}
          {error ? (
            <p
              role="alert"
              className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              {error}
            </p>
          ) : null}
          {error && startedSave ? (
            <p className="text-sm text-amber-800">
              Частину карток або фото вже могло бути збережено. Натисни «Повторити збереження»:
              завершені кроки не дублюються. Не закривай цю сторінку до завершення. Прив’язки
              виконуються після запису фото. Якщо потрібно змінити відповідності, перевір імпорт
              заново; вже збережені картки залишаться в каталозі.
            </p>
          ) : null}
          {progress ? (
            <p role="status" className="text-sm text-teal-800">
              {progress}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">
          {review && (!startedSave || error) ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setReview(null);
                setConfirmed(false);
                setError(null);
                setStartedSave(false);
                savePlan.current = null;
              }}
            >
              {startedSave ? 'Перевірити імпорт заново' : 'Змінити JSON або PDF'}
            </Button>
          ) : null}
          <Button type="submit" disabled={busy || (review != null && !confirmed)}>
            {busy
              ? 'Обробляю…'
              : review
                ? startedSave
                  ? 'Повторити збереження'
                  : 'Зберегти товари та фото'
                : 'Перевірити JSON і PDF'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

import { useMemo, useRef, useState, type SubmitEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useCopyToClipboard } from '@/shared/hooks/use-copy-to-clipboard';
import { useModalDialog } from '@/shared/hooks/use-modal-dialog';
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
import { receiptImportFileName } from '../utils/packaging-receipt';
import {
  createPackagingSavePlan,
  type PackagingSavePlan,
  type PackagingImportSource,
} from '../api/use-save-packaged-products-mutation';
import { usePackagingReceiptDuplicates } from '../api/use-receipt-duplicates';
import { PackagingImportReview } from './PackagingImportReview';
import { PackagingReceiptOption } from './PackagingReceiptOption';
import type { PackagingCandidateRow } from '../types';

export type { ImportedPackagedProduct } from '../utils/packaging-import';

export type SavedPackagedProduct = { id: string; name: string };
export type PackagingReceiptRequest = { file: File; paidBy: string };

type Props = Readonly<{
  open: boolean;
  categories: string[];
  taxonomy: PromptTaxonomy;
  existing: ExistingPackagingIdentity[];
  candidate?: PackagingCandidateRow | null;
  submitting: boolean;
  /** People who can be named as the payer of the receipt on the PDF. */
  payerOptions?: string[];
  /** Pre-selected payer: the signed-in user. */
  defaultPayer?: string;
  onClose: () => void;
  /** Saves the cards and photos. */
  onImported: (
    plan: PackagingSavePlan,
    onProgress: (message: string) => void,
  ) => void | SavedPackagedProduct[] | Promise<void | SavedPackagedProduct[]>;
  /**
   * Sends the receipt pages to the durable receipt import and resolves with the new
   * batch id. Without it the receipt pages are only used as evidence for the cards.
   */
  onEnqueueReceipt?: (request: PackagingReceiptRequest) => Promise<string>;
  /** Called once the person is done with the dialog after everything that was asked has run. */
  onFinished?: (saved: SavedPackagedProduct[]) => void;
}>;

type Review = {
  batch: PackagingImport;
  source: PackagingImportSource | null;
  pageCount: number | null;
  pages: Map<number, Blob>;
  /** The receipt pages cut out into a PDF of their own; null when there is none or cutting failed. */
  receiptPdf: Blob | null;
  receiptCutError: string | null;
};

type ReceiptOutcome = { status: 'queued'; batchId: string } | { status: 'failed'; message: string };

type Outcome = { saved: SavedPackagedProduct[]; receipt: ReceiptOutcome };

export function PackagedProductJsonImportDialog({
  open,
  categories,
  taxonomy,
  existing,
  candidate = null,
  submitting,
  payerOptions = [],
  defaultPayer = '',
  onClose,
  onImported,
  onEnqueueReceipt,
  onFinished,
}: Props) {
  const dialogRef = useModalDialog(open);
  const savePlan = useRef<PackagingSavePlan | null>(null);
  const receiptRequest = useRef<PackagingReceiptRequest | null>(null);
  const prompt = useMemo(
    () => buildPackagedProductPrompt(categories, taxonomy, candidate),
    [categories, taxonomy, candidate],
  );
  const [jsonText, setJsonText] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [addReceipt, setAddReceipt] = useState(true);
  const [payerChoice, setPayerChoice] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [startedSave, setStartedSave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const { copyState, copy } = useCopyToClipboard(prompt);
  const busy = preparing || saving || submitting;

  const receiptPages = review?.batch.receipt_pages ?? [];
  const offersReceipt = onEnqueueReceipt != null && receiptPages.length > 0;
  const payer = payerChoice || defaultPayer;
  const receiptDuplicates = usePackagingReceiptDuplicates(
    review && offersReceipt ? review.batch.receipt : null,
  );

  const resetAll = () => {
    setJsonText('');
    setPdfFile(null);
    setReview(null);
    setConfirmed(false);
    setAddReceipt(true);
    setPayerChoice('');
    setOutcome(null);
    setError(null);
    setStartedSave(false);
    savePlan.current = null;
    receiptRequest.current = null;
  };

  const finish = (saved: SavedPackagedProduct[]) => {
    resetAll();
    onFinished?.(saved);
    onClose();
  };

  const handleClose = () => {
    if (busy) return;
    if (outcome) finish(outcome.saved);
    else onClose();
  };

  const prepareReview = async () => {
    setError(null);
    setPreparing(true);
    try {
      const batch = parsePackagingImport(jsonText, { categories, taxonomy, existing });
      let source: PackagingImportSource | null = null;
      let pageCount: number | null = null;
      let pages = new Map<number, Blob>();
      let receiptPdf: Blob | null = null;
      let receiptCutError: string | null = null;
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
          if (onEnqueueReceipt && batch.receipt_pages.length > 0) {
            setProgress('Вирізаю сторінки чека…');
            try {
              receiptPdf = await pdf.extractPages(batch.receipt_pages);
            } catch (e) {
              // A receipt that cannot be cut out must never block the cards.
              receiptCutError = e instanceof Error ? e.message : 'невідома помилка';
            }
          }
        } finally {
          await pdf.close();
        }
      } else {
        validatePackagingPages(batch, null);
      }
      setReview({ batch, source, pageCount, pages, receiptPdf, receiptCutError });
      setConfirmed(false);
      setAddReceipt(true);
      savePlan.current = null;
      receiptRequest.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося перевірити імпорт.');
    } finally {
      setPreparing(false);
      setProgress('');
    }
  };

  const enqueueReceipt = async (
    request: PackagingReceiptRequest,
    saved: SavedPackagedProduct[],
  ): Promise<void> => {
    if (!onEnqueueReceipt) return;
    setProgress('Додаю чек до імпорту чеків…');
    try {
      const batchId = await onEnqueueReceipt(request);
      setOutcome({ saved, receipt: { status: 'queued', batchId } });
    } catch (e) {
      setOutcome({
        saved,
        receipt: {
          status: 'failed',
          message: e instanceof Error ? e.message : 'Не вдалося додати чек до імпорту.',
        },
      });
    }
  };

  const save = async () => {
    if (!review || !confirmed || busy) return;
    setError(null);
    const wantsReceipt = offersReceipt && addReceipt && review.receiptPdf != null;
    if (wantsReceipt && !payer) {
      setError('Вибери, хто оплатив чек, або зніми позначку про додавання чека.');
      return;
    }
    setSaving(true);
    try {
      validatePackagingLinks(review.batch.products);
      savePlan.current ??= createPackagingSavePlan(review.batch.products, review.source);
      setStartedSave(true);
      const saved = (await onImported(savePlan.current, setProgress)) ?? [];
      if (wantsReceipt && review.receiptPdf) {
        const request: PackagingReceiptRequest = {
          file: new File(
            [review.receiptPdf],
            receiptImportFileName(review.source?.file_name ?? 'чек.pdf', receiptPages),
            { type: 'application/pdf' },
          ),
          paidBy: payer,
        };
        receiptRequest.current = request;
        // The cards are saved at this point; the receipt is a second, separate step
        // whose failure is shown and can be retried without touching them again.
        await enqueueReceipt(request, saved);
      } else {
        finish(saved);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося зберегти імпорт.');
    } finally {
      setSaving(false);
      setProgress('');
    }
  };

  const retryReceipt = async () => {
    const request = receiptRequest.current;
    if (!outcome || !request || busy) return;
    setSaving(true);
    try {
      await enqueueReceipt(request, outcome.saved);
    } finally {
      setSaving(false);
      setProgress('');
    }
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || outcome) return;
    void (review ? save() : prepareReview());
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
              {outcome
                ? 'Картки збережено.'
                : review
                  ? 'Перевір фото та вибери відповідні назви в чеках.'
                  : 'Скопіюй запит для ШІ, додай той самий PDF і встав отриманий JSON.'}
            </p>
          </div>
          <Button type="button" variant="ghost" disabled={busy} onClick={handleClose}>
            Закрити
          </Button>
        </div>
        <div className="space-y-4 overflow-y-auto p-4">
          {outcome ? (
            <div className="space-y-3">
              <p
                role="status"
                className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
              >
                Збережено карток: {outcome.saved.length}.
              </p>
              {outcome.receipt.status === 'queued' ? (
                <p
                  role="status"
                  className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"
                >
                  Чек додано до імпорту чеків. Він опрацьовується у фоні; результат і можливі
                  винятки видно на сторінці імпорту.{' '}
                  <Link
                    to="/imports/$id"
                    params={{ id: outcome.receipt.batchId }}
                    className="font-medium underline"
                  >
                    Відкрити імпорт чека
                  </Link>
                </p>
              ) : (
                <div
                  role="alert"
                  className="space-y-1 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                >
                  <p className="font-medium">Картки збережено, але чек не додано до імпорту.</p>
                  <p>{outcome.receipt.message}</p>
                  <p>
                    Спробуй ще раз кнопкою нижче або додай чек вручну через «Масовий імпорт» на
                    головній сторінці.
                  </p>
                </div>
              )}
            </div>
          ) : !review ? (
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
              {offersReceipt ? (
                <PackagingReceiptOption
                  pages={receiptPages}
                  summary={review.batch.receipt}
                  cutError={review.receiptCutError}
                  enabled={addReceipt}
                  onEnabledChange={setAddReceipt}
                  payerOptions={payerOptions}
                  payer={payer}
                  onPayerChange={setPayerChoice}
                  duplicates={receiptDuplicates.data ?? []}
                  disabled={busy || startedSave}
                />
              ) : null}
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
          {outcome ? (
            <>
              {outcome.receipt.status === 'failed' ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void retryReceipt()}
                >
                  {busy ? 'Додаю…' : 'Повторити додавання чека'}
                </Button>
              ) : null}
              <Button type="button" disabled={busy} onClick={handleClose}>
                {outcome.receipt.status === 'failed' ? 'Закрити без чека' : 'Готово'}
              </Button>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}

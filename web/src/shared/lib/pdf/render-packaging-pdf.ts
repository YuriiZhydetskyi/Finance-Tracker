import type { PDFDocumentProxy } from 'pdfjs-dist';
import { extractPdfPages } from './extract-pdf-pages';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_EDGE = 3000;
const MAX_TOTAL_JPEG_BYTES = 100 * 1024 * 1024;

export type PackagingPdf = {
  pageCount: number;
  fingerprint: string;
  renderPages(
    pages: number[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<number, Blob>>;
  /** A new PDF made only of these pages (1-based, in the order given); the original bytes are kept. */
  extractPages(pages: number[]): Promise<Blob>;
  close(): Promise<void>;
};

export async function openPackagingPdf(file: File): Promise<PackagingPdf> {
  if (file.size === 0 || file.size > MAX_BYTES)
    throw new Error('PDF має бути непорожнім і не більшим за 20 МБ.');
  // The parser and worker are loaded only after a PDF is selected.
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const fingerprint = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const assets = `${import.meta.env.BASE_URL}pdfjs/`;
  const loading = pdfjs.getDocument({
    // PDF.js hands its buffer to the worker; give it a copy so the original bytes
    // stay available for cutting pages out later.
    data: new Uint8Array(bytes.slice(0)),
    useSystemFonts: true,
    stopAtErrors: true,
    wasmUrl: `${assets}wasm/`,
    standardFontDataUrl: `${assets}standard_fonts/`,
    cMapUrl: `${assets}cmaps/`,
    iccUrl: `${assets}iccs/`,
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await loading.promise;
    if (doc.numPages > MAX_PAGES)
      throw new Error(
        `PDF має понад ${String(MAX_PAGES)} сторінок. Розділи його на менші документи.`,
      );
  } catch (error) {
    await loading.destroy();
    throw new Error(
      'Не вдалося прочитати PDF. Перевір, чи він справний, без пароля та містить не більше 100 сторінок.',
      { cause: error },
    );
  }
  return {
    pageCount: doc.numPages,
    fingerprint,
    close: () => loading.destroy(),
    async extractPages(pages) {
      const cut = await extractPdfPages(new Uint8Array(bytes), pages);
      return new Blob([cut.slice().buffer], { type: 'application/pdf' });
    },
    async renderPages(pages, onProgress) {
      const unique = [...new Set(pages)];
      if (unique.some((page) => !Number.isInteger(page) || page < 1 || page > doc.numPages)) {
        throw new Error('Номер сторінки поза межами PDF.');
      }
      const result = new Map<number, Blob>();
      let totalBytes = 0;
      for (const [index, number] of unique.entries()) {
        const page = await doc.getPage(number);
        const natural = page.getViewport({ scale: 1 });
        const scale = Math.min(4, MAX_EDGE / Math.max(natural.width, natural.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        try {
          await page.render({ canvas, viewport, background: 'rgb(255,255,255)' }).promise;
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (jpeg) =>
                jpeg ? resolve(jpeg) : reject(new Error('Не вдалося створити JPEG сторінки.')),
              'image/jpeg',
              0.92,
            ),
          );
          totalBytes += blob.size;
          if (blob.size > MAX_BYTES) {
            throw new Error(
              `JPEG сторінки ${String(number)} перевищує 20 МБ. Зменш розмір цієї сторінки у PDF.`,
            );
          }
          if (totalBytes > MAX_TOTAL_JPEG_BYTES)
            throw new Error('Зображення займають понад 100 МБ. Розділи PDF на менші документи.');
          result.set(number, blob);
          onProgress?.(index + 1, unique.length);
        } finally {
          canvas.width = 0;
          canvas.height = 0;
          page.cleanup();
        }
      }
      return result;
    },
  };
}

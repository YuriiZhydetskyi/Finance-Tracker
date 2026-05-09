// Dispatches an arbitrary picked file (jpg/png/webp/heic/heif/pdf) to the right
// pre-processing step before parse-receipt. Raster images go through the canvas
// resize → JPEG path. HEIC/HEIF go through `heic-to` first because <img>/canvas
// can't decode them in Chromium-based browsers. PDFs pass through untouched —
// both Gemini (inline_data) and Anthropic (document block) accept raw PDF bytes
// and resizing them isn't possible in-browser without a full PDF stack.

import { heicTo } from 'heic-to';
import { resizeImage } from './resize-image';

const PDF_MAX_BYTES = 20 * 1024 * 1024;

const RASTER_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const HEIC_MIME = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);
const HEIC_EXT = /\.(heic|heif)$/i;

export type PreparedFile = {
  /** Bytes ready to ship to the AI / Storage. JPEG for any image input, PDF unchanged. */
  blob: Blob;
  /** Object URL for an `<img>` preview. `null` for PDFs (no in-browser preview). Caller must revokeObjectURL. */
  previewUrl: string | null;
  /** Effective MIME for the wire payload. */
  mimeType: string;
};

export async function prepareFile(file: File): Promise<PreparedFile> {
  const type = (file.type || '').toLowerCase();
  const name = file.name || '';

  if (type === 'application/pdf' || /\.pdf$/i.test(name)) {
    if (file.size > PDF_MAX_BYTES) {
      throw new Error(
        `PDF завеликий: ${formatMb(file.size)} МБ. Максимум ${formatMb(PDF_MAX_BYTES)} МБ.`,
      );
    }
    const blob =
      file.type === 'application/pdf' ? file : new Blob([file], { type: 'application/pdf' });
    return { blob, previewUrl: null, mimeType: 'application/pdf' };
  }

  if (HEIC_MIME.has(type) || HEIC_EXT.test(name)) {
    let jpegFromHeic: Blob;
    try {
      jpegFromHeic = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
    } catch (e) {
      throw new Error(
        `Не вдалося прочитати HEIC/HEIF файл: ${e instanceof Error ? e.message : 'невідома помилка'}`,
      );
    }
    const resized = await resizeImage(jpegFromHeic);
    return { blob: resized, previewUrl: URL.createObjectURL(resized), mimeType: 'image/jpeg' };
  }

  if (RASTER_MIME.has(type)) {
    const resized = await resizeImage(file);
    return { blob: resized, previewUrl: URL.createObjectURL(resized), mimeType: 'image/jpeg' };
  }

  throw new Error(`Непідтримуваний формат файлу: ${type || name || 'невідомий'}`);
}

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

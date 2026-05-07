// Resize an image File/Blob to a max edge length, re-encode as JPEG.
// Direct port of legacy/apps-script/src/ui/photo.html `compressImage` (1600px,
// q=0.8). Returns a Blob ready for upload to Supabase Storage.
//
// Browser-only: uses HTMLImageElement, HTMLCanvasElement, URL.createObjectURL.
// Not tested under Vitest — jsdom does not implement canvas. Manual smoke +
// future Playwright cover this.

export type ResizeOptions = {
  /** Max edge length in pixels. Default 1600. */
  maxEdge?: number;
  /** JPEG quality 0..1. Default 0.8. */
  quality?: number;
  /** Output MIME. Default `image/jpeg`. */
  mimeType?: string;
};

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_QUALITY = 0.8;
const DEFAULT_MIME = 'image/jpeg';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error('Image decode failed'));
    };
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas encoding to Blob failed'));
      },
      mime,
      quality,
    );
  });
}

export async function resizeImage(file: File | Blob, opts: ResizeOptions = {}): Promise<Blob> {
  const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const mimeType = opts.mimeType ?? DEFAULT_MIME;

  const objectUrl = URL.createObjectURL(file);
  let img: HTMLImageElement;
  try {
    img = await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');
  ctx.drawImage(img, 0, 0, w, h);

  return canvasToBlob(canvas, mimeType, quality);
}

/** Read a Blob into raw base64 (no `data:...;base64,` prefix). For Edge Function payload. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader returned non-string'));
        return;
      }
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => {
      reject(new Error('FileReader failed'));
    };
    reader.readAsDataURL(blob);
  });
}

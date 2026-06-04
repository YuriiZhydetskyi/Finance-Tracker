import { photoStorage } from '@/shared/lib/dependencies';

/**
 * Re-sign a queued photo and download it as a Blob so it can be fed back to the
 * AI parser. The Storage path outlives signed URLs, so we always re-sign here.
 */
export async function fetchPendingBlob(photoPath: string): Promise<Blob> {
  const signedUrl = await photoStorage.getSignedUrl(photoPath);
  const res = await fetch(signedUrl);
  if (!res.ok) {
    throw new Error(`Не вдалося завантажити фото з черги (HTTP ${res.status}).`);
  }
  return res.blob();
}

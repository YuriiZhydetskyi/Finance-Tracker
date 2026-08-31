// Photo storage port. UI/feature code depends on `IPhotoStorage` (via
// dependencies.ts), never on Supabase Storage directly. Swap to Cloudflare R2
// or S3 = sibling adapter file + change export line in index.ts.

export type UploadedPhoto = {
  /** Storage-internal path. Use this for re-signing or deletion. */
  path: string;
  /** Time-limited signed URL ready to store on the receipt's `photo_url` column. */
  signedUrl: string;
};

export type IPhotoStorage = {
  /**
   * Upload a photo blob. The adapter chooses the storage path
   * (e.g. `{email}/{yyyy}/{mm}/{ulid}.jpg`). Returns both the path (for later
   * re-signing or deletion) and a fresh signed URL.
   */
  upload(blob: Blob): Promise<UploadedPhoto>;

  /** Upload to a caller-owned path; large files use a resumable TUS upload. */
  uploadToPath(blob: Blob, path: string, onProgress?: (ratio: number) => void): Promise<void>;

  /** Re-sign a stored path. Default TTL: 1 hour. */
  getSignedUrl(path: string, ttlSec?: number): Promise<string>;

  /** Delete a photo by path. Surfaces errors; callers can `.catch(noop)` for best-effort cleanup. */
  remove(path: string): Promise<void>;
};

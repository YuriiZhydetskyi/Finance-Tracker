import { ulid } from '@finance-tracker/domain';
import { Upload } from 'tus-js-client';
import { supabase } from '../supabase-client';
import { authService } from '../auth';
import { env } from '../env';
import { wrapError } from '@/shared/utils/wrap-error';
import type { IPhotoStorage, UploadedPhoto } from './photo-storage.types';

const DEFAULT_TTL_SEC = 3600;
const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;

function resumableEndpoint(): string {
  const url = new URL(env.VITE_SUPABASE_URL);
  if (url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith('.storage.supabase.co')) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, '.storage.supabase.co');
  }
  url.pathname = '/storage/v1/upload/resumable';
  return url.toString();
}

export function extensionFor(contentType: string | null | undefined): string {
  switch ((contentType ?? '').toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
    case 'image/heif':
      return 'heic';
    case 'application/pdf':
      return 'pdf';
    case 'image/jpeg':
    case 'image/jpg':
    default:
      return 'jpg';
  }
}

async function defaultBuildPath(blob: Blob): Promise<string> {
  const user = await authService.getCurrentUser();
  if (!user) throw new Error('Cannot upload photo: no authenticated user.');
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const ext = extensionFor(blob.type);
  return `${user.email}/${yyyy}/${mm}/${ulid()}.${ext}`;
}

type SupabasePhotoStorageOptions = {
  bucket: string;
  /** Path builder for `upload()`. Defaults to `{email}/{yyyy}/{mm}/{ulid}.{ext}`. */
  buildPath?: (blob: Blob) => Promise<string>;
};

/**
 * One adapter, one bucket per instance. Parameterizing here rather than on
 * `IPhotoStorage` keeps the Supabase-Storage notion of a bucket out of the port
 * contract — an R2 adapter would not have to fake it — while still sharing the
 * resumable-upload and signing logic between receipts and packaging photos.
 */
export function createSupabasePhotoStorage(options: SupabasePhotoStorageOptions): IPhotoStorage {
  const { bucket, buildPath = defaultBuildPath } = options;

  async function uploadToPath(
    blob: Blob,
    path: string,
    onProgress?: (ratio: number) => void,
  ): Promise<void> {
    const contentType = blob.type || 'image/jpeg';
    if (blob.size <= RESUMABLE_THRESHOLD) {
      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, blob, { contentType, upsert: false });
      if (error) throw wrapError('Photo upload failed', error);
      onProgress?.(1);
      return;
    }

    const { data, error } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (error || !accessToken) throw new Error('Cannot start resumable upload: no session.');

    await new Promise<void>((resolve, reject) => {
      const upload = new Upload(blob, {
        endpoint: resumableEndpoint(),
        headers: {
          authorization: `Bearer ${accessToken}`,
          apikey: env.VITE_SUPABASE_ANON_KEY,
          'x-upsert': 'false',
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        retryDelays: [0, 1_000, 3_000, 5_000, 10_000],
        chunkSize: 6 * 1024 * 1024,
        metadata: {
          bucketName: bucket,
          objectName: path,
          contentType,
          cacheControl: '3600',
        },
        onError: (uploadError) => reject(wrapError('Resumable upload failed', uploadError)),
        onProgress: (uploaded, total) => onProgress?.(total > 0 ? uploaded / total : 0),
        onSuccess: () => resolve(),
      });
      upload.start();
    });
  }

  return {
    async upload(blob): Promise<UploadedPhoto> {
      const path = await buildPath(blob);
      await uploadToPath(blob, path);

      const { data: signed, error: signError } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, DEFAULT_TTL_SEC);
      if (signError || !signed) {
        // Best-effort: if signing fails after a successful upload, drop the orphan
        // before bubbling the error so the caller doesn't see "uploaded but no URL".
        await supabase.storage
          .from(bucket)
          .remove([path])
          .catch(() => {
            /* swallow — original error is more useful */
          });
        throw new Error(`Photo URL signing failed: ${signError?.message ?? 'no data returned'}`, {
          cause: signError,
        });
      }

      return { path, signedUrl: signed.signedUrl };
    },

    uploadToPath,

    async getSignedUrl(path, ttlSec = DEFAULT_TTL_SEC) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttlSec);
      if (error || !data) {
        throw new Error(`Signed URL refresh failed: ${error?.message ?? 'no data returned'}`, {
          cause: error,
        });
      }
      return data.signedUrl;
    },

    async remove(path) {
      const { error } = await supabase.storage.from(bucket).remove([path]);
      if (error) throw wrapError('Photo delete failed', error);
    },
  };
}

export const supabasePhotoStorage = createSupabasePhotoStorage({ bucket: 'receipts' });

/**
 * Packaging photos live in their own private bucket: N per packaged product,
 * removed with it, and the source PDF a user fed to an external AI is archived
 * next to them. Paths are caller-built as `{email}/{packaged_product_id}/{ulid}.{ext}`.
 */
export const supabasePackagingPhotoStorage = createSupabasePhotoStorage({ bucket: 'packaging' });

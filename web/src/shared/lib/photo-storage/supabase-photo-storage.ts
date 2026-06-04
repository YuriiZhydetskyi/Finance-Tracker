import { ulid } from '@finance-tracker/domain';
import { supabase } from '../supabase-client';
import { authService } from '../auth';
import { wrapError } from '@/shared/utils/wrap-error';
import type { IPhotoStorage, UploadedPhoto } from './photo-storage.types';

const BUCKET = 'receipts';
const DEFAULT_TTL_SEC = 3600;

function extensionFor(contentType: string | null | undefined): string {
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

async function buildPath(blob: Blob): Promise<string> {
  const user = await authService.getCurrentUser();
  if (!user) throw new Error('Cannot upload photo: no authenticated user.');
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const ext = extensionFor(blob.type);
  return `${user.email}/${yyyy}/${mm}/${ulid()}.${ext}`;
}

export const supabasePhotoStorage: IPhotoStorage = {
  async upload(blob): Promise<UploadedPhoto> {
    const path = await buildPath(blob);
    const contentType = blob.type || 'image/jpeg';

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType, upsert: false });
    if (uploadError) throw wrapError('Photo upload failed', uploadError);

    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, DEFAULT_TTL_SEC);
    if (signError || !signed) {
      // Best-effort: if signing fails after a successful upload, drop the orphan
      // before bubbling the error so the caller doesn't see "uploaded but no URL".
      await supabase.storage
        .from(BUCKET)
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

  async getSignedUrl(path, ttlSec = DEFAULT_TTL_SEC) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttlSec);
    if (error || !data) {
      throw new Error(`Signed URL refresh failed: ${error?.message ?? 'no data returned'}`, {
        cause: error,
      });
    }
    return data.signedUrl;
  },

  async remove(path) {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) throw wrapError('Photo delete failed', error);
  },
};

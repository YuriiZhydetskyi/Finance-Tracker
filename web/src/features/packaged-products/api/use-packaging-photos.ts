import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  makePackagedProductPhoto,
  PACKAGED_PRODUCT_PHOTO_KINDS,
  ulid,
  type PackagedProductPhotoKind,
} from '@finance-tracker/domain';
import { extensionFor, packagingPhotoStorage } from '@/shared/lib/dependencies';
import { authService } from '@/shared/lib/auth';
import { wrapError } from '@/shared/utils/wrap-error';
import { supabase } from '@/shared/lib/supabase-client';
import {
  packagedProductPhotosQueryKey,
  packagedProductsQueryKey,
} from './packaged-products-query-keys';
import type { PackagedProductPhotoRow } from '../types';

// prettier-ignore
const PHOTO_COLUMNS = 'id, packaged_product_id, storage_path, kind, content_type, byte_size, sort_order, note, created_at';

// `kind` is text + CHECK in Postgres, so the generated type widens it to `string`.
function toPhotoKind(value: string): PackagedProductPhotoKind {
  return (PACKAGED_PRODUCT_PHOTO_KINDS as readonly string[]).includes(value)
    ? (value as PackagedProductPhotoKind)
    : 'other';
}

function narrowPhoto<T extends { kind: string }>(
  row: T,
): Omit<T, 'kind'> & { kind: PackagedProductPhotoKind } {
  return { ...row, kind: toPhotoKind(row.kind) };
}

export function usePackagedProductPhotos(id: string) {
  return useQuery<PackagedProductPhotoRow[]>({
    queryKey: packagedProductPhotosQueryKey(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packaged_product_photos')
        .select(PHOTO_COLUMNS)
        .eq('packaged_product_id', id)
        .order('sort_order')
        .order('created_at');
      if (error) throw error;
      return data.map(narrowPhoto);
    },
  });
}

export type PackagingPhotoUpload = {
  blob: Blob;
  kind: PackagedProductPhotoKind;
  note?: string | null;
};

export type UploadPackagingPhotosVars = {
  packagedProductId: string;
  photos: PackagingPhotoUpload[];
  /** Highest existing sort_order, so a second batch lands after the first. */
  startSortOrder?: number;
  onProgress?: (uploadedCount: number, total: number) => void;
};

/**
 * Uploads blobs first, then records the rows — same ordering and best-effort
 * cleanup as useSavePhotoReceiptMutation: a row pointing at a missing object is
 * visible to the user, an orphan object is not.
 */
export function useUploadPackagingPhotosMutation() {
  const queryClient = useQueryClient();

  return useMutation<PackagedProductPhotoRow[], Error, UploadPackagingPhotosVars>({
    mutationFn: async ({ packagedProductId, photos, startSortOrder = 0, onProgress }) => {
      if (photos.length === 0) return [];

      const user = await authService.getCurrentUser();
      if (!user) throw new Error('Не вдалося завантажити фото: немає активного користувача.');

      const uploadedPaths: string[] = [];
      try {
        const rows = [];
        for (const [index, photo] of photos.entries()) {
          const path = `${user.email}/${packagedProductId}/${ulid()}.${extensionFor(photo.blob.type)}`;
          await packagingPhotoStorage.uploadToPath(photo.blob, path);
          uploadedPaths.push(path);
          rows.push(
            makePackagedProductPhoto({
              packaged_product_id: packagedProductId,
              storage_path: path,
              kind: photo.kind,
              content_type: photo.blob.type || null,
              byte_size: photo.blob.size,
              sort_order: startSortOrder + index,
              note: photo.note ?? null,
            }),
          );
          onProgress?.(index + 1, photos.length);
        }

        const { data, error } = await supabase
          .from('packaged_product_photos')
          .insert(rows)
          .select(PHOTO_COLUMNS);
        if (error) throw wrapError('Не вдалося зберегти фото упаковки', error);
        return data.map(narrowPhoto);
      } catch (e) {
        await Promise.all(
          uploadedPaths.map((path) =>
            packagingPhotoStorage.remove(path).catch(() => {
              /* swallow — the original error is the useful one */
            }),
          ),
        );
        throw e;
      }
    },
    onSuccess: (_rows, { packagedProductId }) => {
      void queryClient.invalidateQueries({
        queryKey: packagedProductPhotosQueryKey(packagedProductId),
      });
      void queryClient.invalidateQueries({ queryKey: packagedProductsQueryKey });
    },
  });
}

export function useDeletePackagingPhotoMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { id: string; packagedProductId: string; storagePath: string }>({
    mutationFn: async ({ id, storagePath }) => {
      const { error } = await supabase.from('packaged_product_photos').delete().eq('id', id);
      if (error) throw wrapError('Не вдалося видалити фото', error);
      await packagingPhotoStorage.remove(storagePath).catch(() => {
        /* best-effort: the row is gone, a leftover blob is swept separately */
      });
    },
    onSuccess: (_void, { packagedProductId }) => {
      void queryClient.invalidateQueries({
        queryKey: packagedProductPhotosQueryKey(packagedProductId),
      });
      void queryClient.invalidateQueries({ queryKey: packagedProductsQueryKey });
    },
  });
}

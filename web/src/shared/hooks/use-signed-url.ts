import { queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import type { IPhotoStorage } from '@/shared/lib/dependencies';

/**
 * Turns a stored Storage path into a currently-valid signed URL, falling back to
 * a URL that was snapshotted on the row (receipts store both).
 *
 * `staleTime` is deliberately half the adapter's 1 h signing TTL: raising it
 * would let a tab left open serve a URL that has already expired, and the image
 * would 403 with no visible cause.
 */
const SIGNED_URL_STALE_MS = 30 * 60_000;

export const signedUrlQueryKey = (path: string | null, url: string | null) =>
  ['signed-url', path, url] as const;

export function signedUrlQueryOptions(
  storage: IPhotoStorage,
  path: string | null,
  url: string | null,
) {
  return queryOptions({
    queryKey: signedUrlQueryKey(path, url),
    queryFn:
      path || url ? () => (path ? storage.getSignedUrl(path) : Promise.resolve(url)) : skipToken,
    staleTime: SIGNED_URL_STALE_MS,
  });
}

export function useSignedUrl(
  storage: IPhotoStorage,
  path: string | null,
  url: string | null,
  enabled: boolean,
) {
  return useQuery({ ...signedUrlQueryOptions(storage, path, url), enabled });
}

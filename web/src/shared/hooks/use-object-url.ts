import { useCallback, useSyncExternalStore } from 'react';

type Entry = { url: string; subscribers: number };

const entries = new Map<Blob, Entry>();

function acquire(blob: Blob): void {
  const entry = entries.get(blob);
  if (entry) {
    entry.subscribers += 1;
  } else {
    entries.set(blob, { url: URL.createObjectURL(blob), subscribers: 1 });
  }
}

function release(blob: Blob): void {
  const entry = entries.get(blob);
  if (!entry) return;
  entry.subscribers -= 1;
  if (entry.subscribers === 0) {
    URL.revokeObjectURL(entry.url);
    entries.delete(blob);
  }
}

/**
 * Object URL for a Blob/File, tied to the component's lifetime: created once the component has
 * mounted and revoked when the blob changes or the component unmounts. Renders stay pure (nothing
 * is created while rendering, so StrictMode's double invoke cannot leak), and components showing
 * the same blob share one URL. Returns `null` while `blob` is nullish and for the render before
 * the URL exists.
 *
 * Modelled as an external store because creating and syncing a resource into state from an effect
 * is what `react-hooks/set-state-in-effect` rejects.
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!blob) return () => undefined;
      acquire(blob);
      onChange();
      return () => {
        release(blob);
      };
    },
    [blob],
  );
  const getSnapshot = useCallback(() => (blob ? (entries.get(blob)?.url ?? null) : null), [blob]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

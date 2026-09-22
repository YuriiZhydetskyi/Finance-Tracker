import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDebounce } from './use-debounce';

/**
 * Local text draft mirrored to a URL search param after `delayMs` of stillness.
 * External URL changes (clear-all, back/forward, manual edit) replace the draft
 * without committing; our own commits are not echoed back into the draft.
 */
export function useDebouncedUrlDraft(opts: {
  /** Current value from the URL (search param). */
  value: string | undefined;
  delayMs?: number;
  /** Called with the debounced draft (empty string → undefined). */
  onCommit: (next: string | undefined) => void;
}): [draft: string, setDraft: (next: string) => void] {
  const { value, delayMs = 300, onCommit } = opts;
  const [draft, setDraft] = useState(value ?? '');
  const debounced = useDebounce(draft, delayMs);
  const ownPushRef = useRef<string | undefined>(value);
  // Callers pass a fresh onCommit (closing over the current search object)
  // every render; reading it through refs keeps the commit effect keyed on
  // the debounced draft alone, so re-renders don't defeat the debounce.
  const valueRef = useRef(value);
  const onCommitRef = useRef(onCommit);

  useLayoutEffect(() => {
    valueRef.current = value;
    onCommitRef.current = onCommit;
  });

  useEffect(() => {
    if (ownPushRef.current === value) return;
    ownPushRef.current = value;
    setDraft(value ?? '');
  }, [value]);

  useEffect(() => {
    const normalized = debounced || undefined;
    if (normalized === valueRef.current) return;
    ownPushRef.current = normalized;
    onCommitRef.current(normalized);
  }, [debounced]);

  return [draft, setDraft];
}

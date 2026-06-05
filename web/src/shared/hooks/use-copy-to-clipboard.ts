import { useEffect, useState } from 'react';

export type CopyState = 'idle' | 'copied' | 'failed';

const RESET_MS = 2000;

/**
 * Copy `text` to the clipboard and expose a transient status that auto-resets to
 * 'idle' after a couple seconds — drives a copy-button label. Shared by the
 * JSON-import dialogs.
 */
export function useCopyToClipboard(text: string) {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  useEffect(() => {
    if (copyState === 'idle') return;
    const id = window.setTimeout(() => setCopyState('idle'), RESET_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [copyState]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const reset = () => setCopyState('idle');

  return { copyState, copy, reset };
}

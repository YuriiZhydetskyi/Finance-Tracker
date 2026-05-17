import { useEffect, useState } from 'react';

/**
 * Returns the input value after `delayMs` of stillness. Re-renders on every
 * input change (cheap), but the returned value only advances once the input
 * stops moving — debouncing whatever depends on it (e.g. a network query).
 */
export function useDebounce<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

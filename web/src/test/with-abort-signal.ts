/**
 * Gives a mocked PostgREST result the `abortSignal` step real query builders
 * have, so hooks that pass the TanStack Query `signal` can be tested with a
 * plain promise at the end of the mocked chain. `onSignal` records the signal.
 */
export function withAbortSignal<T>(result: Promise<T>, onSignal?: (signal: AbortSignal) => void) {
  return Object.assign(result, {
    abortSignal: (signal: AbortSignal) => {
      onSignal?.(signal);
      return result;
    },
  });
}

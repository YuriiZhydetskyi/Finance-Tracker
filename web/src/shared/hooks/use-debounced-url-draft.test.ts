import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedUrlDraft } from './use-debounced-url-draft';

type Props = { value: string | undefined; onCommit: (next: string | undefined) => void };

function setup(initial: string | undefined) {
  const onCommit = vi.fn<(next: string | undefined) => void>();
  const hook = renderHook(
    ({ value, onCommit: commit }: Props) =>
      useDebouncedUrlDraft({ value, delayMs: 300, onCommit: commit }),
    { initialProps: { value: initial, onCommit } },
  );
  return { ...hook, onCommit };
}

describe('useDebouncedUrlDraft', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('commits the draft once after the delay', () => {
    const { result, onCommit } = setup(undefined);

    act(() => result.current[1]('lid'));
    act(() => result.current[1]('lidl'));
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('lidl');
    expect(result.current[0]).toBe('lidl');
  });

  it('syncs the draft from an external value change without committing', () => {
    const { result, rerender, onCommit } = setup('lidl');

    rerender({ value: undefined, onCommit });
    expect(result.current[0]).toBe('');

    rerender({ value: 'aldi', onCommit });
    expect(result.current[0]).toBe('aldi');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits undefined for an empty draft', () => {
    const { result, onCommit } = setup('lidl');

    act(() => result.current[1](''));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(undefined);
  });

  it('skips the commit when the debounced draft equals the current value', () => {
    const { result, onCommit } = setup('lidl');

    act(() => result.current[1]('lidl2'));
    act(() => result.current[1]('lidl'));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not echo its own commit back into the draft', () => {
    const { result, rerender, onCommit } = setup(undefined);

    act(() => result.current[1]('lidl'));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onCommit).toHaveBeenCalledWith('lidl');

    act(() => result.current[1]('lidl a'));
    rerender({ value: 'lidl', onCommit });
    expect(result.current[0]).toBe('lidl a');
  });

  it('uses the latest onCommit callback', () => {
    const { result, rerender, onCommit } = setup(undefined);
    const latest = vi.fn<(next: string | undefined) => void>();

    act(() => result.current[1]('aldi'));
    rerender({ value: undefined, onCommit: latest });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith('aldi');
  });
});

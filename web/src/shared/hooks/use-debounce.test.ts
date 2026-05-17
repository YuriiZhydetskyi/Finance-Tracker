import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce } from './use-debounce';

describe('useDebounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the initial value synchronously', () => {
    const { result } = renderHook(() => useDebounce('hello', 300));
    expect(result.current).toBe('hello');
  });

  it('does not update before the delay elapses', () => {
    const { result, rerender } = renderHook(({ v }: { v: string }) => useDebounce(v, 300), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'b' });
    void act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('a');
  });

  it('updates after the delay elapses', () => {
    const { result, rerender } = renderHook(({ v }: { v: string }) => useDebounce(v, 300), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'b' });
    void act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('b');
  });

  it('only emits the final value when input oscillates within the window', () => {
    const { result, rerender } = renderHook(({ v }: { v: string }) => useDebounce(v, 300), {
      initialProps: { v: 'a' },
    });
    rerender({ v: 'b' });
    void act(() => vi.advanceTimersByTime(100));
    rerender({ v: 'c' });
    void act(() => vi.advanceTimersByTime(100));
    rerender({ v: 'd' });
    void act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe('d');
  });

  it('honors a custom delay', () => {
    const { result, rerender } = renderHook(({ v }: { v: number }) => useDebounce(v, 50), {
      initialProps: { v: 1 },
    });
    rerender({ v: 2 });
    void act(() => vi.advanceTimersByTime(60));
    expect(result.current).toBe(2);
  });
});

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelectionOverrides } from './use-selection-overrides';

describe('useSelectionOverrides', () => {
  it('falls back to the per-item default until the user touches it', () => {
    const { result } = renderHook(() => useSelectionOverrides<string>());
    expect(result.current.isSelected('a', true)).toBe(true);
    expect(result.current.isSelected('a', false)).toBe(false);
  });

  it('toggle flips from the default and sticks', () => {
    const { result } = renderHook(() => useSelectionOverrides<string>());
    act(() => result.current.toggle('a', true));
    expect(result.current.isSelected('a', true)).toBe(false);
    act(() => result.current.toggle('a', true));
    expect(result.current.isSelected('a', true)).toBe(true);
  });

  it('an explicit choice survives a default change (late data)', () => {
    const { result } = renderHook(() => useSelectionOverrides<string>());
    act(() => result.current.toggle('a', false)); // user checks an unchecked-by-default row
    // The row's default later flips to true (e.g. alias learned) — choice stays explicit.
    expect(result.current.isSelected('a', true)).toBe(true);
    act(() => result.current.toggle('a', true));
    expect(result.current.isSelected('a', true)).toBe(false);
  });

  it('setAll overrides every given key in both directions', () => {
    const { result } = renderHook(() => useSelectionOverrides<number>());
    act(() => result.current.setAll([1, 2, 3], false));
    expect(result.current.isSelected(1, true)).toBe(false);
    expect(result.current.isSelected(3, true)).toBe(false);
    act(() => result.current.setAll([1, 2], true));
    expect(result.current.isSelected(1, false)).toBe(true);
    expect(result.current.isSelected(3, true)).toBe(false);
  });

  it('untouched keys keep live defaults after setAll on other keys', () => {
    const { result } = renderHook(() => useSelectionOverrides<number>());
    act(() => result.current.setAll([1], false));
    expect(result.current.isSelected(2, true)).toBe(true);
    expect(result.current.isSelected(2, false)).toBe(false);
  });
});

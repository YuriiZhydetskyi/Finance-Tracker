import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useObjectUrl } from './use-object-url';

const createObjectURL = vi.spyOn(URL, 'createObjectURL');
const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');

let counter = 0;

beforeEach(() => {
  counter = 0;
  createObjectURL.mockReset();
  revokeObjectURL.mockReset();
  createObjectURL.mockImplementation(() => `blob:url-${String((counter += 1))}`);
  revokeObjectURL.mockImplementation(() => undefined);
});

function makeBlob(content: string): Blob {
  return new Blob([content], { type: 'image/png' });
}

describe('useObjectUrl', () => {
  it('returns null and creates nothing without a blob', () => {
    const { result } = renderHook(() => useObjectUrl(null));
    expect(result.current).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('creates a URL for the blob after mount and revokes it on unmount', () => {
    const blob = makeBlob('a');
    const { result, unmount } = renderHook(() => useObjectUrl(blob));

    expect(result.current).toBe('blob:url-1');
    expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(blob);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:url-1');
  });

  it('does not re-create the URL on re-render with the same blob', () => {
    const blob = makeBlob('a');
    const { rerender } = renderHook(() => useObjectUrl(blob));

    rerender();
    rerender();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('revokes the previous URL and creates a new one when the blob changes', () => {
    const first = makeBlob('a');
    const second = makeBlob('b');
    const { result, rerender } = renderHook(({ blob }) => useObjectUrl(blob), {
      initialProps: { blob: first },
    });
    expect(result.current).toBe('blob:url-1');

    rerender({ blob: second });

    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:url-1');
    expect(createObjectURL).toHaveBeenLastCalledWith(second);
    expect(result.current).toBe('blob:url-2');
  });

  it('drops and revokes the URL when the blob becomes null', () => {
    const { result, rerender } = renderHook<string | null, { blob: Blob | null }>(
      ({ blob }) => useObjectUrl(blob),
      { initialProps: { blob: makeBlob('a') } },
    );
    expect(result.current).toBe('blob:url-1');

    rerender({ blob: null });

    expect(result.current).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:url-1');
  });

  it('shares one URL between components showing the same blob and revokes after the last one', () => {
    const blob = makeBlob('a');
    const first = renderHook(() => useObjectUrl(blob));
    const second = renderHook(() => useObjectUrl(blob));

    expect(first.result.current).toBe('blob:url-1');
    expect(second.result.current).toBe('blob:url-1');
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    first.unmount();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    second.unmount();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:url-1');
  });

  it('leaks nothing under StrictMode double invocation', () => {
    const blob = makeBlob('a');
    const { result, unmount } = renderHook(() => useObjectUrl(blob), { wrapper: StrictMode });

    const live = createObjectURL.mock.results
      .map((call) => call.value as string)
      .filter((url) => !revokeObjectURL.mock.calls.some(([revoked]) => revoked === url));
    expect(live).toEqual([result.current]);

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledTimes(createObjectURL.mock.calls.length);
  });
});

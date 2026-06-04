import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchPendingBlob } from './fetch-pending-blob';

const getSignedUrlMock = vi.fn<(path: string) => Promise<string>>();

vi.mock('@/shared/lib/dependencies', () => ({
  photoStorage: {
    getSignedUrl: (path: string) => getSignedUrlMock(path),
    upload: vi.fn(),
    remove: vi.fn(),
  },
}));

beforeEach(() => {
  getSignedUrlMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchPendingBlob', () => {
  it('re-signs the path and returns the downloaded blob', async () => {
    const blob = new Blob(['data'], { type: 'image/jpeg' });
    getSignedUrlMock.mockResolvedValue('https://signed/x');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPendingBlob('me@example.com/2026/06/x.jpg');

    expect(getSignedUrlMock).toHaveBeenCalledWith('me@example.com/2026/06/x.jpg');
    expect(fetchMock).toHaveBeenCalledWith('https://signed/x');
    expect(result).toBe(blob);
  });

  it('throws with the HTTP status when the download fails', async () => {
    getSignedUrlMock.mockResolvedValue('https://signed/x');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(fetchPendingBlob('me@example.com/2026/06/x.jpg')).rejects.toThrow(/HTTP 404/);
  });
});

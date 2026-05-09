import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareFile } from './prepare-file';

type HeicToArgs = { blob: Blob; type: string; quality?: number };

const heicToMock = vi.fn<(args: HeicToArgs) => Promise<Blob>>();
const resizeImageMock = vi.fn<(blob: Blob | File) => Promise<Blob>>();

vi.mock('heic-to', () => ({
  heicTo: (args: HeicToArgs) => heicToMock(args),
}));

vi.mock('./resize-image', () => ({
  resizeImage: (blob: Blob | File) => resizeImageMock(blob),
  blobToBase64: vi.fn(),
}));

beforeEach(() => {
  heicToMock.mockReset();
  heicToMock.mockResolvedValue(new Blob(['decoded-jpeg'], { type: 'image/jpeg' }));
  resizeImageMock.mockReset();
  resizeImageMock.mockResolvedValue(new Blob(['resized'], { type: 'image/jpeg' }));
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob://fake');
});

describe('prepareFile', () => {
  it('resizes JPEG and returns image/jpeg with preview URL', async () => {
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    const out = await prepareFile(file);
    expect(resizeImageMock).toHaveBeenCalledTimes(1);
    expect(heicToMock).not.toHaveBeenCalled();
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.previewUrl).toBe('blob://fake');
    expect(out.blob.type).toBe('image/jpeg');
  });

  it('resizes PNG and reports image/jpeg (canvas re-encodes)', async () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const out = await prepareFile(file);
    expect(resizeImageMock).toHaveBeenCalledTimes(1);
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.blob.type).toBe('image/jpeg');
  });

  it('resizes WebP', async () => {
    const file = new File(['x'], 'a.webp', { type: 'image/webp' });
    const out = await prepareFile(file);
    expect(resizeImageMock).toHaveBeenCalledTimes(1);
    expect(out.mimeType).toBe('image/jpeg');
  });

  it('decodes HEIC by mimeType, then resizes', async () => {
    const file = new File(['x'], 'a.heic', { type: 'image/heic' });
    const out = await prepareFile(file);
    expect(heicToMock).toHaveBeenCalledTimes(1);
    const args = heicToMock.mock.calls[0]![0];
    expect(args.type).toBe('image/jpeg');
    expect(typeof args.quality).toBe('number');
    expect(resizeImageMock).toHaveBeenCalledTimes(1);
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.previewUrl).toBe('blob://fake');
  });

  it('decodes HEIC by .heic extension when MIME is empty', async () => {
    const file = new File(['x'], 'photo.HEIC', { type: '' });
    const out = await prepareFile(file);
    expect(heicToMock).toHaveBeenCalledTimes(1);
    expect(out.mimeType).toBe('image/jpeg');
  });

  it('decodes HEIF by mimeType', async () => {
    const file = new File(['x'], 'a.heif', { type: 'image/heif' });
    await prepareFile(file);
    expect(heicToMock).toHaveBeenCalledTimes(1);
  });

  it('passes PDF through unchanged with application/pdf and null preview', async () => {
    const file = new File(['%PDF-1.4'], 'receipt.pdf', { type: 'application/pdf' });
    const out = await prepareFile(file);
    expect(heicToMock).not.toHaveBeenCalled();
    expect(resizeImageMock).not.toHaveBeenCalled();
    expect(out.mimeType).toBe('application/pdf');
    expect(out.previewUrl).toBeNull();
    expect(out.blob.type).toBe('application/pdf');
  });

  it('detects PDF by .pdf extension when MIME is empty', async () => {
    const file = new File(['%PDF-1.4'], 'receipt.PDF', { type: '' });
    const out = await prepareFile(file);
    expect(out.mimeType).toBe('application/pdf');
    expect(out.blob.type).toBe('application/pdf');
  });

  it('rejects PDFs over 20 MB', async () => {
    const big = new File([new Uint8Array(21 * 1024 * 1024)], 'big.pdf', {
      type: 'application/pdf',
    });
    await expect(prepareFile(big)).rejects.toThrow(/завеликий/i);
  });

  it('rejects unsupported file types', async () => {
    const file = new File(['x'], 'note.txt', { type: 'text/plain' });
    await expect(prepareFile(file)).rejects.toThrow(/Непідтримуваний/i);
    expect(heicToMock).not.toHaveBeenCalled();
    expect(resizeImageMock).not.toHaveBeenCalled();
  });

  it('wraps heic-to failures in a user-readable error', async () => {
    heicToMock.mockRejectedValueOnce(new Error('libheif crash'));
    const file = new File(['x'], 'a.heic', { type: 'image/heic' });
    await expect(prepareFile(file)).rejects.toThrow(/HEIC\/HEIF/i);
  });
});

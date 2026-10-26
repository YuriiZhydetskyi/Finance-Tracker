import { describe, expect, it, vi, beforeEach } from 'vitest';
import { supabasePackagingPhotoStorage, supabasePhotoStorage } from './supabase-photo-storage';

type UploadResult = { error: { message: string } | null };
type SignResult = { data: { signedUrl: string } | null; error: { message: string } | null };
type RemoveResult = { error: { message: string } | null };

const uploadMock = vi.fn<(path: string, blob: Blob, opts: unknown) => Promise<UploadResult>>();
const signMock = vi.fn<(path: string, ttl: number) => Promise<SignResult>>();
const removeMock = vi.fn<(paths: string[]) => Promise<RemoveResult>>();
const getCurrentUserMock = vi.fn<() => Promise<{ email: string } | null>>();
const fromMock = vi.fn<(bucket: string) => void>();
const getSessionMock =
  vi.fn<() => Promise<{ data: { session: { access_token: string } | null }; error: null }>>();
const tusStartMock = vi.fn<() => void>();
const tusOptions: Record<string, unknown>[] = [];

vi.mock('../supabase-client', () => ({
  supabase: {
    auth: { getSession: () => getSessionMock() },
    storage: {
      from: (bucket: string) => {
        fromMock(bucket);
        return {
          upload: (path: string, blob: Blob, opts: unknown) => uploadMock(path, blob, opts),
          createSignedUrl: (path: string, ttl: number) => signMock(path, ttl),
          remove: (paths: string[]) => removeMock(paths),
        };
      },
    },
  },
}));

vi.mock('tus-js-client', () => ({
  Upload: class {
    private readonly options: {
      onProgress: (uploaded: number, total: number) => void;
      onSuccess: () => void;
    };
    constructor(_blob: Blob, options: Record<string, unknown>) {
      tusOptions.push(options);
      this.options = options as never;
    }
    start() {
      tusStartMock();
      this.options.onProgress(3, 4);
      this.options.onSuccess();
    }
  },
}));

vi.mock('../auth', () => ({
  authService: {
    getCurrentUser: () => getCurrentUserMock(),
  },
}));

beforeEach(() => {
  uploadMock.mockReset();
  signMock.mockReset();
  removeMock.mockReset();
  getCurrentUserMock.mockReset();
  fromMock.mockReset();
  getSessionMock.mockReset();
  tusStartMock.mockReset();
  tusOptions.length = 0;
  getCurrentUserMock.mockResolvedValue({ email: 'you@example.com' });
});

describe('supabasePhotoStorage.upload', () => {
  it('uploads to {email}/{yyyy}/{mm}/{ulid}.jpg and returns path + signed URL', async () => {
    uploadMock.mockResolvedValue({ error: null });
    signMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/abc' }, error: null });

    const blob = new Blob(['fake'], { type: 'image/jpeg' });
    const out = await supabasePhotoStorage.upload(blob);

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [calledPath, calledBlob, opts] = uploadMock.mock.calls[0]!;
    // Path format: you@example.com/YYYY/MM/<ulid 26 chars>.jpg
    expect(calledPath).toMatch(/^you@example\.com\/\d{4}\/\d{2}\/[0-9A-HJKMNP-TV-Z]{26}\.jpg$/);
    expect(calledBlob).toBe(blob);
    expect(opts).toEqual({ contentType: 'image/jpeg', upsert: false });

    expect(signMock).toHaveBeenCalledWith(calledPath, 3600);
    expect(out.path).toBe(calledPath);
    expect(out.signedUrl).toBe('https://signed.example/abc');
  });

  it('chooses extension from blob type (png stays png)', async () => {
    uploadMock.mockResolvedValue({ error: null });
    signMock.mockResolvedValue({ data: { signedUrl: 'https://x' }, error: null });

    const blob = new Blob(['fake'], { type: 'image/png' });
    await supabasePhotoStorage.upload(blob);

    const [calledPath] = uploadMock.mock.calls[0]!;
    expect(calledPath).toMatch(/\.png$/);
  });

  it('throws when no user is authenticated', async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const blob = new Blob(['fake'], { type: 'image/jpeg' });
    await expect(supabasePhotoStorage.upload(blob)).rejects.toThrow(/no authenticated user/);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('surfaces upload errors and does not attempt to sign', async () => {
    uploadMock.mockResolvedValue({ error: { message: 'permission denied' } });
    const blob = new Blob(['fake'], { type: 'image/jpeg' });
    await expect(supabasePhotoStorage.upload(blob)).rejects.toThrow(/permission denied/);
    expect(signMock).not.toHaveBeenCalled();
  });

  it('cleans up the orphan blob when signing fails after a successful upload', async () => {
    uploadMock.mockResolvedValue({ error: null });
    signMock.mockResolvedValue({ data: null, error: { message: 'sign service down' } });
    removeMock.mockResolvedValue({ error: null });

    const blob = new Blob(['fake'], { type: 'image/jpeg' });
    await expect(supabasePhotoStorage.upload(blob)).rejects.toThrow(/sign service down/);
    expect(removeMock).toHaveBeenCalledTimes(1);
    const [pathsRemoved] = removeMock.mock.calls[0]!;
    expect(pathsRemoved).toHaveLength(1);
  });
});

describe('supabasePhotoStorage resumable upload', () => {
  const OVER_THRESHOLD_BYTES = 6 * 1024 * 1024 + 1;

  it('sends blobs over 6 MB through tus instead of the plain upload', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'jwt' } }, error: null });
    const onProgress = vi.fn<(ratio: number) => void>();

    await supabasePhotoStorage.uploadToPath(
      new Blob([new Uint8Array(OVER_THRESHOLD_BYTES)], { type: 'application/pdf' }),
      'you@example.com/2026/05/A.pdf',
      onProgress,
    );

    expect(uploadMock).not.toHaveBeenCalled();
    expect(tusStartMock).toHaveBeenCalledTimes(1);
    expect(tusOptions[0]).toMatchObject({
      endpoint: expect.stringContaining('/storage/v1/upload/resumable') as unknown,
      headers: expect.objectContaining({ authorization: 'Bearer jwt' }) as unknown,
      metadata: expect.objectContaining({
        bucketName: 'receipts',
        objectName: 'you@example.com/2026/05/A.pdf',
        contentType: 'application/pdf',
      }) as unknown,
    });
    expect(onProgress).toHaveBeenCalledWith(0.75);
  });

  it('refuses a resumable upload without a session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });

    await expect(
      supabasePhotoStorage.uploadToPath(
        new Blob([new Uint8Array(OVER_THRESHOLD_BYTES)], { type: 'application/pdf' }),
        'p.pdf',
      ),
    ).rejects.toThrow(/no session/);
    expect(tusStartMock).not.toHaveBeenCalled();
  });
});

describe('supabasePhotoStorage.getSignedUrl', () => {
  it('re-signs the given path with default TTL', async () => {
    signMock.mockResolvedValue({
      data: { signedUrl: 'https://signed.example/refresh' },
      error: null,
    });
    const url = await supabasePhotoStorage.getSignedUrl('you@example.com/2026/05/A.jpg');
    expect(url).toBe('https://signed.example/refresh');
    expect(signMock).toHaveBeenCalledWith('you@example.com/2026/05/A.jpg', 3600);
  });

  it('honors a custom TTL', async () => {
    signMock.mockResolvedValue({ data: { signedUrl: 'https://x' }, error: null });
    await supabasePhotoStorage.getSignedUrl('p', 60);
    expect(signMock).toHaveBeenCalledWith('p', 60);
  });

  it('throws when signing errors', async () => {
    signMock.mockResolvedValue({ data: null, error: { message: 'nope' } });
    await expect(supabasePhotoStorage.getSignedUrl('p')).rejects.toThrow(/nope/);
  });
});

describe('supabasePhotoStorage.remove', () => {
  it('deletes the given path', async () => {
    removeMock.mockResolvedValue({ error: null });
    await supabasePhotoStorage.remove('you@example.com/2026/05/A.jpg');
    expect(removeMock).toHaveBeenCalledWith(['you@example.com/2026/05/A.jpg']);
  });

  it('throws on delete error', async () => {
    removeMock.mockResolvedValue({ error: { message: 'denied' } });
    await expect(supabasePhotoStorage.remove('p')).rejects.toThrow(/denied/);
  });
});

describe('bucket routing', () => {
  it('addresses the receipts bucket for the receipts singleton', async () => {
    uploadMock.mockResolvedValue({ error: null });
    await supabasePhotoStorage.uploadToPath(new Blob(['x'], { type: 'image/jpeg' }), 'a/b.jpg');
    expect(fromMock).toHaveBeenCalledWith('receipts');
    expect(fromMock).not.toHaveBeenCalledWith('packaging');
  });

  it('addresses the packaging bucket for the packaging singleton', async () => {
    uploadMock.mockResolvedValue({ error: null });
    await supabasePackagingPhotoStorage.uploadToPath(
      new Blob(['x'], { type: 'image/jpeg' }),
      'you@example.com/01JB/01JC.jpg',
    );
    expect(fromMock).toHaveBeenCalledWith('packaging');
    expect(fromMock).not.toHaveBeenCalledWith('receipts');
  });

  it('signs and removes packaging objects from the packaging bucket', async () => {
    signMock.mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null });
    removeMock.mockResolvedValue({ error: null });

    await expect(
      supabasePackagingPhotoStorage.getSignedUrl('you@example.com/01JB/01JC.jpg'),
    ).resolves.toBe('https://signed');
    await supabasePackagingPhotoStorage.remove('you@example.com/01JB/01JC.jpg');

    expect(fromMock.mock.calls.every(([bucket]) => bucket === 'packaging')).toBe(true);
  });
});

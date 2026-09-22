import { describe, expect, it, vi } from 'vitest';
import { createHandler, type ProcessJob } from './handler.ts';
import type { Job, WorkerDeps } from './types.ts';

type RpcResult = { data: unknown; error: unknown };

function makeDeps(claim: RpcResult = { data: [], error: null }) {
  const rpc = vi.fn(
    (name: string, _args?: unknown): Promise<RpcResult> =>
      Promise.resolve(name === 'claim_receipt_import_jobs' ? claim : { data: null, error: null }),
  );
  const deps = {
    db: { rpc } as unknown as WorkerDeps['db'],
    primary: {} as WorkerDeps['primary'],
    fallback: {} as WorkerDeps['fallback'],
    cronToken: 'cron-secret',
    fetch: vi.fn<typeof fetch>(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } satisfies WorkerDeps;
  return { deps, rpc };
}

function request(method: string, token = 'cron-secret'): Request {
  return new Request('https://example.test/process-receipt-imports', {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('process-receipt-imports handler', () => {
  it('rejects non-POST requests with 405', async () => {
    const { deps, rpc } = makeDeps();
    const response = await createHandler(deps)(request('GET'));
    expect(response.status).toBe(405);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a wrong cron token with 401 before touching the database', async () => {
    const { deps, rpc } = makeDeps();
    const processJobImpl = vi.fn<ProcessJob>();
    const response = await createHandler(deps, processJobImpl)(request('POST', 'wrong'));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(processJobImpl).not.toHaveBeenCalled();
  });

  it('expires stale uploads, claims one job and processes every claimed job', async () => {
    const jobs: Job[] = [
      { msg_id: 7, read_count: 1, import_file_id: 'file-a' },
      { msg_id: 8, read_count: 2, import_file_id: 'file-b' },
    ];
    const { deps, rpc } = makeDeps({ data: jobs, error: null });
    const processJobImpl = vi.fn<ProcessJob>((_deps, job) =>
      Promise.resolve({ id: job.import_file_id, status: 'saved' }),
    );

    const response = await createHandler(deps, processJobImpl)(request('POST'));

    expect(response.status).toBe(200);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      'expire_stale_receipt_import_uploads',
      'claim_receipt_import_jobs',
    ]);
    expect(rpc).toHaveBeenNthCalledWith(2, 'claim_receipt_import_jobs', { p_limit: 1 });
    expect(processJobImpl).toHaveBeenCalledTimes(2);
    expect(processJobImpl).toHaveBeenCalledWith(deps, jobs[0]);
    expect(processJobImpl).toHaveBeenCalledWith(deps, jobs[1]);
    await expect(response.json()).resolves.toEqual({
      claimed: 2,
      results: [
        { id: 'file-a', status: 'saved' },
        { id: 'file-b', status: 'saved' },
      ],
    });
  });

  it('returns 500 when the queue claim fails', async () => {
    const { deps } = makeDeps({ data: null, error: { message: 'boom' } });
    const processJobImpl = vi.fn<ProcessJob>();
    const response = await createHandler(deps, processJobImpl)(request('POST'));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Queue claim failed' });
    expect(processJobImpl).not.toHaveBeenCalled();
  });
});

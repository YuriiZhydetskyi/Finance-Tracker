// Pure HTTP handler for the scheduled worker. Runtime-portable: no Deno
// globals here (those live in index.ts and config.ts), only Web Fetch.

import { processJob } from './job-processor.ts';
import type { Job, JobResult, WorkerDeps } from './types.ts';

export type ProcessJob = (deps: WorkerDeps, job: Job) => Promise<JobResult>;

export function createHandler(
  deps: WorkerDeps,
  processJobImpl: ProcessJob = processJob,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (request.headers.get('Authorization') !== `Bearer ${deps.cronToken}`) {
      return json({ error: 'Unauthorized' }, 401);
    }

    await deps.db.rpc('expire_stale_receipt_import_uploads');
    const { data, error } = await deps.db.rpc('claim_receipt_import_jobs', { p_limit: 1 });
    if (error) return json({ error: 'Queue claim failed' }, 500);
    const jobs = (data ?? []) as Job[];
    const results = await Promise.all(jobs.map((job) => processJobImpl(deps, job)));
    return json({ claimed: jobs.length, results });
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

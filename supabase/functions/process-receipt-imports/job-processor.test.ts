import { describe, expect, it, vi } from 'vitest';
import { AiProviderError } from '../_shared/receipt-ai/providers/ai-provider.ts';
import type { AiCallTrace } from '../_shared/receipt-ai/types.ts';
import { auditReceiptEvidence, checkReceiptArithmetic, validateBulkDocument } from './domain.ts';
import { processJob } from './job-processor.ts';
import type { BulkProvider, ChunkedBulkProvider, ImportFile, Job, WorkerDeps } from './types.ts';

type DbResult = { data: unknown; error: unknown };
type TableCall = {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload: unknown;
  filters: unknown[][];
};

/**
 * Chainable stand-in for the supabase-js query builder: every method returns
 * the same promise-backed object, so any chain shape resolves to the canned
 * answer for its table/operation once awaited.
 */
function createFakeDb(options: {
  file: ImportFile;
  rpc?: (name: string, args: Record<string, unknown>) => DbResult;
}) {
  const tableCalls: TableCall[] = [];
  let nextAttemptId = 1;

  function answer(call: TableCall): DbResult {
    if (call.table === 'receipt_import_files') return { data: options.file, error: null };
    if (call.table === 'categories') return { data: [{ name: 'Інше' }], error: null };
    if (call.table === 'receipt_import_attempts') {
      if (call.op === 'insert') return { data: { id: nextAttemptId++ }, error: null };
      return { data: null, error: null };
    }
    return { data: [], error: null };
  }

  function from(table: string) {
    const call: TableCall = { table, op: 'select', payload: null, filters: [] };
    tableCalls.push(call);
    const result = Promise.resolve().then(() => answer(call));
    const builder = Object.assign(result, {
      select: () => builder,
      insert: (payload: unknown) => {
        call.op = 'insert';
        call.payload = payload;
        return builder;
      },
      update: (payload: unknown) => {
        call.op = 'update';
        call.payload = payload;
        return builder;
      },
      eq: (...args: unknown[]) => {
        call.filters.push(['eq', ...args]);
        return builder;
      },
      neq: () => builder,
      in: () => builder,
      not: () => builder,
      order: () => builder,
      limit: () => builder,
      single: () => builder,
      maybeSingle: () => builder,
    });
    return builder;
  }

  const rpc = vi.fn(
    (name: string, args: Record<string, unknown> = {}): Promise<DbResult> =>
      Promise.resolve(options.rpc?.(name, args) ?? { data: null, error: null }),
  );
  const download = vi.fn(() => Promise.resolve({ data: new Blob(['image']), error: null }));
  const createSignedUrl = vi.fn(() =>
    Promise.resolve({ data: { signedUrl: 'https://signed.test/receipt' }, error: null }),
  );
  const db = {
    from,
    rpc,
    storage: { from: () => ({ download, createSignedUrl }) },
  } as unknown as WorkerDeps['db'];

  const attemptUpdates = () =>
    tableCalls
      .filter((call) => call.table === 'receipt_import_attempts' && call.op === 'update')
      .map((call) => ({
        id: call.filters.find((filter) => filter[0] === 'eq' && filter[1] === 'id')?.[2],
        ...(call.payload as Record<string, unknown>),
      }));
  const attemptInserts = () =>
    tableCalls
      .filter((call) => call.table === 'receipt_import_attempts' && call.op === 'insert')
      .map((call) => call.payload as Record<string, unknown>);

  return { db, rpc, download, createSignedUrl, attemptUpdates, attemptInserts };
}

const trace: AiCallTrace = { provider: 'gemini', model: 'gemini-test' };

function makeProviders() {
  const primaryParse = vi.fn<BulkProvider['parseBulkDetailed']>();
  const fallbackParse = vi.fn<ChunkedBulkProvider['parseBulkDetailed']>();
  const fallbackChunk = vi.fn<ChunkedBulkProvider['parseBulkChunkDetailed']>();
  const primary: BulkProvider = { name: 'gemini', parseBulkDetailed: primaryParse };
  const fallback: ChunkedBulkProvider = {
    name: 'anthropic',
    parseBulkDetailed: fallbackParse,
    parseBulkChunkDetailed: fallbackChunk,
  };
  return { primary, fallback, primaryParse, fallbackParse, fallbackChunk };
}

function makeDeps(db: WorkerDeps['db'], providers: ReturnType<typeof makeProviders>) {
  return {
    db,
    primary: providers.primary,
    fallback: providers.fallback,
    cronToken: 'cron-secret',
    fetch: vi.fn<typeof fetch>(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } satisfies WorkerDeps;
}

const validReceipt = {
  document_kind: 'receipt',
  classification_reason: 'Cash receipt',
  store: 'Lidl',
  store_address: null,
  date: '2026-08-01',
  time: '12:30',
  currency: 'EUR',
  total_orig: 3,
  total_raw_text: 'SUMME EUR 3,00',
  article_count: 2,
  article_count_raw_text: '2 Artikel',
  items: [
    {
      product_name: 'Milk',
      qty: 2,
      unit_price_orig: 1.5,
      category_suggestion: null,
      product_code: null,
      source_ordinal: 1,
      raw_text: '2 x 1,50 Milk 3,00',
      row_kind: 'item',
      qty_evidence: 'explicit_multiplier',
      printed_line_total_orig: 3,
    },
  ],
};

const job: Job = { msg_id: 42, read_count: 1, import_file_id: 'file-1' };

describe('processJob', () => {
  it('routes invalid manual JSON to review without calling any provider', async () => {
    const fake = createFakeDb({
      file: {
        id: 'file-1',
        storage_path: null,
        mime_type: 'application/json',
        force_receipt: false,
        manual_json: {},
        parsed_json: null,
      },
    });
    const providers = makeProviders();

    const result = await processJob(makeDeps(fake.db, providers), job);

    expect(result).toEqual({ id: 'file-1', status: 'needs_review' });
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    expect(fake.rpc).toHaveBeenCalledWith(
      'complete_manual_receipt_import_exception',
      expect.objectContaining({ p_file_id: 'file-1', p_msg_id: 42 }),
    );
    expect(providers.primaryParse).not.toHaveBeenCalled();
    expect(providers.fallbackParse).not.toHaveBeenCalled();
    expect(providers.fallbackChunk).not.toHaveBeenCalled();
    expect(fake.download).not.toHaveBeenCalled();
    expect(fake.attemptInserts().map((row) => row.stage)).toEqual(['worker', 'manual_json']);
    expect(fake.attemptUpdates()).toEqual([
      expect.objectContaining({ id: 2, status: 'rejected', diagnosis_code: 'invalid_manual_json' }),
      expect.objectContaining({
        id: 1,
        status: 'succeeded',
        diagnosis_code: 'invalid_manual_json',
      }),
    ]);
  });

  it('finalizes a receipt that passes arithmetic and evidence gates', async () => {
    const fixture = validateBulkDocument(validReceipt);
    expect(checkReceiptArithmetic(fixture)?.matches).toBe(true);
    expect(auditReceiptEvidence(fixture).ok).toBe(true);

    const fake = createFakeDb({
      file: {
        id: 'file-1',
        storage_path: 'user/file-1.jpg',
        mime_type: 'image/jpeg',
        force_receipt: false,
        manual_json: null,
        parsed_json: null,
      },
      rpc: (name, args) =>
        name === 'finalize_receipt_import'
          ? {
              data: {
                status: 'saved',
                receipt_id: (args.p_receipt as { id: string }).id,
              },
              error: null,
            }
          : { data: null, error: null },
    });
    const providers = makeProviders();
    providers.primaryParse.mockResolvedValue({ value: validReceipt as never, trace });

    const result = await processJob(makeDeps(fake.db, providers), job);

    expect(result).toEqual({ id: 'file-1', status: 'saved' });
    expect(providers.primaryParse).toHaveBeenCalledTimes(1);
    expect(providers.primaryParse.mock.calls[0]?.[0]).toBe(btoa('image'));
    expect(providers.fallbackParse).not.toHaveBeenCalled();
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = fake.rpc.mock.calls[0]!;
    expect(name).toBe('finalize_receipt_import');
    expect(args).toMatchObject({ p_file_id: 'file-1', p_msg_id: 42 });
    expect(args.p_items).toHaveLength(validReceipt.items.length);
    expect(args.p_receipt).toMatchObject({
      store: 'Lidl',
      total_orig: 3,
      photo_url: 'https://signed.test/receipt',
    });
    expect(fake.attemptInserts().map((row) => row.stage)).toEqual(['worker', 'primary_parse']);
    expect(fake.attemptUpdates()).toEqual([
      expect.objectContaining({ id: 2, status: 'succeeded', provider: 'gemini' }),
      expect.objectContaining({ id: 1, status: 'succeeded', diagnosis_code: 'saved' }),
    ]);
  });

  it('schedules the next delivery when the primary provider fails on the first read', async () => {
    const fake = createFakeDb({
      file: {
        id: 'file-1',
        storage_path: 'user/file-1.jpg',
        mime_type: 'image/jpeg',
        force_receipt: false,
        manual_json: null,
        parsed_json: null,
      },
    });
    const providers = makeProviders();
    providers.primaryParse.mockRejectedValue(new AiProviderError('timeout', 'slow', trace));

    const result = await processJob(makeDeps(fake.db, providers), job);

    expect(result).toEqual({ id: 'file-1', status: 'queued' });
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    expect(fake.rpc).toHaveBeenCalledWith('schedule_receipt_import_retry', {
      p_file_id: 'file-1',
      p_msg_id: 42,
      p_read_count: 1,
      p_error_message: 'Час очікування відповіді gemini вичерпано.',
      p_delay_seconds: 30,
    });
    expect(fake.attemptUpdates()).toEqual([
      expect.objectContaining({ id: 2, status: 'failed', diagnosis_code: 'timeout' }),
      expect.objectContaining({ id: 1, status: 'failed', diagnosis_code: 'timeout' }),
    ]);
  });
});

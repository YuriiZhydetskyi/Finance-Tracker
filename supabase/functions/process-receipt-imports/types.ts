import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AiCallResult,
  AiCallTrace,
  AiContext,
  BulkParseMode,
  BulkParsedDocument,
  BulkReceiptChunk,
} from '../_shared/receipt-ai/types.ts';

export type Job = { msg_id: number; read_count: number; import_file_id: string };
export type JobResult = { id: string; status: string };
export type ImportFile = {
  id: string;
  storage_path: string | null;
  mime_type: string;
  force_receipt: boolean;
  manual_json: unknown | null;
  parsed_json: unknown | null;
};
export type AttemptStage =
  | 'primary_parse'
  | 'fallback_parse'
  | 'independent_check'
  | 'chunk_parse'
  | 'manual_json'
  | 'worker';
export type AttemptStatus = 'succeeded' | 'accepted' | 'rejected' | 'failed';
export type AttemptHandle = { id: number; startedAt: number };
export type BulkProvider = {
  readonly name: 'gemini' | 'anthropic';
  parseBulkDetailed(
    imageBase64: string,
    ctx: AiContext,
    forceReceipt?: boolean,
    mode?: BulkParseMode,
  ): Promise<AiCallResult<BulkParsedDocument>>;
};
export type ChunkedBulkProvider = BulkProvider & {
  parseBulkChunkDetailed(
    imageBase64: string,
    ctx: AiContext,
    forceReceipt: boolean,
    startOrdinal: number,
    maxItems: number,
  ): Promise<AiCallResult<BulkReceiptChunk>>;
};
export type ProviderInvocation = {
  parsed: BulkParsedDocument;
  trace: AiCallTrace;
  attempt: AttemptHandle | null;
};
export type ChunkInvocation = {
  chunk: BulkReceiptChunk;
  trace: AiCallTrace;
  attempt: AttemptHandle | null;
};
export type StoredVerificationSeed = {
  parsed: BulkParsedDocument;
  provider: 'gemini' | 'anthropic';
};

export type WorkerLog = Pick<Console, 'info' | 'warn' | 'error'>;

export type WorkerDeps = {
  db: SupabaseClient;
  primary: BulkProvider;
  fallback: ChunkedBulkProvider;
  cronToken: string;
  fetch: typeof fetch;
  log: WorkerLog;
};

export class RetryableImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RetryableImportError';
  }
}

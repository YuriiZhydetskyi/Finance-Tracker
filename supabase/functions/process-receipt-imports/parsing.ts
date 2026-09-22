import { AiProviderError } from '../_shared/receipt-ai/providers/ai-provider.ts';
import type {
  AiContext,
  BulkParseMode,
  BulkParsedDocument,
  BulkReceiptChunk,
} from '../_shared/receipt-ai/types.ts';
import {
  type AttemptLog,
  logReconciliation,
  providerResultFields,
  traceFields,
} from './attempts.ts';
import { BULK_ANTHROPIC_MAX_TOKENS, FALLBACK_MODEL } from './constants.ts';
import { auditReceiptEvidence, checkReceiptArithmetic, validateBulkDocument } from './domain.ts';
import {
  LONG_RECEIPT_CHUNK_SIZE,
  MAX_RECEIPT_IMPORT_DELIVERIES,
  mergeBulkReceiptChunks,
  nextChunkStart,
  shouldStartLongReceiptChunks,
  validateBulkReceiptChunk,
} from './long-receipt.ts';
import { providerPublicMessage } from './messages.ts';
import {
  reconcileIndependentReceipt,
  selectParseProviderRole,
  selectSeedStages,
  type ReceiptReconciliation,
} from './receipt-reconciliation.ts';
import {
  RetryableImportError,
  type AttemptStage,
  type BulkProvider,
  type ChunkInvocation,
  type ChunkedBulkProvider,
  type Job,
  type ProviderInvocation,
  type StoredVerificationSeed,
  type WorkerDeps,
} from './types.ts';

/** Everything a provider stage needs to call a model and journal the attempt. */
export type ParseRun = {
  deps: WorkerDeps;
  attempts: AttemptLog;
  job: Job;
  analysisRun: number;
};

export async function parseForDelivery(
  run: ParseRun,
  base64: string,
  ctx: AiContext,
  forceReceipt: boolean,
): Promise<BulkParsedDocument> {
  const role = selectParseProviderRole(run.job.read_count);
  const usePrimary = role === 'primary';
  const result = await invokeProvider(
    run,
    usePrimary ? 'primary_parse' : 'fallback_parse',
    usePrimary ? run.deps.primary : run.deps.fallback,
    base64,
    ctx,
    forceReceipt,
    false,
    usePrimary
      ? { thinking_level: 'high', media_resolution: 'MEDIA_RESOLUTION_HIGH' }
      : anthropicSettings(FALLBACK_MODEL, 'fallback'),
  );
  return result.parsed;
}

export async function shouldUseLongReceiptChunks(
  db: WorkerDeps['db'],
  fileId: string,
  queueMessageId: number,
): Promise<boolean> {
  const { data, error } = await db
    .from('receipt_import_attempts')
    .select('stage, diagnosis_code, stop_reason')
    .eq('file_id', fileId)
    .eq('queue_message_id', queueMessageId)
    .in('stage', ['fallback_parse', 'independent_check', 'chunk_parse'])
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('Attempt query failed');
  return shouldStartLongReceiptChunks(data?.stage, data?.diagnosis_code, data?.stop_reason);
}

export async function parseLongReceipt(
  run: ParseRun,
  base64: string,
  ctx: AiContext,
  forceReceipt: boolean,
): Promise<{ parsed: BulkParsedDocument; message: string }> {
  const { job } = run;
  const storedChunks = await loadStoredReceiptChunks(run.deps.db, job.import_file_id, job.msg_id);
  const startOrdinal = nextChunkStart(storedChunks);
  const invocation = await invokeChunkProvider(run, base64, ctx, forceReceipt, startOrdinal);
  const chunks = [...storedChunks, invocation.chunk];
  const endOrdinal = invocation.chunk.items.at(-1)?.source_ordinal ?? startOrdinal;
  if (invocation.chunk.has_more) {
    if (job.read_count >= MAX_RECEIPT_IMPORT_DELIVERIES) {
      throw new RetryableImportError(
        'long_receipt_chunk_limit',
        `Довгий чек не завершився після ${String(MAX_RECEIPT_IMPORT_DELIVERIES)} фонових доставок; останній підтверджений рядок — ${String(endOrdinal)}. Потрібна ручна перевірка.`,
      );
    }
    throw new RetryableImportError(
      'long_receipt_chunk_in_progress',
      `Довгий чек: підтверджено рядки ${String(startOrdinal)}–${String(endOrdinal)}; наступна фонова доставка продовжить із перекриттям.`,
    );
  }
  const parsed = mergeBulkReceiptChunks(chunks);
  return {
    parsed,
    message: `Довгий чек зібрано з ${String(chunks.length)} частин; підтверджено ${String(parsed.items.length)} фінансових рядків.`,
  };
}

export async function loadStoredReceiptChunks(
  db: WorkerDeps['db'],
  fileId: string,
  queueMessageId: number,
): Promise<BulkReceiptChunk[]> {
  const { data, error } = await db
    .from('receipt_import_attempts')
    .select('settings, result_json')
    .eq('file_id', fileId)
    .eq('queue_message_id', queueMessageId)
    .eq('stage', 'chunk_parse')
    .eq('status', 'succeeded')
    .not('result_json', 'is', null)
    .order('id', { ascending: true });
  if (error) throw new Error('Attempt query failed');
  return (data ?? []).map((attempt) => {
    if (!attempt.settings || typeof attempt.settings !== 'object') {
      throw new Error('AI result stored chunk metadata is invalid');
    }
    const settings = attempt.settings as Record<string, unknown>;
    const requestedStart = Number(settings.chunk_start_ordinal);
    const maxItems = Number(settings.chunk_max_items);
    if (!Number.isInteger(requestedStart) || !Number.isInteger(maxItems)) {
      throw new Error('AI result stored chunk metadata is invalid');
    }
    return validateBulkReceiptChunk(attempt.result_json, requestedStart, maxItems);
  });
}

export async function invokeChunkProvider(
  run: ParseRun,
  base64: string,
  ctx: AiContext,
  forceReceipt: boolean,
  startOrdinal: number,
): Promise<ChunkInvocation> {
  const { attempts, job, analysisRun } = run;
  const fallback = run.deps.fallback;
  const settings = {
    ...anthropicSettings(FALLBACK_MODEL, 'long_receipt_chunk'),
    chunk_start_ordinal: startOrdinal,
    chunk_max_items: LONG_RECEIPT_CHUNK_SIZE,
  };
  const attempt = await attempts.startAttempt(
    job,
    analysisRun,
    'chunk_parse',
    fallback.name,
    settings,
  );
  try {
    const result = await (fallback as ChunkedBulkProvider).parseBulkChunkDetailed(
      base64,
      ctx,
      forceReceipt,
      startOrdinal,
      LONG_RECEIPT_CHUNK_SIZE,
    );
    const chunk = validateBulkReceiptChunk(result.value, startOrdinal, LONG_RECEIPT_CHUNK_SIZE);
    const endOrdinal = chunk.items.at(-1)?.source_ordinal ?? startOrdinal;
    const message = chunk.has_more
      ? `Довгий чек: збережено частину ${String(startOrdinal)}–${String(endOrdinal)}.`
      : `Довгий чек: збережено фінальну частину ${String(startOrdinal)}–${String(endOrdinal)}.`;
    await attempts.finishAttempt(attempt, 'succeeded', {
      ...traceFields(result.trace),
      diagnosis_code: chunk.has_more
        ? 'long_receipt_chunk_in_progress'
        : 'long_receipt_chunk_complete',
      public_message: message,
      details: {
        chunk_start_ordinal: startOrdinal,
        chunk_end_ordinal: endOrdinal,
        chunk_item_count: chunk.items.length,
        has_more: chunk.has_more,
      },
      result_json: chunk,
    });
    return { chunk, trace: result.trace, attempt };
  } catch (error) {
    await attempts.finishAttempt(attempt, 'failed', {
      diagnosis_code: error instanceof AiProviderError ? error.code : 'invalid_result',
      public_message: providerPublicMessage(error),
      ...traceFields(error instanceof AiProviderError ? error.trace : null),
    });
    throw error;
  }
}

export async function independentlyVerify(
  run: ParseRun,
  base64: string,
  ctx: AiContext,
  forceReceipt: boolean,
  parsed: BulkParsedDocument,
  provider: BulkProvider,
  settings: Record<string, unknown>,
): Promise<ReceiptReconciliation> {
  const { deps, job } = run;
  try {
    // This request intentionally receives only the original document and a
    // physical-row audit prompt: no primary rows, totals or mismatch amount.
    const result = await invokeProvider(
      run,
      'independent_check',
      provider,
      base64,
      ctx,
      forceReceipt,
      true,
      settings,
      'verification',
    );
    const reconciliation = reconcileIndependentReceipt(parsed, result.parsed);
    await run.attempts.finishAttempt(result.attempt, reconciliation.status, {
      ...providerResultFields(result.parsed, result.trace),
      diagnosis_code: reconciliation.diagnosisCode,
      public_message: reconciliation.publicMessage,
      details: reconciliation.details,
    });
    logReconciliation(deps.log, job.import_file_id, reconciliation);
    return reconciliation;
  } catch (error) {
    const message = providerPublicMessage(error);
    deps.log.warn('[process-receipt-imports] independent verification failed', {
      file_id: job.import_file_id,
      code: error instanceof AiProviderError ? error.code : 'invalid_result',
    });
    if (error instanceof AiProviderError && job.read_count < 3) {
      throw new RetryableImportError('independent_check_failed', message);
    }
    return {
      status: 'rejected',
      parsed,
      diagnosisCode: 'secondary_evidence_invalid',
      publicMessage: message,
      before: checkReceiptArithmetic(parsed),
      after: null,
      evidence: { ok: false, issues: [] },
      details: { failure_code: error instanceof AiProviderError ? error.code : 'invalid_result' },
    };
  }
}

export async function invokeProvider(
  run: ParseRun,
  stage: Exclude<AttemptStage, 'worker'>,
  provider: BulkProvider,
  base64: string,
  ctx: AiContext,
  forceReceipt: boolean,
  deferOutcome: boolean,
  settings: Record<string, unknown>,
  mode: BulkParseMode = 'standard',
): Promise<ProviderInvocation> {
  const { attempts, job, analysisRun } = run;
  const attempt = await attempts.startAttempt(job, analysisRun, stage, provider.name, settings);
  try {
    const result = await provider.parseBulkDetailed(base64, ctx, forceReceipt, mode);
    const parsed = validateBulkDocument(result.value);
    if (!deferOutcome) {
      await attempts.finishAttempt(
        attempt,
        'succeeded',
        providerResultFields(parsed, result.trace),
      );
    }
    return { parsed, trace: result.trace, attempt };
  } catch (error) {
    await attempts.finishAttempt(attempt, 'failed', {
      diagnosis_code: error instanceof AiProviderError ? error.code : 'invalid_result',
      public_message: providerPublicMessage(error),
      ...traceFields(error instanceof AiProviderError ? error.trace : null),
    });
    throw error;
  }
}

export async function loadStoredVerificationSeed(
  deps: Pick<WorkerDeps, 'db' | 'log'>,
  fileId: string,
  queueMessageId: number,
): Promise<StoredVerificationSeed | null> {
  const { db } = deps;
  try {
    const { data: previousWorker, error: workerError } = await db
      .from('receipt_import_attempts')
      .select('diagnosis_code')
      .eq('file_id', fileId)
      .eq('queue_message_id', queueMessageId)
      .eq('stage', 'worker')
      .neq('status', 'started')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (workerError) throw new Error('Previous worker attempt query failed');
    const stages = selectSeedStages(previousWorker?.diagnosis_code ?? null);
    const { data, error } = await db
      .from('receipt_import_attempts')
      .select('provider, result_json')
      .in('stage', stages)
      .eq('file_id', fileId)
      .eq('queue_message_id', queueMessageId)
      .in('status', ['succeeded', 'rejected'])
      .not('result_json', 'is', null)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.result_json) return null;
    const parsed = validateBulkDocument(data.result_json);
    if (parsed.document_kind !== 'receipt') return null;
    const arithmetic = checkReceiptArithmetic(parsed);
    const evidence = auditReceiptEvidence(parsed);
    if (arithmetic?.matches && evidence.ok) return null;
    return {
      parsed,
      provider: data.provider === 'gemini' ? 'gemini' : 'anthropic',
    };
  } catch {
    deps.log.warn('[process-receipt-imports] stored verification seed unavailable', fileId);
    return null;
  }
}

export function anthropicSettings(model: string, role: string): Record<string, unknown> {
  return {
    model,
    role,
    max_tokens: BULK_ANTHROPIC_MAX_TOKENS,
    thinking: 'disabled',
  };
}

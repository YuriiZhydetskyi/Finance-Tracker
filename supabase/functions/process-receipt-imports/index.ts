import { createClient } from '@supabase/supabase-js';
import { AnthropicProvider } from '../parse-receipt/providers/anthropic-provider.ts';
import { AiProviderError } from '../parse-receipt/providers/ai-provider.ts';
import { GeminiProvider } from '../parse-receipt/providers/gemini-provider.ts';
import type {
  AiCallResult,
  AiCallTrace,
  AiContext,
  BulkParseMode,
  BulkParsedDocument,
  BulkReceiptChunk,
} from '../parse-receipt/types.ts';
import {
  auditReceiptEvidence,
  checkReceiptArticleCount,
  checkReceiptArithmetic,
  prepareReceipt,
  reassociateMisattachedMultiplier,
  validateBulkDocument,
} from './domain.ts';
import {
  LONG_RECEIPT_CHUNK_SIZE,
  MAX_RECEIPT_IMPORT_DELIVERIES,
  isLongReceiptRetryCode,
  mergeBulkReceiptChunks,
  nextChunkStart,
  shouldStartLongReceiptChunks,
  validateBulkReceiptChunk,
} from './long-receipt.ts';
import {
  reconcileIndependentReceipt,
  selectParseProviderRole,
  selectSeedStages,
  selectVerificationKind,
  shouldLoadStoredVerificationSeed,
  shouldQueueIndependentCheck,
  type ReceiptReconciliation,
} from './receipt-reconciliation.ts';

const BUCKET = 'receipts';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// One provider runs per queue delivery, leaving room below the hosted request
// idle limit for Storage and DB I/O even on long receipts.
const BULK_PROVIDER_TIMEOUT_MS = 130_000;
const BULK_ANTHROPIC_MAX_TOKENS = 20_000;
const FALLBACK_MODEL = 'claude-sonnet-5';

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Required env var ${name} is not set`);
  return value;
}

const supabaseUrl = requiredEnv('SUPABASE_URL');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const cronToken = requiredEnv('RECEIPT_IMPORT_CRON_TOKEN');
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const primary = new GeminiProvider({
  apiKey: requiredEnv('GEMINI_API_KEY'),
  timeoutMs: BULK_PROVIDER_TIMEOUT_MS,
});
const fallback = new AnthropicProvider({
  apiKey: requiredEnv('ANTHROPIC_API_KEY'),
  model: FALLBACK_MODEL,
  timeoutMs: BULK_PROVIDER_TIMEOUT_MS,
  bulkMaxTokens: BULK_ANTHROPIC_MAX_TOKENS,
});

type Job = { msg_id: number; read_count: number; import_file_id: string };
type ImportFile = {
  id: string;
  storage_path: string;
  mime_type: string;
  force_receipt: boolean;
};
type AttemptStage =
  | 'primary_parse'
  | 'fallback_parse'
  | 'independent_check'
  | 'chunk_parse'
  | 'worker';
type AttemptStatus = 'succeeded' | 'accepted' | 'rejected' | 'failed';
type AttemptHandle = { id: number; startedAt: number };
type BulkProvider = {
  readonly name: 'gemini' | 'anthropic';
  parseBulkDetailed(
    imageBase64: string,
    ctx: AiContext,
    forceReceipt?: boolean,
    mode?: BulkParseMode,
  ): Promise<AiCallResult<BulkParsedDocument>>;
};
type ChunkedBulkProvider = BulkProvider & {
  parseBulkChunkDetailed(
    imageBase64: string,
    ctx: AiContext,
    forceReceipt: boolean,
    startOrdinal: number,
    maxItems: number,
  ): Promise<AiCallResult<BulkReceiptChunk>>;
};
type ProviderInvocation = {
  parsed: BulkParsedDocument;
  trace: AiCallTrace;
  attempt: AttemptHandle | null;
};
type ChunkInvocation = {
  chunk: BulkReceiptChunk;
  trace: AiCallTrace;
  attempt: AttemptHandle | null;
};
type StoredVerificationSeed = {
  parsed: BulkParsedDocument;
  provider: 'gemini' | 'anthropic';
};

class RetryableImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RetryableImportError';
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (request.headers.get('Authorization') !== `Bearer ${cronToken}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  await db.rpc('expire_stale_receipt_import_uploads');
  const { data, error } = await db.rpc('claim_receipt_import_jobs', { p_limit: 1 });
  if (error) return json({ error: 'Queue claim failed' }, 500);
  const jobs = (data ?? []) as Job[];
  const results = await Promise.all(jobs.map(processJob));
  return json({ claimed: jobs.length, results });
});

async function processJob(job: Job): Promise<{ id: string; status: string }> {
  const analysisRun = await nextAnalysisRun(job.import_file_id);
  const workerAttempt = await startAttempt(job, analysisRun, 'worker', null, {
    queue_read_count: job.read_count,
  });
  let longReceiptMode = false;
  try {
    const { data: file, error: fileError } = await db
      .from('receipt_import_files')
      .select('id, storage_path, mime_type, force_receipt')
      .eq('id', job.import_file_id)
      .single();
    if (fileError || !file?.storage_path) throw new Error('Import file metadata unavailable');
    const importFile = file as ImportFile;

    const [{ data: blob, error: downloadError }, categoriesResult, productsResult] =
      await Promise.all([
        db.storage.from(BUCKET).download(importFile.storage_path),
        db.from('categories').select('name'),
        db.from('products').select('name').limit(50),
      ]);
    if (downloadError || !blob) throw new Error('Stored document download failed');
    if (categoriesResult.error) throw new Error('Category lookup failed');

    const categories = (categoriesResult.data ?? []).map((row) => row.name);
    const ctx: AiContext = {
      categories,
      products: productsResult.error ? [] : (productsResult.data ?? []),
      mimeType: importFile.mime_type,
    };
    const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    longReceiptMode = await shouldUseLongReceiptChunks(importFile.id, job.msg_id);
    const seed =
      !longReceiptMode && shouldLoadStoredVerificationSeed(job.read_count)
        ? await loadStoredVerificationSeed(importFile.id, job.msg_id)
        : null;
    let parsed: BulkParsedDocument;
    const diagnosticMessages: string[] = [];

    if (longReceiptMode) {
      const chunked = await parseLongReceipt(
        job,
        analysisRun,
        base64,
        ctx,
        importFile.force_receipt,
      );
      parsed = chunked.parsed;
      diagnosticMessages.push(chunked.message);
    } else if (seed) {
      const verificationKind = selectVerificationKind(seed.provider);
      const independent = await independentlyVerify(
        job,
        analysisRun,
        base64,
        ctx,
        importFile.force_receipt,
        seed.parsed,
        fallback,
        anthropicSettings(FALLBACK_MODEL, verificationKind),
      );
      parsed = independent.parsed;
      diagnosticMessages.push(independent.publicMessage);
    } else {
      parsed = await parseForDelivery(job, analysisRun, base64, ctx, importFile.force_receipt);
    }

    const multiplierReassociation = reassociateMisattachedMultiplier(parsed);
    parsed = multiplierReassociation.parsed;
    if (multiplierReassociation.applied) {
      diagnosticMessages.push(
        'Multiplier було доказово переприв’язано до сусідньої позиції; усі рядки й підсумок збіглися.',
      );
    }
    const diagnosticMessage = diagnosticMessages.length > 0 ? diagnosticMessages.join(' ') : null;

    if (parsed.document_kind !== 'receipt') {
      const message = parsed.classification_reason || 'Потрібна перевірка документа.';
      await completeException(
        job,
        parsed.document_kind,
        parsed.document_kind === 'not_receipt' ? 'not_receipt' : 'uncertain',
        parsed,
        message,
      );
      await finishAttempt(workerAttempt, 'succeeded', {
        diagnosis_code: parsed.document_kind,
        public_message: message,
      });
      return { id: importFile.id, status: 'needs_review' };
    }

    const firstArithmetic = checkReceiptArithmetic(parsed);
    const firstEvidence = auditReceiptEvidence(parsed);
    if (
      !seed &&
      shouldQueueIndependentCheck(
        selectParseProviderRole(job.read_count),
        job.read_count,
        firstArithmetic?.matches ?? false,
        firstEvidence.ok,
      )
    ) {
      throw new RetryableImportError(
        'independent_check_required',
        selectParseProviderRole(job.read_count) === 'primary'
          ? 'Результат збережено в журналі; наступна доставка виконає незалежну перевірку іншою моделлю.'
          : 'Результат збережено в журналі; наступна доставка виконає окремий аудит усіх фізичних рядків.',
      );
    }

    const finalEvidence = auditReceiptEvidence(parsed);
    if (!finalEvidence.ok) {
      const message = joinReviewMessages(
        finalEvidence.issues[0]?.message ?? 'Не вдалося підтвердити рядки чека.',
        diagnosticMessage,
      );
      await completeException(job, 'receipt', 'validation', parsed, message);
      await finishAttempt(workerAttempt, 'succeeded', {
        diagnosis_code: finalEvidence.issues[0]?.code ?? 'evidence_invalid',
        public_message: message,
        details: {
          evidence_issue_codes: finalEvidence.issues.map((issue) => issue.code),
          multiplier_reassociation: multiplierReassociation.details,
        },
      });
      return { id: importFile.id, status: 'needs_review' };
    }

    const fxRate = await getFxRate(parsed.currency, parsed.date);
    const { data: signed } = await db.storage
      .from(BUCKET)
      .createSignedUrl(importFile.storage_path, 3600);
    const prepared = prepareReceipt(
      parsed,
      fxRate,
      new Set(categories),
      ulid,
      signed?.signedUrl ?? null,
    );
    if (!prepared.ok) {
      const message = joinReviewMessages(prepared.reason, diagnosticMessage);
      await completeException(job, 'receipt', 'validation', parsed, message);
      await finishAttempt(workerAttempt, 'succeeded', {
        diagnosis_code: 'validation',
        public_message: message,
      });
      return { id: importFile.id, status: 'needs_review' };
    }

    const { data: finalResult, error: finalError } = await db.rpc('finalize_receipt_import', {
      p_file_id: importFile.id,
      p_msg_id: job.msg_id,
      p_receipt: prepared.value.receipt,
      p_items: prepared.value.items,
      p_parsed_json: parsed,
    });
    if (finalError) throw new Error('Receipt finalization failed');
    const status =
      finalResult && typeof finalResult === 'object' && 'status' in finalResult
        ? String(finalResult.status)
        : 'saved';
    await finishAttempt(workerAttempt, 'succeeded', {
      diagnosis_code: multiplierReassociation.applied ? 'misattached_multiplier' : status,
      public_message: diagnosticMessage,
      details: multiplierReassociation.details
        ? { multiplier_reassociation: multiplierReassociation.details }
        : null,
    });
    return { id: importFile.id, status };
  } catch (error) {
    const message = publicError(error);
    console.error('[process-receipt-imports] job failed', job.import_file_id, message);
    await finishAttempt(workerAttempt, 'failed', {
      diagnosis_code:
        error instanceof AiProviderError || error instanceof RetryableImportError
          ? error.code
          : 'worker_failure',
      public_message: message,
      ...traceFields(error instanceof AiProviderError ? error.trace : null),
    });
    const shouldStartLongReceiptFallback =
      error instanceof AiProviderError &&
      error.trace.provider === 'anthropic' &&
      (error.trace.stopReason === 'max_tokens' || error.code === 'timeout');
    const usesExtendedDeliveryBudget =
      (error instanceof RetryableImportError && isLongReceiptRetryCode(error.code)) ||
      shouldStartLongReceiptFallback ||
      (longReceiptMode && error instanceof AiProviderError);
    const deliveryLimit = usesExtendedDeliveryBudget ? MAX_RECEIPT_IMPORT_DELIVERIES : 3;
    const canUseAnotherDelivery = job.read_count < deliveryLimit;
    const schedulesNextStage =
      canUseAnotherDelivery &&
      (error instanceof RetryableImportError ||
        (error instanceof AiProviderError && job.read_count === 1) ||
        shouldStartLongReceiptFallback ||
        (longReceiptMode && error instanceof AiProviderError));
    const scheduled = schedulesNextStage
      ? await db.rpc('schedule_receipt_import_retry', {
          p_file_id: job.import_file_id,
          p_msg_id: job.msg_id,
          p_read_count: job.read_count,
          p_error_message: message,
          p_delay_seconds: 30,
        })
      : null;
    if (!scheduled || scheduled.error) {
      await db.rpc('record_receipt_import_failure', {
        p_file_id: job.import_file_id,
        p_msg_id: job.msg_id,
        p_read_count: job.read_count,
        p_error_message: message,
      });
    }
    const remainsQueued = (scheduled && !scheduled.error) || job.read_count < 3;
    return { id: job.import_file_id, status: remainsQueued ? 'queued' : 'needs_review' };
  }
}

async function parseForDelivery(
  job: Job,
  analysisRun: number,
  base64: string,
  ctx: AiContext,
  forceReceipt: boolean,
): Promise<BulkParsedDocument> {
  const role = selectParseProviderRole(job.read_count);
  const usePrimary = role === 'primary';
  const result = await invokeProvider(
    job,
    analysisRun,
    usePrimary ? 'primary_parse' : 'fallback_parse',
    usePrimary ? primary : fallback,
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

async function shouldUseLongReceiptChunks(
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

async function parseLongReceipt(
  job: Job,
  analysisRun: number,
  base64: string,
  ctx: AiContext,
  forceReceipt: boolean,
): Promise<{ parsed: BulkParsedDocument; message: string }> {
  const storedChunks = await loadStoredReceiptChunks(job.import_file_id, job.msg_id);
  const startOrdinal = nextChunkStart(storedChunks);
  const invocation = await invokeChunkProvider(
    job,
    analysisRun,
    base64,
    ctx,
    forceReceipt,
    startOrdinal,
  );
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

async function loadStoredReceiptChunks(
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

async function invokeChunkProvider(
  job: Job,
  analysisRun: number,
  base64: string,
  ctx: AiContext,
  forceReceipt: boolean,
  startOrdinal: number,
): Promise<ChunkInvocation> {
  const settings = {
    ...anthropicSettings(FALLBACK_MODEL, 'long_receipt_chunk'),
    chunk_start_ordinal: startOrdinal,
    chunk_max_items: LONG_RECEIPT_CHUNK_SIZE,
  };
  const attempt = await startAttempt(job, analysisRun, 'chunk_parse', fallback.name, settings);
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
    await finishAttempt(attempt, 'succeeded', {
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
    await finishAttempt(attempt, 'failed', {
      diagnosis_code: error instanceof AiProviderError ? error.code : 'invalid_result',
      public_message: providerPublicMessage(error),
      ...traceFields(error instanceof AiProviderError ? error.trace : null),
    });
    throw error;
  }
}

async function independentlyVerify(
  job: Job,
  analysisRun: number,
  base64: string,
  ctx: AiContext,
  forceReceipt: boolean,
  parsed: BulkParsedDocument,
  provider: BulkProvider,
  settings: Record<string, unknown>,
): Promise<ReceiptReconciliation> {
  try {
    // This request intentionally receives only the original document and a
    // physical-row audit prompt: no primary rows, totals or mismatch amount.
    const result = await invokeProvider(
      job,
      analysisRun,
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
    await finishAttempt(result.attempt, reconciliation.status, {
      ...providerResultFields(result.parsed, result.trace),
      diagnosis_code: reconciliation.diagnosisCode,
      public_message: reconciliation.publicMessage,
      details: reconciliation.details,
    });
    logReconciliation(job.import_file_id, reconciliation);
    return reconciliation;
  } catch (error) {
    const message = providerPublicMessage(error);
    console.warn('[process-receipt-imports] independent verification failed', {
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

async function invokeProvider(
  job: Job,
  analysisRun: number,
  stage: Exclude<AttemptStage, 'worker'>,
  provider: BulkProvider,
  base64: string,
  ctx: AiContext,
  forceReceipt: boolean,
  deferOutcome: boolean,
  settings: Record<string, unknown>,
  mode: BulkParseMode = 'standard',
): Promise<ProviderInvocation> {
  const attempt = await startAttempt(job, analysisRun, stage, provider.name, settings);
  try {
    const result = await provider.parseBulkDetailed(base64, ctx, forceReceipt, mode);
    const parsed = validateBulkDocument(result.value);
    if (!deferOutcome) {
      await finishAttempt(attempt, 'succeeded', providerResultFields(parsed, result.trace));
    }
    return { parsed, trace: result.trace, attempt };
  } catch (error) {
    await finishAttempt(attempt, 'failed', {
      diagnosis_code: error instanceof AiProviderError ? error.code : 'invalid_result',
      public_message: providerPublicMessage(error),
      ...traceFields(error instanceof AiProviderError ? error.trace : null),
    });
    throw error;
  }
}

async function loadStoredVerificationSeed(
  fileId: string,
  queueMessageId: number,
): Promise<StoredVerificationSeed | null> {
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
    console.warn('[process-receipt-imports] stored verification seed unavailable', fileId);
    return null;
  }
}

function anthropicSettings(model: string, role: string): Record<string, unknown> {
  return {
    model,
    role,
    max_tokens: BULK_ANTHROPIC_MAX_TOKENS,
    thinking: 'disabled',
  };
}

function providerResultFields(
  parsed: BulkParsedDocument,
  trace: AiCallTrace,
): Record<string, unknown> {
  const arithmetic = checkReceiptArithmetic(parsed);
  const articleCount = checkReceiptArticleCount(parsed);
  const evidence = parsed.document_kind === 'receipt' ? auditReceiptEvidence(parsed) : null;
  return {
    ...traceFields(trace),
    printed_total: arithmetic?.printedTotal ?? null,
    computed_total: arithmetic?.computedTotal ?? null,
    difference: arithmetic
      ? Math.round((arithmetic.computedTotal - arithmetic.printedTotal) * 100) / 100
      : null,
    diagnosis_code: evidence && !evidence.ok ? evidence.issues[0]?.code : null,
    public_message: evidence && !evidence.ok ? evidence.issues[0]?.message : null,
    details: evidence
      ? {
          evidence_issue_codes: evidence.issues.map((issue) => issue.code),
          printed_article_count: articleCount?.printedCount ?? null,
          computed_article_count: articleCount?.computedCount ?? null,
          article_count_difference: articleCount?.missingCount ?? null,
        }
      : null,
    result_json: parsed,
  };
}

function traceFields(trace: AiCallTrace | null): Record<string, unknown> {
  if (!trace) return {};
  return {
    provider: trace.provider,
    model: trace.model,
    provider_request_id: trace.requestId ?? null,
    stop_reason: trace.stopReason ?? null,
    input_tokens: trace.inputTokens ?? null,
    output_tokens: trace.outputTokens ?? null,
  };
}

async function nextAnalysisRun(fileId: string): Promise<number> {
  try {
    const { data, error } = await db
      .from('receipt_import_attempts')
      .select('analysis_run')
      .eq('file_id', fileId)
      .order('analysis_run', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error('Attempt query failed');
    return (data?.analysis_run ?? 0) + 1;
  } catch {
    console.warn('[process-receipt-imports] attempt history unavailable', fileId);
    return 1;
  }
}

async function startAttempt(
  job: Job,
  analysisRun: number,
  stage: AttemptStage,
  provider: 'gemini' | 'anthropic' | null,
  settings: Record<string, unknown>,
): Promise<AttemptHandle | null> {
  const startedAt = Date.now();
  try {
    const { data, error } = await db
      .from('receipt_import_attempts')
      .insert({
        file_id: job.import_file_id,
        analysis_run: analysisRun,
        delivery_attempt: job.read_count,
        queue_message_id: job.msg_id,
        stage,
        provider,
        status: 'started',
        settings,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error('Attempt insert failed');
    return { id: Number(data.id), startedAt };
  } catch {
    console.warn('[process-receipt-imports] could not start attempt log', {
      file_id: job.import_file_id,
      analysis_run: analysisRun,
      stage,
    });
    return null;
  }
}

async function finishAttempt(
  attempt: AttemptHandle | null,
  status: AttemptStatus,
  fields: Record<string, unknown>,
): Promise<void> {
  if (!attempt) return;
  try {
    const { error } = await db
      .from('receipt_import_attempts')
      .update({
        ...fields,
        status,
        finished_at: new Date().toISOString(),
        duration_ms: Math.max(0, Date.now() - attempt.startedAt),
      })
      .eq('id', attempt.id);
    if (error) throw new Error('Attempt update failed');
  } catch {
    console.warn('[process-receipt-imports] could not finish attempt log', attempt.id);
  }
}

function logReconciliation(fileId: string, result: ReceiptReconciliation): void {
  const details = {
    file_id: fileId,
    status: result.status,
    diagnosis_code: result.diagnosisCode,
    computed_before: result.before?.computedTotal ?? null,
    printed_total: result.before?.printedTotal ?? null,
    computed_after: result.after?.computedTotal ?? null,
  };
  if (result.status === 'accepted') {
    console.info('[process-receipt-imports] independent verification accepted', details);
  } else {
    console.warn('[process-receipt-imports] independent verification rejected', details);
  }
}

async function completeException(
  job: Job,
  documentKind: string,
  exceptionKind: string,
  parsed: BulkParsedDocument,
  message: string,
): Promise<void> {
  const { error } = await db.rpc('complete_receipt_import_exception', {
    p_file_id: job.import_file_id,
    p_msg_id: job.msg_id,
    p_document_kind: documentKind,
    p_exception_kind: exceptionKind,
    p_parsed_json: parsed,
    p_error_message: message.slice(0, 4000),
  });
  if (error) throw new Error('Exception result could not be persisted');
}

async function getFxRate(currency: string, dateIso: string | null): Promise<number> {
  if (currency === 'EUR') return 1;
  if (currency !== 'UAH' || !dateIso) throw new Error('Unsupported currency or date');
  const target = new Date(`${dateIso}T00:00:00Z`);
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(target);
    date.setUTCDate(date.getUTCDate() - offset);
    const compact = date.toISOString().slice(0, 10).replaceAll('-', '');
    const response = await fetch(
      `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=EUR&date=${compact}&json`,
    );
    if (!response.ok) continue;
    const rows = (await response.json()) as { rate?: number }[];
    const rate = rows[0]?.rate;
    if (typeof rate === 'number' && rate > 0) return Math.round((1 / rate) * 1e6) / 1e6;
  }
  throw new Error('NBU rate unavailable');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function ulid(): string {
  let timestamp = Date.now();
  let time = '';
  for (let index = 0; index < 10; index += 1) {
    time = ALPHABET[timestamp % 32] + time;
    timestamp = Math.floor(timestamp / 32);
  }
  let random = '';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (const byte of bytes) random += ALPHABET[byte % 32];
  return time + random;
}

function providerPublicMessage(error: unknown): string {
  if (!(error instanceof AiProviderError)) {
    return 'Незалежна модель повернула невалідний результат.';
  }
  if (error.code === 'incomplete_response') {
    if (error.trace.stopReason === 'max_tokens') {
      return `Відповідь ${error.trace.provider} досягла ліміту max_tokens; частковий структурований результат не прийнято.`;
    }
    return `Відповідь ${error.trace.provider} обірвалася (${error.trace.stopReason ?? 'unknown'}).`;
  }
  if (error.code === 'missing_output' || error.code === 'invalid_json') {
    return `Відповідь ${error.trace.provider} не містить повних структурованих даних.`;
  }
  if (error.code === 'timeout') {
    return `Час очікування відповіді ${error.trace.provider} вичерпано.`;
  }
  return `Provider ${error.trace.provider} не завершив аналіз.`;
}

function joinReviewMessages(primaryMessage: string, diagnostic: string | null): string {
  return diagnostic ? `${primaryMessage} ${diagnostic}`.slice(0, 4000) : primaryMessage;
}

function publicError(error: unknown): string {
  if (error instanceof RetryableImportError) return error.message;
  if (error instanceof AiProviderError) return providerPublicMessage(error);
  const message = error instanceof Error ? error.message : 'Unknown processing failure';
  const safePrefixes = [
    'Import file metadata unavailable',
    'Stored document download failed',
    'Category lookup failed',
    'AI result',
    'Invalid item',
    'Item ',
    'Unsupported currency or date',
    'NBU rate unavailable',
    'Receipt finalization failed',
    'Exception result could not be persisted',
  ];
  if (safePrefixes.some((prefix) => message.startsWith(prefix))) return message.slice(0, 4000);
  return 'AI provider or document processing failed.';
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

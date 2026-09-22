import type { AiCallTrace, BulkParsedDocument } from '../_shared/receipt-ai/types.ts';
import {
  auditReceiptEvidence,
  checkReceiptArticleCount,
  checkReceiptArithmetic,
} from './domain.ts';
import type { ReceiptReconciliation } from './receipt-reconciliation.ts';
import type {
  AttemptHandle,
  AttemptStage,
  AttemptStatus,
  Job,
  WorkerDeps,
  WorkerLog,
} from './types.ts';

export type AttemptLog = {
  nextAnalysisRun(fileId: string): Promise<number>;
  startAttempt(
    job: Job,
    analysisRun: number,
    stage: AttemptStage,
    provider: 'gemini' | 'anthropic' | null,
    settings: Record<string, unknown>,
  ): Promise<AttemptHandle | null>;
  finishAttempt(
    attempt: AttemptHandle | null,
    status: AttemptStatus,
    fields: Record<string, unknown>,
  ): Promise<void>;
};

export function createAttemptLog(db: WorkerDeps['db'], log: WorkerLog): AttemptLog {
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
      log.warn('[process-receipt-imports] attempt history unavailable', fileId);
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
      log.warn('[process-receipt-imports] could not start attempt log', {
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
      log.warn('[process-receipt-imports] could not finish attempt log', attempt.id);
    }
  }

  return { nextAnalysisRun, startAttempt, finishAttempt };
}

export function providerResultFields(
  parsed: BulkParsedDocument,
  trace: AiCallTrace | null,
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

export function traceFields(trace: AiCallTrace | null): Record<string, unknown> {
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

export function logReconciliation(
  log: WorkerLog,
  fileId: string,
  result: ReceiptReconciliation,
): void {
  const details = {
    file_id: fileId,
    status: result.status,
    diagnosis_code: result.diagnosisCode,
    computed_before: result.before?.computedTotal ?? null,
    printed_total: result.before?.printedTotal ?? null,
    computed_after: result.after?.computedTotal ?? null,
  };
  if (result.status === 'accepted') {
    log.info('[process-receipt-imports] independent verification accepted', details);
  } else {
    log.warn('[process-receipt-imports] independent verification rejected', details);
  }
}

import { AiProviderError } from '../_shared/receipt-ai/providers/ai-provider.ts';
import { traceFields } from './attempts.ts';
import type { JobRun } from './job-context.ts';
import { isLongReceiptRetryCode, MAX_RECEIPT_IMPORT_DELIVERIES } from './long-receipt.ts';
import { publicError } from './messages.ts';
import { RetryableImportError, type JobResult } from './types.ts';

/**
 * Journals the failure and decides whether the queue message gets another
 * delivery (next provider stage, long-receipt chunk) or goes to manual review.
 */
export async function handleFailure(run: JobRun, error: unknown): Promise<JobResult> {
  const { deps, job, attempts, longReceiptMode } = run;
  const message = publicError(error);
  deps.log.error('[process-receipt-imports] job failed', job.import_file_id, message);
  if (run.manualAttempt && !run.manualAttemptFinished) {
    await attempts.finishAttempt(run.manualAttempt, 'failed', {
      diagnosis_code: 'manual_json_processing_failed',
      public_message: message,
    });
    run.manualAttemptFinished = true;
  }
  await attempts.finishAttempt(run.workerAttempt, 'failed', {
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
    ? await deps.db.rpc('schedule_receipt_import_retry', {
        p_file_id: job.import_file_id,
        p_msg_id: job.msg_id,
        p_read_count: job.read_count,
        p_error_message: message,
        p_delay_seconds: 30,
      })
    : null;
  if (!scheduled || scheduled.error) {
    await deps.db.rpc('record_receipt_import_failure', {
      p_file_id: job.import_file_id,
      p_msg_id: job.msg_id,
      p_read_count: job.read_count,
      p_error_message: message,
    });
  }
  const remainsQueued = (scheduled && !scheduled.error) || job.read_count < 3;
  return { id: job.import_file_id, status: remainsQueued ? 'queued' : 'needs_review' };
}

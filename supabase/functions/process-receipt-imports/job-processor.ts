import { sanitizeParsedReceiptTaxonomy } from '../_shared/receipt-ai/taxonomy.ts';
import type { BulkParsedDocument } from '../_shared/receipt-ai/types.ts';
import { createAttemptLog, providerResultFields } from './attempts.ts';
import { BUCKET, FALLBACK_MODEL } from './constants.ts';
import {
  auditReceiptEvidence,
  checkReceiptArithmetic,
  type FinalizedReceipt,
  type MultiplierReassociation,
  prepareReceipt,
  reassociateMisattachedMultiplier,
  type ValidationResult,
  validateManualReceiptSubmission,
} from './domain.ts';
import { ulid } from './encoding.ts';
import { completeException, completeManualException } from './exceptions.ts';
import { getFxRate } from './fx.ts';
import { type JobContext, type JobRun, loadJobContext } from './job-context.ts';
import { handleFailure } from './job-failure.ts';
import { joinReviewMessages } from './messages.ts';
import {
  anthropicSettings,
  independentlyVerify,
  loadStoredVerificationSeed,
  parseForDelivery,
  parseLongReceipt,
  shouldUseLongReceiptChunks,
} from './parsing.ts';
import {
  selectParseProviderRole,
  selectVerificationKind,
  shouldLoadStoredVerificationSeed,
  shouldQueueIndependentCheck,
} from './receipt-reconciliation.ts';
import { enrichSavedImportTaxonomy } from './taxonomy-enrichment.ts';
import { type Job, type JobResult, RetryableImportError, type WorkerDeps } from './types.ts';

type ObtainedDocument =
  | { kind: 'parsed'; parsed: BulkParsedDocument; seeded: boolean; diagnosticMessages: string[] }
  | { kind: 'review'; result: JobResult };

type ReviewRejection = {
  message: string;
  diagnosisCode: string;
  details?: Record<string, unknown>;
  persist:
    | { kind: 'manual'; attemptFields: Record<string, unknown> }
    | {
        kind: 'exception';
        documentKind: string;
        exceptionKind: string;
        parsed: BulkParsedDocument;
      };
};

export async function processJob(deps: WorkerDeps, job: Job): Promise<JobResult> {
  const attempts = createAttemptLog(deps.db, deps.log);
  const analysisRun = await attempts.nextAnalysisRun(job.import_file_id);
  const workerAttempt = await attempts.startAttempt(job, analysisRun, 'worker', null, {
    queue_read_count: job.read_count,
  });
  const run: JobRun = {
    deps,
    attempts,
    job,
    analysisRun,
    workerAttempt,
    longReceiptMode: false,
    manualAttempt: null,
    manualAttemptFinished: false,
  };
  try {
    const context = await loadJobContext(run);
    const obtained = await obtainParsedDocument(run, context);
    if (obtained.kind === 'review') return obtained.result;

    const multiplierReassociation = reassociateMisattachedMultiplier(obtained.parsed);
    const parsed = multiplierReassociation.parsed;
    const diagnosticMessages = obtained.diagnosticMessages;
    if (multiplierReassociation.applied) {
      diagnosticMessages.push(
        'Multiplier було доказово переприв’язано до сусідньої позиції; усі рядки й підсумок збіглися.',
      );
    }
    const diagnosticMessage = diagnosticMessages.length > 0 ? diagnosticMessages.join(' ') : null;

    if (parsed.document_kind !== 'receipt') {
      const message = parsed.classification_reason || 'Потрібна перевірка документа.';
      return await rejectForReview(run, context, {
        message,
        diagnosisCode: parsed.document_kind,
        persist: {
          kind: 'exception',
          documentKind: parsed.document_kind,
          exceptionKind: parsed.document_kind === 'not_receipt' ? 'not_receipt' : 'uncertain',
          parsed,
        },
      });
    }

    requireIndependentCheckWhenQueued(run, context, parsed, obtained.seeded);

    const finalEvidence = auditReceiptEvidence(parsed, {
      allowStructuredAmazonOrder: context.structuredPastedOrder,
    });
    if (!finalEvidence.ok) {
      const message = joinReviewMessages(
        finalEvidence.issues[0]?.message ?? 'Не вдалося підтвердити рядки чека.',
        diagnosticMessage,
      );
      const diagnosisCode = finalEvidence.issues[0]?.code ?? 'evidence_invalid';
      const details = {
        evidence_issue_codes: finalEvidence.issues.map((issue) => issue.code),
        multiplier_reassociation: multiplierReassociation.details,
      };
      return await rejectForReview(run, context, {
        message,
        diagnosisCode,
        details,
        persist: validationPersist(context, parsed, {
          diagnosis_code: diagnosisCode,
          public_message: message,
          details,
        }),
      });
    }

    const prepared = await prepareForFinalization(deps, context, parsed);
    if (!prepared.ok) {
      const message = joinReviewMessages(prepared.reason, diagnosticMessage);
      return await rejectForReview(run, context, {
        message,
        diagnosisCode: 'validation',
        persist: validationPersist(context, parsed, {
          diagnosis_code: 'validation',
          public_message: message,
        }),
      });
    }

    return await finalize(
      run,
      context,
      parsed,
      prepared.value,
      diagnosticMessage,
      multiplierReassociation,
    );
  } catch (error) {
    return await handleFailure(run, error);
  }
}

async function obtainParsedDocument(run: JobRun, context: JobContext): Promise<ObtainedDocument> {
  const { deps, job } = run;
  const { importFile, manualSubmission, base64, ctx } = context;
  run.longReceiptMode =
    !manualSubmission && (await shouldUseLongReceiptChunks(deps.db, importFile.id, job.msg_id));
  const seed =
    !manualSubmission && !run.longReceiptMode && shouldLoadStoredVerificationSeed(job.read_count)
      ? await loadStoredVerificationSeed(deps, importFile.id, job.msg_id)
      : null;
  const diagnosticMessages: string[] = [];
  let parsed: BulkParsedDocument;

  if (manualSubmission) {
    run.manualAttempt = await run.attempts.startAttempt(job, run.analysisRun, 'manual_json', null, {
      source: 'user_submission',
    });
    try {
      parsed = validateManualReceiptSubmission(importFile.manual_json, importFile.parsed_json);
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 1000) : 'Ручний JSON невалідний.';
      const result = await rejectForReview(run, context, {
        message,
        diagnosisCode: 'invalid_manual_json',
        persist: {
          kind: 'manual',
          attemptFields: {
            diagnosis_code: 'invalid_manual_json',
            public_message: message,
            result_json: importFile.manual_json,
          },
        },
      });
      return { kind: 'review', result };
    }
  } else if (run.longReceiptMode) {
    const chunked = await parseLongReceipt(run, base64, ctx, importFile.force_receipt);
    parsed = chunked.parsed;
    diagnosticMessages.push(chunked.message);
  } else if (seed) {
    const verificationKind = selectVerificationKind(seed.provider);
    const independent = await independentlyVerify(
      run,
      base64,
      ctx,
      importFile.force_receipt,
      seed.parsed,
      deps.fallback,
      anthropicSettings(FALLBACK_MODEL, verificationKind),
    );
    parsed = independent.parsed;
    diagnosticMessages.push(independent.publicMessage);
  } else {
    parsed = await parseForDelivery(run, base64, ctx, importFile.force_receipt);
  }
  return { kind: 'parsed', parsed, seeded: seed !== null, diagnosticMessages };
}

function requireIndependentCheckWhenQueued(
  run: JobRun,
  context: JobContext,
  parsed: BulkParsedDocument,
  seeded: boolean,
): void {
  const { job } = run;
  const firstArithmetic = checkReceiptArithmetic(parsed);
  const firstEvidence = auditReceiptEvidence(parsed, {
    allowStructuredAmazonOrder: context.structuredPastedOrder,
  });
  if (
    !context.manualSubmission &&
    !seeded &&
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
}

function validationPersist(
  context: JobContext,
  parsed: BulkParsedDocument,
  manualFields: Record<string, unknown>,
): ReviewRejection['persist'] {
  return context.manualSubmission
    ? { kind: 'manual', attemptFields: { ...providerResultFields(parsed, null), ...manualFields } }
    : { kind: 'exception', documentKind: 'receipt', exceptionKind: 'validation', parsed };
}

async function rejectForReview(
  run: JobRun,
  context: JobContext,
  rejection: ReviewRejection,
): Promise<JobResult> {
  const { deps, job, attempts } = run;
  const { persist } = rejection;
  if (persist.kind === 'manual') {
    await completeManualException(deps.db, job, rejection.message);
    await attempts.finishAttempt(run.manualAttempt, 'rejected', persist.attemptFields);
    run.manualAttemptFinished = true;
  } else {
    await completeException(
      deps.db,
      job,
      persist.documentKind,
      persist.exceptionKind,
      persist.parsed,
      rejection.message,
    );
  }
  await attempts.finishAttempt(run.workerAttempt, 'succeeded', {
    diagnosis_code: rejection.diagnosisCode,
    public_message: rejection.message,
    ...(rejection.details ? { details: rejection.details } : {}),
  });
  return { id: context.importFile.id, status: 'needs_review' };
}

async function prepareForFinalization(
  deps: WorkerDeps,
  context: JobContext,
  parsed: BulkParsedDocument,
): Promise<ValidationResult> {
  const { importFile } = context;
  const fxRate = await getFxRate(deps.fetch, parsed.currency, parsed.date);
  const signed = importFile.storage_path
    ? (await deps.db.storage.from(BUCKET).createSignedUrl(importFile.storage_path, 3600)).data
    : null;
  return prepareReceipt(
    sanitizeParsedReceiptTaxonomy(parsed, context.taxonomy),
    fxRate,
    new Set(context.categories),
    ulid,
    signed?.signedUrl ?? null,
  );
}

async function finalize(
  run: JobRun,
  context: JobContext,
  parsed: BulkParsedDocument,
  prepared: FinalizedReceipt,
  diagnosticMessage: string | null,
  multiplierReassociation: MultiplierReassociation,
): Promise<JobResult> {
  const { deps, job, attempts } = run;
  const { importFile } = context;
  const finalizer = importFile.storage_path
    ? 'finalize_receipt_import'
    : 'finalize_pasted_json_import';
  const { data: finalResult, error: finalError } = await deps.db.rpc(finalizer, {
    p_file_id: importFile.id,
    p_msg_id: job.msg_id,
    p_receipt: prepared.receipt,
    p_items: prepared.items,
    p_parsed_json: parsed,
  });
  if (finalError) throw new Error('Receipt finalization failed');
  const status =
    finalResult && typeof finalResult === 'object' && 'status' in finalResult
      ? String(finalResult.status)
      : 'saved';
  const finalizedReceiptId =
    finalResult && typeof finalResult === 'object' && 'receipt_id' in finalResult
      ? (finalResult as { receipt_id?: unknown }).receipt_id
      : null;
  if (status === 'saved' && finalizedReceiptId === prepared.receipt.id) {
    await enrichSavedImportTaxonomy(deps, prepared.receipt, prepared.items);
  }
  if (context.manualSubmission) {
    await attempts.finishAttempt(run.manualAttempt, 'accepted', {
      ...providerResultFields(parsed, null),
      diagnosis_code: status,
      public_message: diagnosticMessage,
    });
    run.manualAttemptFinished = true;
  }
  await attempts.finishAttempt(run.workerAttempt, 'succeeded', {
    diagnosis_code: multiplierReassociation.applied ? 'misattached_multiplier' : status,
    public_message: diagnosticMessage,
    details: multiplierReassociation.details
      ? { multiplier_reassociation: multiplierReassociation.details }
      : null,
  });
  return { id: importFile.id, status };
}

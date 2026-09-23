import type { BulkParsedDocument } from '../_shared/receipt-ai/types.ts';
import type { Job, WorkerDeps } from './types.ts';

export async function completeException(
  db: WorkerDeps['db'],
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

export async function completeManualException(
  db: WorkerDeps['db'],
  job: Job,
  message: string,
): Promise<void> {
  const { error } = await db.rpc('complete_manual_receipt_import_exception', {
    p_file_id: job.import_file_id,
    p_msg_id: job.msg_id,
    p_error_message: message.slice(0, 4000),
  });
  if (error) throw new Error('Manual JSON validation result could not be persisted');
}

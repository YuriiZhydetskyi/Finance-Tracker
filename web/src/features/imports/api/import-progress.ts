export type ImportProgressSummary = {
  total: number;
  completed: number;
  active: number;
  saved: number;
  exceptions: number;
  discarded: number;
};

const ACTIVE_STATUSES = new Set(['uploading', 'queued', 'processing']);
const EXCEPTION_STATUSES = new Set(['needs_review', 'duplicate', 'upload_failed']);

// A file is complete once it no longer needs browser upload or worker attention.
// Exceptions stay part of the completed count so a failed upload cannot leave a
// batch permanently at, for example, 199 of 200.
export function summarizeImportProgress(
  files: readonly { status: string }[],
): ImportProgressSummary {
  let active = 0;
  let saved = 0;
  let exceptions = 0;
  let discarded = 0;

  for (const file of files) {
    if (ACTIVE_STATUSES.has(file.status)) active += 1;
    if (file.status === 'saved') saved += 1;
    if (EXCEPTION_STATUSES.has(file.status)) exceptions += 1;
    if (file.status === 'discarded') discarded += 1;
  }

  return {
    total: files.length,
    completed: files.length - active,
    active,
    saved,
    exceptions,
    discarded,
  };
}

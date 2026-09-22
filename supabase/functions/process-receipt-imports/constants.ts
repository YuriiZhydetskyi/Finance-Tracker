export const BUCKET = 'receipts';
// One provider runs per queue delivery, leaving room below the hosted request
// idle limit for Storage and DB I/O even on long receipts.
export const BULK_PROVIDER_TIMEOUT_MS = 130_000;
export const BULK_ANTHROPIC_MAX_TOKENS = 20_000;
export const FALLBACK_MODEL = 'claude-sonnet-5';

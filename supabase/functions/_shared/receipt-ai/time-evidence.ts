import type { ParsedReceipt, ReceiptTimeSource } from './types.ts';

type TimeCandidate = {
  time: string;
  rawText: string;
  source: ReceiptTimeSource;
};

/**
 * Receipts can print a card-authorization time and a separate fiscal-sale time.
 * Keep the latter canonical whenever both are visible, so duplicate identity is
 * stable across providers and document layouts.
 */
export function canonicalizeReceiptTime<T extends ParsedReceipt>(parsed: T): T {
  const fiscal = readCandidate(parsed.fiscal_time, parsed.fiscal_time_raw_text, 'fiscal_receipt');
  const payment = readCandidate(
    parsed.payment_time,
    parsed.payment_time_raw_text,
    'payment_receipt',
  );
  const hasStructuredCandidates =
    hasOwn(parsed, 'fiscal_time') ||
    hasOwn(parsed, 'fiscal_time_raw_text') ||
    hasOwn(parsed, 'payment_time') ||
    hasOwn(parsed, 'payment_time_raw_text');
  const legacy = hasStructuredCandidates
    ? null
    : readCandidate(
        parsed.time,
        parsed.time_raw_text,
        isReceiptTimeSource(parsed.time_source) ? parsed.time_source : 'other',
        true,
      );
  const selected = fiscal ?? payment ?? legacy;

  return {
    ...parsed,
    time: selected?.time ?? null,
    time_source: selected?.source ?? null,
    time_raw_text: selected?.rawText ?? null,
    fiscal_time: fiscal?.time ?? null,
    fiscal_time_raw_text: fiscal?.rawText ?? null,
    payment_time: payment?.time ?? null,
    payment_time_raw_text: payment?.rawText ?? null,
  };
}

function readCandidate(
  value: unknown,
  rawValue: unknown,
  source: ReceiptTimeSource,
  allowMissingEvidence = false,
): TimeCandidate | null {
  const time = normalizeTime(value);
  if (!time) return null;
  const rawText = typeof rawValue === 'string' ? rawValue.trim().slice(0, 1000) : '';
  if (!rawText && allowMissingEvidence) return { time, rawText: '', source };
  if (!rawText || !timeAppearsInText(time, rawText)) return null;
  return { time, rawText, source };
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/u.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${match[1]}:${match[2]}`;
}

function timeAppearsInText(time: string, rawText: string): boolean {
  const [hours, minutes] = time.split(':');
  return new RegExp(`${hours}\\D{0,3}${minutes}`, 'u').test(rawText);
}

function isReceiptTimeSource(value: unknown): value is ReceiptTimeSource {
  return value === 'fiscal_receipt' || value === 'payment_receipt' || value === 'other';
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

// Turns one raw RFC 822 message into the documents the import worker already
// understands: every PDF attachment as is, or, without one, the readable body
// as a UTF-8 text file headed by the sender, date and subject.

import PostalMime, { type Email, type Header } from 'postal-mime';
import { htmlToText } from './html-text.ts';

export const MAX_RAW_EMAIL_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_EMAIL = 3;
const MAX_BODY_CHARS = 100_000;
// Below this a text/plain alternative is usually a "view this email in a
// browser" stub, and the HTML part carries the actual order.
const MIN_USEFUL_PLAIN_TEXT_CHARS = 200;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export type EmailDocument = {
  filename: string;
  mimeType: 'application/pdf' | 'text/plain';
  bytes: Uint8Array<ArrayBuffer>;
};

/**
 * `pass` only when Gmail's own receiving server recorded DMARC pass, or a DKIM
 * pass whose signing domain aligns with the From domain. Anything else may be
 * a spoofed merchant address that a Gmail filter labelled anyway.
 */
export type SenderAuthentication = 'pass' | 'fail' | 'unknown';

export type ParsedEmail = {
  senderAddress: string | null;
  senderLabel: string | null;
  subject: string | null;
  sentAt: Date | null;
  authentication: SenderAuthentication;
  documents: EmailDocument[];
};

export async function parseEmail(raw: Uint8Array): Promise<ParsedEmail> {
  const email = await PostalMime.parse(raw, {
    attachmentEncoding: 'arraybuffer',
    maxNestingDepth: 32,
  });
  const senderAddress = mailboxAddress(email);
  const sentAt = email.date ? new Date(email.date) : null;
  const validSentAt = sentAt && !Number.isNaN(sentAt.getTime()) ? sentAt : null;
  const senderLabel = senderLine(email);
  const subject = email.subject?.trim() || null;

  const pdfs = email.attachments
    .map((attachment) => ({
      filename: attachment.filename,
      bytes: contentBytes(attachment.content),
    }))
    .filter(({ bytes }) => isPdf(bytes) && bytes.byteLength <= MAX_PDF_BYTES)
    .slice(0, MAX_DOCUMENTS_PER_EMAIL)
    .map(
      ({ filename, bytes }, index): EmailDocument => ({
        filename: safeFilename(filename, `${subject ?? 'email'} ${String(index + 1)}`, 'pdf'),
        mimeType: 'application/pdf',
        bytes,
      }),
    );

  const documents = pdfs.length > 0 ? pdfs : bodyDocument(email, senderLabel, validSentAt, subject);
  return {
    senderAddress,
    senderLabel,
    subject,
    sentAt: validSentAt,
    authentication: senderAuthentication(email.headers, senderAddress),
    documents,
  };
}

function bodyDocument(
  email: Email,
  senderLabel: string | null,
  sentAt: Date | null,
  subject: string | null,
): EmailDocument[] {
  const plain = email.text?.trim() ?? '';
  const body =
    plain.length >= MIN_USEFUL_PLAIN_TEXT_CHARS || !email.html ? plain : htmlToText(email.html);
  if (!body) return [];
  const header = [
    `From: ${senderLabel ?? 'unknown'}`,
    `Date: ${sentAt ? formatBerlinTime(sentAt) + ' (Europe/Berlin)' : 'unknown'}`,
    `Subject: ${subject ?? ''}`,
  ].join('\n');
  const text = `${header}\n\n${body.slice(0, MAX_BODY_CHARS)}`;
  return [
    {
      filename: safeFilename(null, subject ?? 'email', 'txt'),
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode(text),
    },
  ];
}

export function senderAuthentication(
  headers: Header[],
  senderAddress: string | null,
): SenderAuthentication {
  // Gmail prepends its own Authentication-Results; a sender can add fake ones
  // only further down, so the first header from mx.google.com is the verdict.
  const verdict = headers.find(
    (header) =>
      header.key === 'authentication-results' && /^\s*mx\.google\.com\s*;/i.test(header.value),
  )?.value;
  if (!verdict) return 'unknown';
  const dmarc = /\bdmarc=([a-z]+)/i.exec(verdict)?.[1]?.toLowerCase();
  if (dmarc === 'pass') return 'pass';
  if (dmarc === 'fail') return 'fail';

  const fromDomain = senderAddress?.split('@')[1]?.toLowerCase();
  if (!fromDomain) return 'unknown';
  const signingDomains = [
    ...verdict.matchAll(/\bdkim=pass\b[^;]*?\bheader\.(?:i|d)=(?:[^@\s;]*@)?([a-z0-9.-]+)/gi),
  ].map((match) => match[1]?.toLowerCase() ?? '');
  const aligned = signingDomains.some(
    (domain) => domain && (fromDomain === domain || fromDomain.endsWith(`.${domain}`)),
  );
  return aligned ? 'pass' : 'unknown';
}

export function formatBerlinTime(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function mailboxAddress(email: Email): string | null {
  const from = email.from;
  const address = from && 'address' in from ? from.address : undefined;
  return address?.trim().toLowerCase() || null;
}

function senderLine(email: Email): string | null {
  const from = email.from;
  if (!from || !('address' in from) || !from.address) return null;
  return from.name ? `${from.name} <${from.address}>` : from.address;
}

function contentBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array<ArrayBuffer> {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? Uint8Array.from(content) : new Uint8Array(content);
}

function isPdf(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

function safeFilename(filename: string | null, fallback: string, extension: string): string {
  const base = (filename ?? fallback)
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[^\p{L}\p{N} ._-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${base || 'email'}.${extension}`;
}

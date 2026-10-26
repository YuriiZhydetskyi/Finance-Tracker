// HTTP handler for receipt emails pushed by the owner's Apps Script.
// Runtime-portable: no Deno globals here (those live in index.ts and config.ts).
//
// The caller is authenticated by a per-user ingest token whose SHA-256 hash is
// the only copy the database keeps. The token can list which Gmail message ids
// are new and register a message's documents into the import queue; it cannot
// read anything back.

import type { SupabaseClient } from '@supabase/supabase-js';
import { base64ToBytes, sha256Hex } from '../_shared/encoding.ts';
import {
  type EmailDocument,
  MAX_RAW_EMAIL_BYTES,
  parseEmail,
  type ParsedEmail,
} from './email-document.ts';

const BUCKET = 'receipts';
// base64 grows the message by a third; the JSON envelope adds a little more.
const MAX_REQUEST_BYTES = Math.ceil((MAX_RAW_EMAIL_BYTES * 4) / 3) + 64 * 1024;
const MAX_PENDING_IDS = 500;
// Mirrors the limit enforced by register_email_import_message, checked here
// too so that a stolen token cannot keep filling Storage past it.
const MAX_MESSAGES_PER_DAY = 30;
const TOKEN_PATTERN = /^Bearer (fte_[A-Za-z0-9_-]{43})$/;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type IngestDeps = {
  db: SupabaseClient;
  newId: () => string;
  log: Pick<Console, 'info' | 'warn' | 'error'>;
};

export type EmailSource = {
  id: string;
  owner_email: string;
  paid_by: string;
  allowed_sender_domains: string[];
  import_after: string;
  messages_last_day: number;
};

type RegisteredFile = { id: string; status: string };
type Registration = { status: string; batch_id?: string | null; files?: RegisteredFile[] };

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createHandler(
  deps: IngestDeps,
  parse: (raw: Uint8Array) => Promise<ParsedEmail> = parseEmail,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== 'POST') throw new RequestError(405, 'Method not allowed');
      const token = TOKEN_PATTERN.exec(request.headers.get('Authorization') ?? '')?.[1];
      if (!token) throw new RequestError(401, 'Unauthorized');
      const declaredLength = Number(request.headers.get('Content-Length') ?? '0');
      if (declaredLength > MAX_REQUEST_BYTES) throw new RequestError(413, 'Request too large');

      const source = await authenticate(deps, token);
      const body = await readJson(request);
      if (body.op === 'pending') return json(await pending(deps, source, body));
      if (body.op === 'ingest') return json(await ingest(deps, source, body, parse));
      throw new RequestError(400, 'Unknown op');
    } catch (error) {
      if (error instanceof RequestError) return json({ error: error.message }, error.status);
      deps.log.error('ingest-email-receipts failed', error instanceof Error ? error.message : '');
      return json({ error: 'Internal error' }, 500);
    }
  };
}

async function authenticate(deps: IngestDeps, token: string): Promise<EmailSource> {
  const { data, error } = await deps.db.rpc('authenticate_email_import_source', {
    p_token_hash: await sha256Hex(token),
  });
  if (error) throw new Error('Source lookup failed');
  const source = (Array.isArray(data) ? data[0] : null) as EmailSource | null | undefined;
  if (!source) throw new RequestError(401, 'Unauthorized');
  return source;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > MAX_REQUEST_BYTES) throw new RequestError(413, 'Request too large');
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Reported below as a client error.
  }
  throw new RequestError(400, 'Body must be a JSON object');
}

async function pending(
  deps: IngestDeps,
  source: EmailSource,
  body: Record<string, unknown>,
): Promise<{ wanted: string[] }> {
  const ids = body.message_ids;
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_PENDING_IDS ||
    !ids.every((id) => typeof id === 'string' && MESSAGE_ID_PATTERN.test(id))
  ) {
    throw new RequestError(400, `message_ids must be up to ${String(MAX_PENDING_IDS)} Gmail ids`);
  }
  const unique = [...new Set(ids as string[])];
  if (unique.length === 0) return { wanted: [] };
  const { data, error } = await deps.db
    .from('email_import_messages')
    .select('provider_message_id')
    .eq('source_id', source.id)
    .in('provider_message_id', unique);
  if (error) throw new Error('Message lookup failed');
  const known = new Set((data ?? []).map((row) => String(row.provider_message_id)));
  return { wanted: unique.filter((id) => !known.has(id)) };
}

async function ingest(
  deps: IngestDeps,
  source: EmailSource,
  body: Record<string, unknown>,
  parse: (raw: Uint8Array) => Promise<ParsedEmail>,
): Promise<Record<string, unknown>> {
  const messageId = body.message_id;
  if (typeof messageId !== 'string' || !MESSAGE_ID_PATTERN.test(messageId)) {
    throw new RequestError(400, 'message_id must be a Gmail message id');
  }
  if (typeof body.raw !== 'string' || body.raw.length === 0) {
    throw new RequestError(400, 'raw must be the base64url-encoded message');
  }
  const internalDate = typeof body.internal_date === 'number' ? new Date(body.internal_date) : null;
  let raw: Uint8Array;
  try {
    raw = base64ToBytes(body.raw);
  } catch {
    throw new RequestError(400, 'raw is not valid base64');
  }
  if (raw.byteLength > MAX_RAW_EMAIL_BYTES) throw new RequestError(413, 'Message too large');
  if (source.messages_last_day >= MAX_MESSAGES_PER_DAY) {
    throw new RequestError(429, 'Daily limit reached');
  }

  // A message the parser cannot read is recorded as skipped; otherwise the
  // script would resend it every hour.
  const email = await parse(raw).catch(() => null);
  const receivedAt =
    internalDate && !Number.isNaN(internalDate.getTime()) ? internalDate : (email?.sentAt ?? null);
  const reason = email ? skipReason(source, email, receivedAt) : 'unparseable_email';
  const documents = reason || !email ? [] : email.documents;
  const files = await uploadDocuments(deps, source, documents);
  const paths = files.map(({ descriptor }) => descriptor.storage_path);

  let registration: Registration;
  try {
    const { data, error } = await deps.db.rpc('register_email_import_message', {
      p_source_id: source.id,
      p_message: {
        id: deps.newId(),
        provider_message_id: messageId,
        received_at: receivedAt?.toISOString() ?? null,
        sender: email?.senderAddress ?? null,
        subject: email?.subject ?? null,
        reason,
      },
      p_batch_id: deps.newId(),
      p_files: files.map(({ descriptor }) => descriptor),
    });
    if (error?.message?.includes('rate limit')) {
      throw new RequestError(429, 'Daily limit reached');
    }
    if (error) throw new Error('Message registration failed');
    registration = (data ?? { status: 'known' }) as Registration;
  } catch (error) {
    await removeObjects(deps, paths);
    throw error;
  }

  const queued = new Set(
    (registration.files ?? []).filter((file) => file.status === 'queued').map((file) => file.id),
  );
  await removeObjects(
    deps,
    files
      .filter(({ descriptor }) => !queued.has(descriptor.id))
      .map(({ descriptor }) => descriptor.storage_path),
  );
  deps.log.info('email registered', {
    message_id: messageId,
    status: registration.status,
    queued: queued.size,
    reason,
  });
  return {
    status: registration.status === 'known' ? 'known' : reason ? 'skipped' : 'imported',
    reason,
    queued: queued.size,
    duplicates: (registration.files ?? []).length - queued.size,
  };
}

function skipReason(
  source: EmailSource,
  email: ParsedEmail,
  receivedAt: Date | null,
): string | null {
  if (receivedAt && receivedAt.getTime() < new Date(source.import_after).getTime()) {
    return 'before_import_after';
  }
  // A Gmail filter matches the From header by substring, so a stranger's own
  // authenticated domain can land under the label too; both checks are needed.
  if (!senderDomainAllowed(email.senderAddress, source.allowed_sender_domains)) {
    return 'sender_not_allowed';
  }
  if (email.authentication !== 'pass') return `sender_not_authenticated:${email.authentication}`;
  if (email.documents.length === 0) return 'no_receipt_content';
  return null;
}

export function senderDomainAllowed(address: string | null, allowed: string[]): boolean {
  const domain = address?.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  return allowed.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

type UploadedFile = {
  descriptor: {
    id: string;
    original_filename: string;
    mime_type: EmailDocument['mimeType'];
    original_size_bytes: number;
    content_sha256: string;
    storage_path: string;
  };
};

async function uploadDocuments(
  deps: IngestDeps,
  source: EmailSource,
  documents: EmailDocument[],
): Promise<UploadedFile[]> {
  const uploaded: UploadedFile[] = [];
  try {
    for (const document of documents) {
      const id = deps.newId();
      const extension = document.mimeType === 'application/pdf' ? 'pdf' : 'txt';
      const storagePath = `${source.owner_email}/email/${source.id}/${id}.${extension}`;
      const { error } = await deps.db.storage.from(BUCKET).upload(storagePath, document.bytes, {
        contentType: document.mimeType,
        upsert: false,
      });
      if (error) throw new Error('Document upload failed');
      uploaded.push({
        descriptor: {
          id,
          original_filename: document.filename,
          mime_type: document.mimeType,
          original_size_bytes: document.bytes.byteLength,
          content_sha256: await sha256Hex(document.bytes),
          storage_path: storagePath,
        },
      });
    }
  } catch (error) {
    await removeObjects(
      deps,
      uploaded.map(({ descriptor }) => descriptor.storage_path),
    );
    throw error;
  }
  return uploaded;
}

async function removeObjects(deps: IngestDeps, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await deps.db.storage.from(BUCKET).remove(paths);
  if (error) deps.log.warn('orphaned email import objects', { count: paths.length });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

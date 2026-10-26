import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../_shared/encoding.ts';
import type { ParsedEmail } from './email-document.ts';
import {
  createHandler,
  type EmailSource,
  type IngestDeps,
  senderDomainAllowed,
} from './handler.ts';

const TOKEN = 'fte_' + 'A'.repeat(43);
const SOURCE: EmailSource = {
  id: '01SOURCE00000000000000000A',
  owner_email: 'owner@example.com',
  paid_by: 'owner@example.com',
  allowed_sender_domains: ['edeka.de', 'amazon.de'],
  import_after: '2026-10-01T00:00:00.000Z',
  messages_last_day: 0,
};

type Result = { data: unknown; error: { message: string } | null };

function makeDeps(
  options: { source?: EmailSource | null; register?: Result; known?: string[] } = {},
) {
  const rpc = vi.fn((name: string, _args?: unknown): Promise<Result> => {
    if (name === 'authenticate_email_import_source') {
      return Promise.resolve({
        data: options.source === null ? [] : [options.source ?? SOURCE],
        error: null,
      });
    }
    return Promise.resolve(
      options.register ?? {
        data: { status: 'registered', files: [] },
        error: null,
      },
    );
  });
  const select = {
    eq: () => select,
    in: () =>
      Promise.resolve({
        data: (options.known ?? []).map((id) => ({ provider_message_id: id })),
        error: null,
      }),
  };
  const upload = vi.fn(() => Promise.resolve({ data: {}, error: null }));
  const remove = vi.fn(() => Promise.resolve({ data: [], error: null }));
  let counter = 0;
  const deps: IngestDeps = {
    db: {
      rpc,
      from: () => ({ select: () => select }),
      storage: { from: () => ({ upload, remove }) },
    } as unknown as IngestDeps['db'],
    newId: () => `01ID${String((counter += 1)).padStart(22, '0')}`,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return { deps, rpc, upload, remove };
}

function parsed(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    senderAddress: 'noreply@app.edeka.de',
    senderLabel: 'EDEKA <noreply@app.edeka.de>',
    subject: 'Vielen Dank für Ihren Einkauf',
    sentAt: new Date('2026-10-26T13:05:00Z'),
    authentication: 'pass',
    documents: [
      {
        filename: 'eBon.pdf',
        mimeType: 'application/pdf',
        bytes: new TextEncoder().encode('%PDF-1.4'),
      },
    ],
    ...overrides,
  };
}

function post(body: unknown, token = TOKEN): Request {
  return new Request('https://example.test/ingest-email-receipts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ingestBody = {
  op: 'ingest',
  message_id: '19a2b3c4d5e6f708',
  internal_date: Date.parse('2026-10-26T13:05:00Z'),
  raw: btoa('raw message'),
};

describe('ingest-email-receipts handler', () => {
  it('rejects a malformed token before touching the database', async () => {
    const { deps, rpc } = makeDeps();
    const response = await createHandler(deps)(post({ op: 'pending', message_ids: [] }, 'nope'));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('looks the token up by its SHA-256 hash and rejects an unknown or revoked one', async () => {
    const { deps, rpc } = makeDeps({ source: null });
    const response = await createHandler(deps)(post({ op: 'pending', message_ids: [] }));
    expect(response.status).toBe(401);
    expect(rpc).toHaveBeenCalledWith('authenticate_email_import_source', {
      p_token_hash: await sha256Hex(TOKEN),
    });
  });

  it('returns only the message ids this source has not seen yet', async () => {
    const { deps } = makeDeps({ known: ['b'] });
    const response = await createHandler(deps)(
      post({ op: 'pending', message_ids: ['a', 'b', 'a', 'c'] }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ wanted: ['a', 'c'] });
  });

  it('rejects message ids that are not Gmail ids', async () => {
    const { deps } = makeDeps();
    const response = await createHandler(deps)(post({ op: 'pending', message_ids: ['../x'] }));
    expect(response.status).toBe(400);
  });

  it('uploads the documents under the owner prefix, registers them and drops duplicates', async () => {
    const parse = vi.fn(() =>
      Promise.resolve(
        parsed({
          documents: [
            {
              filename: 'a.pdf',
              mimeType: 'application/pdf',
              bytes: new TextEncoder().encode('%PDF-a'),
            },
            {
              filename: 'b.pdf',
              mimeType: 'application/pdf',
              bytes: new TextEncoder().encode('%PDF-b'),
            },
          ],
        }),
      ),
    );
    const { deps, rpc, upload, remove } = makeDeps({
      register: {
        data: {
          status: 'registered',
          files: [
            { id: '01ID0000000000000000000001', status: 'queued' },
            { id: '01ID0000000000000000000002', status: 'duplicate' },
          ],
        },
        error: null,
      },
    });

    const response = await createHandler(deps, parse)(post(ingestBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'imported',
      reason: null,
      queued: 1,
      duplicates: 1,
    });
    expect(upload.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      `owner@example.com/email/${SOURCE.id}/01ID0000000000000000000001.pdf`,
      `owner@example.com/email/${SOURCE.id}/01ID0000000000000000000002.pdf`,
    ]);
    const registerArgs = rpc.mock.calls.find(
      (call) => call[0] === 'register_email_import_message',
    )?.[1];
    expect(registerArgs).toMatchObject({
      p_source_id: SOURCE.id,
      p_message: {
        provider_message_id: '19a2b3c4d5e6f708',
        received_at: '2026-10-26T13:05:00.000Z',
        sender: 'noreply@app.edeka.de',
        reason: null,
      },
    });
    expect(remove).toHaveBeenCalledWith([
      `owner@example.com/email/${SOURCE.id}/01ID0000000000000000000002.pdf`,
    ]);
  });

  it('records an unauthenticated sender as skipped without uploading anything', async () => {
    const { deps, rpc, upload } = makeDeps();
    const parse = () => Promise.resolve(parsed({ authentication: 'unknown' }));

    const response = await createHandler(deps, parse)(post(ingestBody));

    expect(await response.json()).toMatchObject({
      status: 'skipped',
      reason: 'sender_not_authenticated:unknown',
    });
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      'register_email_import_message',
      expect.objectContaining({ p_files: [] }),
    );
  });

  it('skips messages received before the source import_after', async () => {
    const { deps, upload } = makeDeps();
    const response = await createHandler(deps, () => Promise.resolve(parsed()))(
      post({ ...ingestBody, internal_date: Date.parse('2026-09-15T08:00:00Z') }),
    );
    expect(await response.json()).toMatchObject({
      status: 'skipped',
      reason: 'before_import_after',
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('removes uploaded objects and reports 429 when the daily limit is reached', async () => {
    const { deps, remove } = makeDeps({
      register: { data: null, error: { message: 'Email import rate limit exceeded' } },
    });
    const response = await createHandler(deps, () => Promise.resolve(parsed()))(post(ingestBody));
    expect(response.status).toBe(429);
    expect(remove).toHaveBeenCalledWith([
      `owner@example.com/email/${SOURCE.id}/01ID0000000000000000000001.pdf`,
    ]);
  });

  it('skips a sender whose domain the owner has not allowed, even when it is authenticated', async () => {
    const { deps, upload } = makeDeps();
    const parse = () =>
      Promise.resolve(parsed({ senderAddress: 'noreply@app.edeka.de.attacker.example' }));
    const response = await createHandler(deps, parse)(post(ingestBody));
    expect(await response.json()).toMatchObject({
      status: 'skipped',
      reason: 'sender_not_allowed',
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses to upload anything once the daily limit is used up', async () => {
    const { deps, rpc, upload } = makeDeps({ source: { ...SOURCE, messages_last_day: 30 } });
    const response = await createHandler(deps, () => Promise.resolve(parsed()))(post(ingestBody));
    expect(response.status).toBe(429);
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('register_email_import_message', expect.anything());
  });

  it('removes uploaded objects when registration throws', async () => {
    const { deps, rpc, remove } = makeDeps();
    rpc.mockImplementation((name: string) =>
      name === 'authenticate_email_import_source'
        ? Promise.resolve({ data: [SOURCE], error: null })
        : Promise.reject(new Error('network down')),
    );
    const response = await createHandler(deps, () => Promise.resolve(parsed()))(post(ingestBody));
    expect(response.status).toBe(500);
    expect(remove).toHaveBeenCalledWith([
      `owner@example.com/email/${SOURCE.id}/01ID0000000000000000000001.pdf`,
    ]);
  });

  it('records an unreadable message as skipped so the script does not resend it', async () => {
    const { deps, upload } = makeDeps();
    const response = await createHandler(deps, () => Promise.reject(new Error('bad MIME')))(
      post(ingestBody),
    );
    expect(await response.json()).toMatchObject({ status: 'skipped', reason: 'unparseable_email' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('never echoes internal errors to the caller', async () => {
    const { deps } = makeDeps({
      register: { data: null, error: { message: 'relation secret_detail does not exist' } },
    });
    const response = await createHandler(deps, () => Promise.resolve(parsed()))(post(ingestBody));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal error' });
  });
});

describe('senderDomainAllowed', () => {
  it('accepts the domain itself and its subdomains only', () => {
    expect(senderDomainAllowed('noreply@app.edeka.de', ['edeka.de'])).toBe(true);
    expect(senderDomainAllowed('noreply@edeka.de', ['edeka.de'])).toBe(true);
    expect(senderDomainAllowed('noreply@fakeedeka.de', ['edeka.de'])).toBe(false);
    expect(senderDomainAllowed('noreply@edeka.de.attacker.example', ['edeka.de'])).toBe(false);
    expect(senderDomainAllowed(null, ['edeka.de'])).toBe(false);
  });
});

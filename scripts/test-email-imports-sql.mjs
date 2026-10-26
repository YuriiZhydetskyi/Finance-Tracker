import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });

const OWNER = 'a@example.com';
const OTHER = 'b@example.com';
const ULID = (prefix) => prefix.padEnd(26, '0');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function as(email, sql, params = []) {
  await db.query(`select set_config('test.jwt', $1, false)`, [
    email ? JSON.stringify({ email }) : '',
  ]);
  return db.query(sql, params);
}

async function expectFailure(promise, expected) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message), expected);
    return true;
  });
}

function file(id, overrides = {}) {
  return {
    id,
    original_filename: 'eBon.pdf',
    mime_type: 'application/pdf',
    original_size_bytes: 10,
    content_sha256: sha256(id),
    storage_path: `${OWNER}/email/${ULID('SRC1')}/${id}.pdf`,
    ...overrides,
  };
}

async function register(messageId, files, batchId = ULID('BATCH1')) {
  const result = await db.query(
    `select public.register_email_import_message($1, $2::jsonb, $3, $4::jsonb) as result`,
    [
      ULID('SRC1'),
      JSON.stringify({
        id: ULID(`MSG${messageId}`),
        provider_message_id: messageId,
        received_at: '2026-10-26T13:05:00Z',
        sender: 'noreply@app.edeka.de',
        subject: 'Vielen Dank',
        reason: files.length ? null : 'sender_not_allowed',
      }),
      batchId,
      JSON.stringify(files),
    ],
  );
  return result.rows[0].result;
}

try {
  await db.exec(`
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create schema auth;
    create schema storage;
    create schema pgmq;
    create role anon;
    create role authenticated;
    create role service_role;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb
    $$;

    create table public.app_users (email text primary key);
    insert into public.app_users values ('${OWNER}'), ('${OTHER}');
    create function public.is_allowed_user() returns boolean language sql stable as $$
      select exists (select 1 from public.app_users where email = auth.jwt() ->> 'email')
    $$;

    create table public.receipt_import_batches (
      id text primary key,
      uploaded_by text not null,
      paid_by text not null,
      created_at timestamptz not null default now()
    );
    create table public.receipt_import_files (
      id text primary key,
      batch_id text not null references public.receipt_import_batches(id),
      original_filename text not null,
      mime_type text not null constraint receipt_import_files_mime_type_check check (
        mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/json')
      ),
      original_size_bytes bigint not null,
      content_sha256 text not null,
      storage_path text,
      status text not null,
      duplicate_of_file_id text references public.receipt_import_files(id),
      created_at timestamptz not null default now()
    );

    create table storage.objects (bucket_id text not null, name text not null);
    create table pgmq.sent (queue text not null, message jsonb not null);
    create function pgmq.send(p_queue text, p_message jsonb) returns void language sql as $$
      insert into pgmq.sent values (p_queue, p_message)
    $$;
  `);
  await db.exec(
    await readFile(
      new URL('../supabase/migrations/20261026150000_email_receipt_imports.sql', import.meta.url),
      'utf8',
    ),
  );

  // ── Sources: token shown once, only its hash stored, domains normalized ──
  const created = await as(
    OWNER,
    `select public.create_email_import_source($1, $2, now() - interval '1 day', $3) as token`,
    [ULID('SRC1'), OWNER, [' Amazon.DE ', 'edeka.de', 'edeka.de', '']],
  );
  const token = created.rows[0].token;
  assert.match(token, /^fte_[A-Za-z0-9_-]{43}$/);
  const stored = await db.query(
    `select token_hash, token_hint, allowed_sender_domains from public.email_import_sources`,
  );
  assert.deepEqual(stored.rows, [
    {
      token_hash: sha256(token),
      token_hint: token.slice(-4),
      allowed_sender_domains: ['amazon.de', 'edeka.de'],
    },
  ]);

  await expectFailure(
    as(OWNER, `select public.create_email_import_source($1, $2, now(), $3)`, [
      ULID('SRC2'),
      OWNER,
      ['amazon.de/evil'],
    ]),
    /Invalid sender domain/,
  );
  await expectFailure(
    as('stranger@example.com', `select public.create_email_import_source($1, $2, now(), $3)`, [
      ULID('SRC3'),
      OWNER,
      ['amazon.de'],
    ]),
    /Not authorized/,
  );

  // Clients may read every column except the hash.
  const privileges = await db.query(`
    select
      has_column_privilege('authenticated', 'public.email_import_sources', 'token_hash', 'select') as hash,
      has_column_privilege('authenticated', 'public.email_import_sources', 'token_hint', 'select') as hint,
      has_function_privilege('anon', 'public.create_email_import_source(text, text, timestamptz, text[])', 'execute') as anon_create,
      has_function_privilege('authenticated', 'public.register_email_import_message(text, jsonb, text, jsonb)', 'execute') as client_register,
      has_function_privilege('authenticated', 'public.authenticate_email_import_source(text)', 'execute') as client_authenticate
  `);
  assert.deepEqual(privileges.rows[0], {
    hash: false,
    hint: true,
    anon_create: false,
    client_register: false,
    client_authenticate: false,
  });

  // ── Authentication by hash only; revoked tokens stop working ─────────────
  const authenticated = await db.query(
    `select id, allowed_sender_domains, messages_last_day from public.authenticate_email_import_source($1)`,
    [sha256(token)],
  );
  assert.deepEqual(authenticated.rows, [
    { id: ULID('SRC1'), allowed_sender_domains: ['amazon.de', 'edeka.de'], messages_last_day: 0 },
  ]);
  const wrong = await db.query(`select * from public.authenticate_email_import_source($1)`, [
    sha256(token + 'x'),
  ]);
  assert.equal(wrong.rows.length, 0);

  // ── Registration: queue, dedupe by message id and by content ─────────────
  await db.query(`insert into storage.objects values ('receipts', $1)`, [
    file(ULID('F1')).storage_path,
  ]);
  const first = await register('m1', [file(ULID('F1'))]);
  assert.equal(first.status, 'registered');
  assert.deepEqual(first.files, [{ id: ULID('F1'), status: 'queued' }]);
  const batch = await db.query(
    `select id, uploaded_by, paid_by, email_source_id from public.receipt_import_batches`,
  );
  assert.deepEqual(batch.rows, [
    { id: ULID('BATCH1'), uploaded_by: OWNER, paid_by: OWNER, email_source_id: ULID('SRC1') },
  ]);
  assert.deepEqual((await db.query(`select message from pgmq.sent`)).rows, [
    { message: { import_file_id: ULID('F1') } },
  ]);

  assert.equal((await register('m1', [file(ULID('F9'))])).status, 'known');

  const repeated = await register(
    'm2',
    [file(ULID('F2'), { content_sha256: sha256(ULID('F1')) })],
    ULID('BATCH2'),
  );
  assert.deepEqual(repeated.files, [{ id: ULID('F2'), status: 'duplicate' }]);
  assert.equal(repeated.batch_id, ULID('BATCH1'), 'the same Berlin day reuses one batch');

  await expectFailure(
    register('m3', [file(ULID('F3'), { storage_path: `${OTHER}/email/x/${ULID('F3')}.pdf` })]),
    /Invalid email import file descriptor/,
  );
  await expectFailure(register('m4', [file(ULID('F4'))]), /Uploaded Storage object not found/);

  const skipped = await register('m5', []);
  assert.equal(skipped.status, 'registered');
  assert.equal(skipped.batch_id, null);

  // ── Text documents only through the email path ───────────────────────────
  await expectFailure(
    db.query(
      `insert into public.receipt_import_files
         (id, batch_id, original_filename, mime_type, original_size_bytes, content_sha256, storage_path, status)
       values ($1, $2, 'x.txt', 'text/plain', 1, $3, $4, 'uploading')`,
      [ULID('F5'), ULID('BATCH1'), sha256('F5'), `${OWNER}/imports/${ULID('BATCH1')}/x.txt`],
    ),
    /receipt_import_files_text_only_from_email/,
  );

  // ── Retry only skipped messages of the caller's own source ───────────────
  await expectFailure(
    as(OTHER, `select public.retry_email_import_message($1)`, [ULID('MSGm5')]),
    /cannot be retried/,
  );
  await expectFailure(
    as(OWNER, `select public.retry_email_import_message($1)`, [ULID('MSGm1')]),
    /cannot be retried/,
  );
  await as(OWNER, `select public.retry_email_import_message($1)`, [ULID('MSGm5')]);
  const remaining = await db.query(
    `select provider_message_id from public.email_import_messages order by provider_message_id`,
  );
  assert.deepEqual(
    remaining.rows.map((row) => row.provider_message_id),
    ['m1', 'm2'],
  );

  // ── Daily limit ──────────────────────────────────────────────────────────
  await db.exec(`
    insert into public.email_import_messages (id, source_id, provider_message_id, status)
    select 'L' || lpad(n::text, 25, '0'), '${ULID('SRC1')}', 'bulk' || n, 'skipped'
    from generate_series(1, 28) as n
  `);
  await expectFailure(register('m6', []), /rate limit/);

  // ── Domains are editable by the owner; revocation disables the token ─────
  await as(OWNER, `select public.set_email_import_sender_domains($1, $2)`, [
    ULID('SRC1'),
    ['uber.com'],
  ]);
  await expectFailure(
    as(OTHER, `select public.revoke_email_import_source($1)`, [ULID('SRC1')]),
    /not found/,
  );
  await as(OWNER, `select public.revoke_email_import_source($1)`, [ULID('SRC1')]);
  const revoked = await db.query(`select * from public.authenticate_email_import_source($1)`, [
    sha256(token),
  ]);
  assert.equal(revoked.rows.length, 0);
  await expectFailure(register('m7', []), /Email import source unavailable/);

  console.log('email import SQL tests passed');
} finally {
  await db.close();
}

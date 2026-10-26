-- Receipt emails pushed from the owner's own mailbox (ADR-0029).
--
-- A Google Apps Script in the owner's Google account reads one Gmail label and
-- posts raw messages to the ingest-email-receipts Edge Function. Gmail access
-- never leaves Google: the database keeps only a SHA-256 hash of a per-user
-- ingest token, and that token can register import files and nothing else.
-- Which senders may create receipts is per-user data here, not code.

alter table public.receipt_import_files
  drop constraint receipt_import_files_mime_type_check;

alter table public.receipt_import_files
  add constraint receipt_import_files_mime_type_check check (
    mime_type in (
      'image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/json',
      'text/plain'
    )
  );

-- Email bodies are the only text documents. Browser uploads store under
-- `<email>/imports/`, so they cannot register one through create_receipt_import_batch.
alter table public.receipt_import_files
  add constraint receipt_import_files_text_only_from_email check (
    mime_type <> 'text/plain'
    or storage_path is null
    or position('/email/' in storage_path) > 0
  );

create table public.email_import_sources (
  id                      text primary key check (length(id) = 26),
  owner_email             text not null references public.app_users(email) on delete cascade,
  paid_by                 text not null references public.app_users(email) on delete cascade,
  token_hash              text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint              text not null check (length(token_hint) = 4),
  allowed_sender_domains  text[] not null check (cardinality(allowed_sender_domains) between 1 and 20),
  import_after            timestamptz not null,
  last_used_at            timestamptz,
  revoked_at              timestamptz,
  created_at              timestamptz not null default now()
);

create table public.email_import_messages (
  id                   text primary key check (length(id) = 26),
  source_id            text not null references public.email_import_sources(id) on delete cascade,
  provider_message_id  text not null check (provider_message_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  received_at          timestamptz,
  sender               text check (sender is null or length(sender) <= 320),
  subject              text check (subject is null or length(subject) <= 300),
  status               text not null check (status in ('imported', 'skipped')),
  reason               text check (reason is null or length(reason) <= 500),
  batch_id             text references public.receipt_import_batches(id) on delete set null,
  file_count           integer not null default 0 check (file_count between 0 and 3),
  created_at           timestamptz not null default now(),
  unique (source_id, provider_message_id)
);

create index idx_email_import_sources_owner
  on public.email_import_sources (owner_email, created_at desc);
create index idx_email_import_messages_source_created
  on public.email_import_messages (source_id, created_at desc);
create index idx_email_import_messages_batch
  on public.email_import_messages (batch_id)
  where batch_id is not null;

alter table public.receipt_import_batches
  add column email_source_id text references public.email_import_sources(id) on delete set null;

create index idx_receipt_import_batches_email_source
  on public.receipt_import_batches (email_source_id, created_at desc)
  where email_source_id is not null;

alter table public.email_import_sources enable row level security;
alter table public.email_import_messages enable row level security;

-- The connection and its message log (senders, subjects) belong to the owner
-- only. The documents it creates are ordinary import files and receipts,
-- shared with every allowlisted user like any uploaded receipt.
create policy "owner_read_email_import_sources"
  on public.email_import_sources for select to authenticated
  using (
    (select public.is_allowed_user())
    and owner_email = (select auth.jwt() ->> 'email')
  );

create policy "owner_read_email_import_messages"
  on public.email_import_messages for select to authenticated
  using (
    (select public.is_allowed_user())
    and exists (
      select 1 from public.email_import_sources s
      where s.id = source_id and s.owner_email = (select auth.jwt() ->> 'email')
    )
  );

revoke all on public.email_import_sources from public, anon, authenticated;
revoke all on public.email_import_messages from public, anon, authenticated;
-- token_hash stays readable to service_role only, so clients must name columns.
grant select (
  id, owner_email, paid_by, token_hint, allowed_sender_domains, import_after,
  last_used_at, revoked_at, created_at
) on public.email_import_sources to authenticated;
grant select on public.email_import_messages to authenticated;

create or replace function public.normalize_email_sender_domains(p_domains text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_domains text[];
begin
  select coalesce(array_agg(distinct lower(trim(d)) order by lower(trim(d))), '{}')
  into v_domains
  from unnest(coalesce(p_domains, '{}')) as d
  where trim(d) <> '';
  if cardinality(v_domains) < 1 or cardinality(v_domains) > 20 then
    raise exception 'Between 1 and 20 sender domains are required';
  end if;
  if exists (
    select 1 from unnest(v_domains) as d
    where d !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ) then
    raise exception 'Invalid sender domain';
  end if;
  return v_domains;
end;
$$;

create or replace function public.create_email_import_source(
  p_id text,
  p_paid_by text,
  p_import_after timestamptz,
  p_sender_domains text[]
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := auth.jwt() ->> 'email';
  v_token text;
begin
  if v_email is null or not public.is_allowed_user() then
    raise exception 'Not authorized';
  end if;
  if length(p_id) <> 26 then
    raise exception 'Invalid source id';
  end if;
  if not exists (select 1 from public.app_users where email = p_paid_by) then
    raise exception 'Invalid paid_by';
  end if;
  if p_import_after is null or p_import_after > now() + interval '1 day' then
    raise exception 'Invalid import_after';
  end if;
  if (
    select count(*) from public.email_import_sources s
    where s.owner_email = v_email and s.revoked_at is null
  ) >= 3 then
    raise exception 'Too many active email import sources';
  end if;

  -- 256 random bits. Only the hash is stored; the caller sees the token once.
  v_token := 'fte_' || rtrim(
    translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'),
    '='
  );
  insert into public.email_import_sources (
    id, owner_email, paid_by, token_hash, token_hint, allowed_sender_domains, import_after
  ) values (
    p_id, v_email, p_paid_by,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    right(v_token, 4),
    public.normalize_email_sender_domains(p_sender_domains),
    p_import_after
  );
  return v_token;
end;
$$;

create or replace function public.set_email_import_sender_domains(
  p_id text,
  p_sender_domains text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_allowed_user() then raise exception 'Not authorized'; end if;
  update public.email_import_sources
  set allowed_sender_domains = public.normalize_email_sender_domains(p_sender_domains)
  where id = p_id
    and owner_email = (auth.jwt() ->> 'email')
    and revoked_at is null;
  if not found then raise exception 'Email import source not found'; end if;
end;
$$;

create or replace function public.revoke_email_import_source(p_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_allowed_user() then raise exception 'Not authorized'; end if;
  update public.email_import_sources
  set revoked_at = now()
  where id = p_id
    and owner_email = (auth.jwt() ->> 'email')
    and revoked_at is null;
  if not found then raise exception 'Email import source not found'; end if;
end;
$$;

-- Forgetting a skipped message makes the script send it again on its next
-- run, for example after its sender domain was allowed.
create or replace function public.retry_email_import_message(p_message_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_allowed_user() then raise exception 'Not authorized'; end if;
  delete from public.email_import_messages m
  using public.email_import_sources s
  where m.id = p_message_id
    and m.status = 'skipped'
    and s.id = m.source_id
    and s.owner_email = (auth.jwt() ->> 'email')
    and s.revoked_at is null;
  if not found then raise exception 'Email import message cannot be retried'; end if;
end;
$$;

revoke execute on function public.normalize_email_sender_domains(text[])
  from public, anon, authenticated;
revoke execute on function public.create_email_import_source(text, text, timestamptz, text[])
  from public, anon;
revoke execute on function public.set_email_import_sender_domains(text, text[])
  from public, anon;
revoke execute on function public.revoke_email_import_source(text) from public, anon;
revoke execute on function public.retry_email_import_message(text) from public, anon;
grant execute on function public.create_email_import_source(text, text, timestamptz, text[])
  to authenticated;
grant execute on function public.set_email_import_sender_domains(text, text[]) to authenticated;
grant execute on function public.revoke_email_import_source(text) to authenticated;
grant execute on function public.retry_email_import_message(text) to authenticated;

-- Ingest-only RPCs, reachable with the service_role key inside the Edge Function.
create or replace function public.authenticate_email_import_source(p_token_hash text)
returns table (
  id text,
  owner_email text,
  paid_by text,
  allowed_sender_domains text[],
  import_after timestamptz,
  messages_last_day integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with source as (
    update public.email_import_sources s
    set last_used_at = now()
    where s.token_hash = p_token_hash and s.revoked_at is null
    returning s.id, s.owner_email, s.paid_by, s.allowed_sender_domains, s.import_after
  )
  select
    source.id, source.owner_email, source.paid_by, source.allowed_sender_domains,
    source.import_after,
    (
      select count(*)::integer from public.email_import_messages m
      where m.source_id = source.id and m.created_at > now() - interval '1 day'
    )
  from source;
end;
$$;

-- Registers one email and its prepared documents atomically. Documents that
-- repeat an existing file by content become duplicates without a Storage
-- object; the caller removes the objects of every file not reported as queued.
create or replace function public.register_email_import_message(
  p_source_id text,
  p_message jsonb,
  p_batch_id text,
  p_files jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.email_import_sources%rowtype;
  v_prefix text;
  v_batch_id text;
  v_file jsonb;
  v_file_id text;
  v_hash text;
  v_path text;
  v_existing_id text;
  v_file_count integer;
  v_results jsonb := '[]'::jsonb;
begin
  select s.* into v_source
  from public.email_import_sources s
  where s.id = p_source_id and s.revoked_at is null
  for update;
  if not found then raise exception 'Email import source unavailable'; end if;

  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) > 3 then
    raise exception 'Invalid email import files';
  end if;
  v_file_count := jsonb_array_length(p_files);
  v_prefix := v_source.owner_email || '/email/' || p_source_id || '/';

  if exists (
    select 1 from public.email_import_messages m
    where m.source_id = p_source_id
      and m.provider_message_id = p_message ->> 'provider_message_id'
  ) then
    return jsonb_build_object('status', 'known', 'files', '[]'::jsonb);
  end if;

  if (
    select count(*) from public.email_import_messages m
    where m.source_id = p_source_id and m.created_at > now() - interval '1 day'
  ) >= 30 then
    raise exception 'Email import rate limit exceeded';
  end if;

  if v_file_count > 0 then
    select b.id into v_batch_id
    from public.receipt_import_batches b
    where b.email_source_id = p_source_id
      and (b.created_at at time zone 'Europe/Berlin')::date
        = (now() at time zone 'Europe/Berlin')::date
    order by b.created_at desc
    limit 1;
    if v_batch_id is null then
      if length(p_batch_id) <> 26 then raise exception 'Invalid batch id'; end if;
      insert into public.receipt_import_batches (id, uploaded_by, paid_by, email_source_id)
      values (p_batch_id, v_source.owner_email, v_source.paid_by, p_source_id);
      v_batch_id := p_batch_id;
    end if;
  end if;

  for v_file in select value from jsonb_array_elements(p_files)
  loop
    v_file_id := v_file ->> 'id';
    v_hash := lower(v_file ->> 'content_sha256');
    v_path := v_file ->> 'storage_path';
    if length(v_file_id) <> 26 or v_hash !~ '^[0-9a-f]{64}$'
       or v_file ->> 'mime_type' not in ('application/pdf', 'text/plain')
       or v_path is null or left(v_path, length(v_prefix)) <> v_prefix then
      raise exception 'Invalid email import file descriptor';
    end if;

    select f.id into v_existing_id
    from public.receipt_import_files f
    where f.content_sha256 = v_hash
      and f.duplicate_of_file_id is null
      and f.status not in ('discarded', 'upload_failed')
    limit 1;

    if v_existing_id is not null then
      insert into public.receipt_import_files (
        id, batch_id, original_filename, mime_type, original_size_bytes,
        content_sha256, status, duplicate_of_file_id
      ) values (
        v_file_id, v_batch_id, left(coalesce(v_file ->> 'original_filename', 'email'), 255),
        v_file ->> 'mime_type', (v_file ->> 'original_size_bytes')::bigint,
        v_hash, 'duplicate', v_existing_id
      );
      v_results := v_results || jsonb_build_object('id', v_file_id, 'status', 'duplicate');
    else
      if not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'receipts' and o.name = v_path
      ) then
        raise exception 'Uploaded Storage object not found';
      end if;
      insert into public.receipt_import_files (
        id, batch_id, original_filename, mime_type, original_size_bytes,
        content_sha256, storage_path, status
      ) values (
        v_file_id, v_batch_id, left(coalesce(v_file ->> 'original_filename', 'email'), 255),
        v_file ->> 'mime_type', (v_file ->> 'original_size_bytes')::bigint,
        v_hash, v_path, 'queued'
      );
      perform pgmq.send('receipt_imports', jsonb_build_object('import_file_id', v_file_id));
      v_results := v_results || jsonb_build_object('id', v_file_id, 'status', 'queued');
    end if;
    v_existing_id := null;
  end loop;

  insert into public.email_import_messages (
    id, source_id, provider_message_id, received_at, sender, subject,
    status, reason, batch_id, file_count
  ) values (
    p_message ->> 'id', p_source_id, p_message ->> 'provider_message_id',
    nullif(p_message ->> 'received_at', '')::timestamptz,
    left(nullif(p_message ->> 'sender', ''), 320),
    left(nullif(p_message ->> 'subject', ''), 300),
    case when v_file_count > 0 then 'imported' else 'skipped' end,
    left(nullif(p_message ->> 'reason', ''), 500),
    v_batch_id, v_file_count
  );

  return jsonb_build_object('status', 'registered', 'batch_id', v_batch_id, 'files', v_results);
end;
$$;

revoke execute on function public.authenticate_email_import_source(text)
  from public, anon, authenticated;
revoke execute on function public.register_email_import_message(text, jsonb, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.authenticate_email_import_source(text) to service_role;
grant execute on function public.register_email_import_message(text, jsonb, text, jsonb)
  to service_role;

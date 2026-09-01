alter table public.receipt_import_attempts
  add column queue_message_id bigint;

alter table public.receipt_import_attempts
  add constraint receipt_import_attempts_queue_message_id_positive
  check (queue_message_id is null or queue_message_id > 0);

create index receipt_import_attempts_file_message_idx
  on public.receipt_import_attempts (file_id, queue_message_id, id desc)
  where queue_message_id is not null;

comment on column public.receipt_import_attempts.queue_message_id is
  'PGMQ message that owns this attempt. Automatic retries retain the message id; a manual requeue receives a new id and cannot reuse older AI results.';

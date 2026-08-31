-- Decouple Cron authentication from the database-privileged service-role key.
-- The worker still uses Supabase's injected service-role key for database access,
-- while pg_cron gets a purpose-specific bearer token with no database privileges.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'process-receipt-imports';

  if found then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

select cron.schedule(
  'process-receipt-imports',
  '30 seconds',
  $job$
    with secrets as (
      select
        max(decrypted_secret) filter (where name = 'project_url') as project_url,
        max(decrypted_secret) filter (
          where name = 'receipt_import_cron_token'
        ) as cron_token
      from vault.decrypted_secrets
    )
    select net.http_post(
      url := secrets.project_url || '/functions/v1/process-receipt-imports',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || secrets.cron_token
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 140000
    )
    from secrets
    where secrets.project_url is not null and secrets.cron_token is not null;
  $job$
);

-- Daily FX refresh: pg_cron calls the fx-refresh edge function through pg_net.
-- The function URL comes from the Vault secret 'project_url' (e.g.
-- https://<ref>.supabase.co), created once per project:
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
-- Skipped on plain PostgreSQL (tests), where pg_cron/pg_net are unavailable.
do $do$
begin
  if (select count(*) from pg_available_extensions where name in ('pg_cron','pg_net')) < 2 then
    raise notice 'pg_cron/pg_net not available: fx-refresh schedule skipped';
    return;
  end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net with schema extensions;
  -- cron.schedule upserts by job name, so re-running is harmless.
  perform cron.schedule('fx-refresh-daily', '17 4 * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/fx-refresh',
      headers := '{"content-type":"application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 30000)
  $job$);
end
$do$;

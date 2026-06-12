-- 0005_jobs.sql — scheduled report-recovery sweeper (pg_cron + pg_net).
--
-- Problem: a report-worker instance can die mid-fan-out, leaving a report stuck
-- in status='generating' forever. This job periodically finds such orphans
-- (lease expired or never taken, and old enough to be sure the original worker
-- is gone) and re-kicks the report-worker Edge Function for each.
--
-- Secret handling (DESIGN NOTE): the service_role key is NEVER stored in
-- app_config (which is readable wholesale by service_role and is for app data).
-- It lives in Supabase Vault (an encrypted secrets store). The sweeper reads it
-- via vault.decrypted_secrets at call time. The Edge base URL is non-secret and
-- lives in app_config under key 'edge_base_url'. Both are OPTIONAL: if either is
-- missing the function no-ops with a NOTICE, so a fresh DB (e.g. `supabase db
-- reset`) does not error before post-deploy setup runs. See supabase/README.md
-- for the post-deploy commands that populate them.

-- ---------------------------------------------------------------------------
-- Extensions (Supabase installs these into the `extensions` schema).
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;
-- supabase_vault provides vault.create_secret() + vault.decrypted_secrets.
-- It ships pre-installed on Supabase; create-if-missing is a safe no-op there.
create extension if not exists supabase_vault;

-- ---------------------------------------------------------------------------
-- Sweeper function.
--   Re-kicks reports that are:
--     * status = 'generating'
--     * lease free or expired (worker_lease_until is null or < now())
--     * generated_at older than the grace window (so we don't race a worker that
--       just started; the report stub's generated_at is its creation time)
--   For each, POST { report_id } to <edge_base_url>/functions/v1/report-worker
--   with the service-role bearer token.
-- ---------------------------------------------------------------------------
create or replace function public.sweep_stale_reports()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_url    text;
  v_service_key text;
  v_grace       interval := interval '3 minutes';
  v_rec         record;
  v_count       int := 0;
begin
  -- non-secret config
  select value #>> '{}' into v_base_url
  from public.app_config
  where key = 'edge_base_url';

  -- Shared worker secret from Vault (named 'worker_shared_secret'). A dedicated
  -- secret rather than the service role key: the platform-injected
  -- SUPABASE_SERVICE_ROLE_KEY inside edge functions can differ from the
  -- dashboard's legacy JWT key (new-format keys), which made key-equality
  -- auth between the sweeper and the worker unreliable.
  select decrypted_secret into v_service_key
  from vault.decrypted_secrets
  where name = 'worker_shared_secret'
  limit 1;

  if v_base_url is null or v_base_url = '' or v_service_key is null then
    raise notice 'sweep_stale_reports: edge_base_url and/or vault secret worker_shared_secret not configured — skipping';
    return;
  end if;

  for v_rec in
    select id
    from public.reports
    where status = 'generating'
      and (worker_lease_until is null or worker_lease_until < now())
      and generated_at < now() - v_grace
    order by generated_at asc
    limit 50              -- cap per sweep so a backlog doesn't flood the worker
  loop
    perform net.http_post(
      url     := rtrim(v_base_url, '/') || '/functions/v1/report-worker',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || v_service_key
                 ),
      body    := jsonb_build_object('report_id', v_rec.id)
    );
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    raise notice 'sweep_stale_reports: re-kicked % stale report(s)', v_count;
  end if;
end;
$$;

revoke execute on function public.sweep_stale_reports() from public, anon, authenticated;
grant  execute on function public.sweep_stale_reports() to service_role;

-- ---------------------------------------------------------------------------
-- Schedule: every 2 minutes. Idempotent — unschedule any prior job of the same
-- name first (cron.unschedule throws if the job is absent, so guard it).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sweep-stale-reports') then
    perform cron.unschedule('sweep-stale-reports');
  end if;
end
$$;

select cron.schedule(
  'sweep-stale-reports',
  '*/2 * * * *',
  $$select public.sweep_stale_reports()$$
);

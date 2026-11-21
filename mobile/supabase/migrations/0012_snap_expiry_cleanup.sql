-- Expired Snap objects must be deleted through the Storage API, not by
-- deleting rows from storage.objects. A service-role Edge Function performs
-- Storage removal first, then deletes the expired public.snaps rows.
--
-- Before applying this migration:
-- 1. Deploy supabase/functions/cleanup-expired-snaps.
-- 2. Set PROXY_SNAP_CLEANUP_SECRET in the Edge Function secrets.
-- 3. Store proxy_project_url, proxy_publishable_key and the same
--    proxy_snap_cleanup_secret in Supabase Vault (see mobile/README.md).

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create index if not exists snaps_expiry_cleanup_idx
  on public.snaps (expires_at, id);

-- Invalid legacy/external media references are recorded here before their
-- expired story rows are removed. This table is not exposed to client roles.
create table if not exists public.snap_cleanup_issues (
  snap_id uuid primary key,
  user_id uuid not null,
  reason text not null check (reason = 'invalid_or_external_object_path'),
  created_at timestamptz not null default now()
);

alter table public.snap_cleanup_issues enable row level security;
revoke all on table public.snap_cleanup_issues from public, anon, authenticated;
grant all on table public.snap_cleanup_issues to service_role;

-- Replace the named job idempotently if this migration is reapplied.
do $$
declare existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'proxy-expired-snap-cleanup'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'proxy-expired-snap-cleanup',
    '*/15 * * * *',
    $job$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'proxy_project_url'
          limit 1
        ) || '/functions/v1/cleanup-expired-snaps',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'proxy_publishable_key'
            limit 1
          ),
          'x-proxy-snap-cleanup-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'proxy_snap_cleanup_secret'
            limit 1
          )
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 120000
      ) as request_id;
    $job$
  );
end;
$$;

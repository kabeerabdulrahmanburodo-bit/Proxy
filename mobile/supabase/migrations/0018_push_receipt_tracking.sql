-- Persist Expo push ticket IDs and poll delivery receipts server-side.
-- Deploy process-push-receipts and store proxy_push_receipt_secret in Vault
-- before applying this migration if the scheduled job should be installed now.

alter table public.push_devices
  add column if not exists id uuid;

update public.push_devices
set id = gen_random_uuid()
where id is null;

alter table public.push_devices
  alter column id set default gen_random_uuid(),
  alter column id set not null;

create unique index if not exists push_devices_id_uidx
  on public.push_devices(id);

create table if not exists public.push_receipt_tickets (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.push_outbox(id) on delete cascade,
  ticket_id text not null unique check (char_length(ticket_id) between 1 and 128),
  push_device_id uuid references public.push_devices(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ok', 'error')),
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 20),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  checked_at timestamptz,
  error_code text,
  error_message text
);

create index if not exists push_receipt_tickets_pending_idx
  on public.push_receipt_tickets(status, created_at, id)
  where status in ('pending', 'processing');

create index if not exists push_receipt_tickets_outbox_idx
  on public.push_receipt_tickets(outbox_id);

alter table public.push_receipt_tickets enable row level security;
revoke all on table public.push_receipt_tickets from public, anon, authenticated;
grant all on table public.push_receipt_tickets to service_role;

create or replace function public.claim_push_receipt_tickets(maximum_count integer default 300)
returns table (
  id uuid,
  ticket_id text,
  push_device_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.push_receipt_tickets as receipt
     set status = 'error',
         claimed_at = null,
         checked_at = now(),
         error_code = coalesce(receipt.error_code, 'ReceiptUnavailable'),
         error_message = coalesce(
           receipt.error_message,
           'Expo receipt remained unavailable after 20 polling attempts.'
         )
   where receipt.attempts >= 20
     and (
       receipt.status = 'pending'
       or (
         receipt.status = 'processing'
         and receipt.claimed_at < now() - interval '20 minutes'
       )
     );

  return query
  with candidates as (
    select receipt.id as receipt_id
    from public.push_receipt_tickets as receipt
    where receipt.attempts < 20
      and (
        (receipt.status = 'pending'
          and receipt.created_at <= now() - interval '15 minutes')
        or
        (receipt.status = 'processing'
          and receipt.claimed_at < now() - interval '20 minutes')
      )
    order by receipt.created_at, receipt.id
    limit greatest(1, least(coalesce(maximum_count, 300), 300))
    for update skip locked
  )
  update public.push_receipt_tickets as receipt
     set status = 'processing',
         attempts = receipt.attempts + 1,
         claimed_at = now()
    from candidates
   where receipt.id = candidates.receipt_id
  returning receipt.id, receipt.ticket_id, receipt.push_device_id;
end;
$$;
revoke all on function public.claim_push_receipt_tickets(integer) from public, anon, authenticated;
grant execute on function public.claim_push_receipt_tickets(integer) to service_role;

create or replace function public.finish_push_receipt_ticket(
  target_ticket_id uuid,
  receipt_status text,
  receipt_error_code text default null,
  receipt_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_device_id uuid;
  final_status text;
begin
  if receipt_status is null or receipt_status not in ('ok', 'error', 'pending') then
    raise exception 'Invalid push receipt status';
  end if;

  update public.push_receipt_tickets as receipt
     set status = case
           when receipt_status = 'pending' and receipt.attempts >= 20 then 'error'
           else receipt_status
         end,
         claimed_at = null,
         checked_at = case
           when receipt_status = 'pending' and receipt.attempts < 20 then null
           else now()
         end,
         error_code = case
           when receipt_status = 'pending' and receipt.attempts >= 20 then 'ReceiptUnavailable'
           when receipt_status = 'pending' then null
           else left(nullif(trim(receipt_error_code), ''), 120)
         end,
         error_message = case
           when receipt_status = 'pending' and receipt.attempts >= 20
             then 'Expo receipt remained unavailable after 20 polling attempts.'
           else left(nullif(trim(receipt_error_message), ''), 500)
         end
   where receipt.id = target_ticket_id
     and receipt.status = 'processing'
  returning receipt.push_device_id, receipt.status
       into target_device_id, final_status;

  if not found then
    return false;
  end if;

  if final_status = 'error'
     and receipt_status = 'error'
     and receipt_error_code = 'DeviceNotRegistered'
     and target_device_id is not null then
    update public.push_devices
       set enabled = false
     where id = target_device_id;
  end if;

  return true;
end;
$$;
revoke all on function public.finish_push_receipt_ticket(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_push_receipt_ticket(uuid, text, text, text)
  to service_role;

-- Migration 0012 installs pg_cron/pg_net and stores the project URL and public
-- API key in Vault. Install this poller only when its dedicated secret is ready.
do $$
declare
  existing_job record;
  secrets_ready boolean;
begin
  if to_regclass('cron.job') is null
     or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'Push receipt cron was not installed: pg_cron or Vault is unavailable.';
    return;
  end if;

  select count(distinct secret.name) = 3
    into secrets_ready
  from vault.decrypted_secrets as secret
  where secret.name in (
    'proxy_project_url',
    'proxy_publishable_key',
    'proxy_push_receipt_secret'
  );

  if not coalesce(secrets_ready, false) then
    raise notice 'Push receipt cron was not installed: configure the three required Vault secrets and re-run migration 0018.';
    return;
  end if;

  for existing_job in
    select jobid from cron.job where jobname = 'proxy-push-receipt-poll'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'proxy-push-receipt-poll',
    '*/15 * * * *',
    $job$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'proxy_project_url'
          limit 1
        ) || '/functions/v1/process-push-receipts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'proxy_publishable_key'
            limit 1
          ),
          'x-proxy-push-receipt-secret', (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'proxy_push_receipt_secret'
            limit 1
          )
        ),
        body := '{"limit":300}'::jsonb,
        timeout_milliseconds := 60000
      ) as request_id;
    $job$
  );
end;
$$;

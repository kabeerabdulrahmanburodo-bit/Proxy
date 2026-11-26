\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'create role anon nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'create role service_role nologin bypassrls';
  end if;
end;
$$;

create table public.push_devices (
  expo_push_token text primary key,
  user_id uuid not null,
  platform text not null,
  enabled boolean not null default true
);

create table public.push_outbox (
  id uuid primary key,
  user_id uuid not null
);

grant all on public.push_devices, public.push_outbox to service_role;

\ir ../migrations/0018_push_receipt_tracking.sql

insert into public.push_devices(expo_push_token, user_id, platform)
values
  ('ExponentPushToken[device-one]', '00000000-0000-0000-0000-000000000001', 'ios'),
  ('ExponentPushToken[device-two]', '00000000-0000-0000-0000-000000000002', 'android'),
  ('ExponentPushToken[device-three]', '00000000-0000-0000-0000-000000000003', 'ios');

insert into public.push_outbox(id, user_id)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003');

insert into public.push_receipt_tickets(outbox_id, ticket_id, push_device_id, created_at)
select '10000000-0000-0000-0000-000000000001', 'receipt-ok', id, now() - interval '20 minutes'
from public.push_devices where expo_push_token = 'ExponentPushToken[device-one]';

insert into public.push_receipt_tickets(outbox_id, ticket_id, push_device_id, created_at)
select '10000000-0000-0000-0000-000000000002', 'receipt-device-gone', id, now() - interval '19 minutes'
from public.push_devices where expo_push_token = 'ExponentPushToken[device-two]';

insert into public.push_receipt_tickets(outbox_id, ticket_id, push_device_id, created_at)
select '10000000-0000-0000-0000-000000000003', 'receipt-reclaim', id, now() - interval '18 minutes'
from public.push_devices where expo_push_token = 'ExponentPushToken[device-three]';

do $$
begin
  if has_table_privilege('anon', 'public.push_receipt_tickets', 'SELECT')
     or has_table_privilege('authenticated', 'public.push_receipt_tickets', 'SELECT') then
    raise exception 'Push receipt tickets must not be readable by client roles';
  end if;
  if has_function_privilege('anon', 'public.claim_push_receipt_tickets(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_push_receipt_tickets(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.finish_push_receipt_ticket(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'Receipt worker RPCs must be service-role only';
  end if;
  if not has_function_privilege('service_role', 'public.claim_push_receipt_tickets(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.finish_push_receipt_ticket(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'Service role must execute receipt worker RPCs';
  end if;
end;
$$;

set role service_role;
do $$
declare
  claimed record;
  is_enabled boolean;
  attempt_count integer;
  receipt_id uuid;
begin
  select * into claimed
  from public.claim_push_receipt_tickets(1);

  if claimed.ticket_id <> 'receipt-ok' then
    raise exception 'The oldest eligible receipt should be claimed first';
  end if;

  receipt_id := claimed.id;
  if not public.finish_push_receipt_ticket(receipt_id, 'ok', null, null) then
    raise exception 'A claimed successful receipt should be finalized';
  end if;
  if public.finish_push_receipt_ticket(receipt_id, 'ok', null, null) then
    raise exception 'A finalized receipt must not be finalized twice';
  end if;

  select * into claimed
  from public.claim_push_receipt_tickets(1);
  if claimed.ticket_id <> 'receipt-device-gone' then
    raise exception 'The next pending receipt should be claimed';
  end if;
  if not public.finish_push_receipt_ticket(
    claimed.id, 'error', 'DeviceNotRegistered', 'The device is no longer registered.'
  ) then
    raise exception 'A device error receipt should be finalized';
  end if;
  select enabled into is_enabled from public.push_devices where id = claimed.push_device_id;
  if is_enabled is distinct from false then
    raise exception 'DeviceNotRegistered must disable only the associated device';
  end if;

  select * into claimed
  from public.claim_push_receipt_tickets(1);
  if claimed.ticket_id <> 'receipt-reclaim' then
    raise exception 'The third receipt should be claimable';
  end if;
  update public.push_receipt_tickets
     set claimed_at = now() - interval '21 minutes'
   where id = claimed.id;
  select * into claimed
  from public.claim_push_receipt_tickets(1);
  if claimed.ticket_id <> 'receipt-reclaim' then
    raise exception 'A stale processing receipt should be reclaimed';
  end if;
  select attempts into attempt_count from public.push_receipt_tickets where id = claimed.id;
  if attempt_count is distinct from 2 then
    raise exception 'Reclaimed receipt attempts should increment';
  end if;

  begin
    perform public.finish_push_receipt_ticket(claimed.id, 'unknown', null, null);
    raise exception 'Invalid receipt status must be rejected';
  exception when raise_exception then
    if sqlerrm = 'Invalid receipt status must be rejected' then raise; end if;
  end;
end;
$$;
reset role;

select '0018 push receipt tracking SQL checks passed' as result;

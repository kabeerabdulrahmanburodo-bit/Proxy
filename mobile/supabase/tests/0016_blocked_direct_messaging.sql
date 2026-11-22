\set ON_ERROR_STOP on

-- Reuse the complete block/report fixture, then add chat tables and policies.
\ir 0014_video_safety_controls.sql

create table public.conversations (
  id uuid primary key,
  is_group boolean not null default false,
  title text,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (conversation_id, user_id)
);
create table public.messages (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null default '',
  media_url text,
  media_type text,
  created_at timestamptz not null default now(),
  check (body <> '' or media_url is not null)
);

create or replace function public.is_conversation_member(_conversation_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = _conversation_id and user_id = _user_id
  );
$$;
revoke all on function public.is_conversation_member(uuid, uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

alter table public.messages enable row level security;
grant select, insert, update on public.messages to authenticated;
create policy "Members can read messages"
  on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id, auth.uid()));
create policy "Members can send as themselves"
  on public.messages for insert to authenticated
  with check (
    auth.uid() = sender_id
    and public.is_conversation_member(conversation_id, auth.uid())
  );
create policy "Sender can update own message"
  on public.messages for update to authenticated
  using (auth.uid() = sender_id);

create schema storage;
create table storage.objects (
  bucket_id text not null,
  name text not null,
  primary key (bucket_id, name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
create policy "Conversation members read chat attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_conversation_member(split_part(name, '/', 1)::uuid, auth.uid())
      else false
    end
  );
create policy "Members upload own chat attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and split_part(name, '/', 2) = auth.uid()::text
      then public.is_conversation_member(split_part(name, '/', 1)::uuid, auth.uid())
      else false
    end
  );
create policy "Uploaders delete own chat attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and split_part(name, '/', 2) = auth.uid()::text
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_conversation_member(split_part(name, '/', 1)::uuid, auth.uid())
      else false
    end
  );

\ir ../migrations/0016_blocked_direct_messaging.sql

insert into public.user_blocks(blocker_id, blocked_id) values
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');

insert into public.conversations(id,is_group,created_by) values
  ('60000000-0000-0000-0000-000000000001',false,'00000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000002',false,'00000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000003',false,'00000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000004',true,'00000000-0000-0000-0000-000000000001');

insert into public.conversation_members(conversation_id,user_id) values
  ('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'),
  ('60000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004'),
  ('60000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004');

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;

do $$
declare
  existing_id uuid;
  row_count integer;
begin
  if public.can_send_conversation_message('60000000-0000-0000-0000-000000000001')
     or public.can_send_conversation_message('60000000-0000-0000-0000-000000000002') then
    raise exception 'Both outgoing and incoming blocks must disable direct messaging';
  end if;
  if not public.can_send_conversation_message('60000000-0000-0000-0000-000000000003')
     or not public.can_send_conversation_message('60000000-0000-0000-0000-000000000004') then
    raise exception 'Unblocked direct chats and group chats must remain usable';
  end if;
  if public.can_send_conversation_message('60000000-0000-0000-0000-000000000099') then
    raise exception 'Non-members must not be able to send';
  end if;

  begin
    perform public.create_direct_conversation('00000000-0000-0000-0000-000000000002');
    raise exception 'Expected outgoing block to prevent direct-chat creation';
  exception when raise_exception then
    if sqlerrm = 'Expected outgoing block to prevent direct-chat creation' then raise; end if;
  end;
  begin
    perform public.create_direct_conversation('00000000-0000-0000-0000-000000000003');
    raise exception 'Expected incoming block to prevent direct-chat creation';
  exception when raise_exception then
    if sqlerrm = 'Expected incoming block to prevent direct-chat creation' then raise; end if;
  end;

  existing_id := public.create_direct_conversation('00000000-0000-0000-0000-000000000004');
  if existing_id <> '60000000-0000-0000-0000-000000000003' then
    raise exception 'An unblocked existing direct conversation should be reused';
  end if;

  begin
    insert into public.messages(id,conversation_id,sender_id,body)
    values ('70000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001','blocked');
    raise exception 'Expected outgoing-block message insert to be denied';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.messages(id,conversation_id,sender_id,body)
    values ('70000000-0000-0000-0000-000000000002',
      '60000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001','blocked');
    raise exception 'Expected incoming-block message insert to be denied';
  exception when insufficient_privilege then null;
  end;

  insert into public.messages(id,conversation_id,sender_id,body)
  values ('70000000-0000-0000-0000-000000000003',
    '60000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001','history stays available');
  insert into storage.objects(bucket_id,name)
  values ('chat-attachments',
    '60000000-0000-0000-0000-000000000003/00000000-0000-0000-0000-000000000001/old.jpg');

  begin
    insert into storage.objects(bucket_id,name)
    values ('chat-attachments',
      '60000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000001/blocked.jpg');
    raise exception 'Expected blocked direct-chat attachment upload to be denied';
  exception when insufficient_privilege then null;
  end;

  -- A shared group remains usable even when one of its members is blocked.
  insert into public.messages(id,conversation_id,sender_id,body)
  values ('70000000-0000-0000-0000-000000000004',
    '60000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001','group remains available');
  insert into storage.objects(bucket_id,name)
  values ('chat-attachments',
    '60000000-0000-0000-0000-000000000004/00000000-0000-0000-0000-000000000001/group.jpg');

  perform public.block_user('00000000-0000-0000-0000-000000000004');
  if public.can_send_conversation_message('60000000-0000-0000-0000-000000000003') then
    raise exception 'A newly blocked direct conversation must become read-only';
  end if;
  if not public.can_send_conversation_message('60000000-0000-0000-0000-000000000004') then
    raise exception 'Blocking a group member must not disable group messaging';
  end if;

  update public.messages set body='edited after block'
  where id='70000000-0000-0000-0000-000000000003';
  if found then
    raise exception 'A blocked direct message must not be editable';
  end if;

  select count(*) into row_count from public.messages
  where id='70000000-0000-0000-0000-000000000003';
  if row_count <> 1 then
    raise exception 'Existing direct-message history must remain readable';
  end if;
  select count(*) into row_count from storage.objects
  where bucket_id='chat-attachments'
    and name='60000000-0000-0000-0000-000000000003/00000000-0000-0000-0000-000000000001/old.jpg';
  if row_count <> 1 then
    raise exception 'Previously shared attachments must remain readable';
  end if;

  begin
    perform public.create_direct_conversation('00000000-0000-0000-0000-000000000004');
    raise exception 'Expected a new block to prevent reopening direct messaging';
  exception when raise_exception then
    if sqlerrm = 'Expected a new block to prevent reopening direct messaging' then raise; end if;
  end;

  if not public.unblock_user('00000000-0000-0000-0000-000000000004') then
    raise exception 'Unblocking should restore the prior direct conversation';
  end if;
  if not public.can_send_conversation_message('60000000-0000-0000-0000-000000000003') then
    raise exception 'Unblocking should restore direct messaging';
  end if;
end;
$$;

reset role;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$
begin
  if public.can_send_conversation_message('60000000-0000-0000-0000-000000000001') then
    raise exception 'The blocked peer must also be prevented from sending';
  end if;
end;
$$;
reset role;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
set role authenticated;
do $$
begin
  if public.can_send_conversation_message('60000000-0000-0000-0000-000000000002') then
    raise exception 'The account that initiated the incoming block must also be prevented from sending';
  end if;
end;
$$;
reset role;

do $$
begin
  if has_function_privilege('anon','public.can_send_conversation_message(uuid)','EXECUTE')
     or has_function_privilege('anon','public.create_direct_conversation(uuid)','EXECUTE') then
    raise exception 'Anonymous users must not execute messaging authorization RPCs';
  end if;
  if not has_function_privilege('authenticated','public.can_send_conversation_message(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.create_direct_conversation(uuid)','EXECUTE') then
    raise exception 'Authenticated users must execute messaging authorization RPCs';
  end if;
end;
$$;

select '0016 blocked direct messaging SQL checks passed' as result;

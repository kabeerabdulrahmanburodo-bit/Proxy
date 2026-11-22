-- Block-aware direct messaging. Existing history remains readable; new direct
-- messages and chat-attachment uploads are denied while either participant blocks
-- the other. Group conversations remain usable.

create or replace function public.can_send_conversation_message(p_conversation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  requester_id uuid := auth.uid();
  conversation_is_group boolean;
  peer_count integer;
begin
  if requester_id is null or p_conversation_id is null then
    return false;
  end if;

  select c.is_group into conversation_is_group
  from public.conversations c
  where c.id = p_conversation_id;
  if not found then
    return false;
  end if;

  if not exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conversation_id
      and cm.user_id = requester_id
  ) then
    return false;
  end if;

  -- A block between group members does not remove either person's ability to
  -- participate in a shared group. Only one-to-one conversations are blocked.
  if conversation_is_group then
    return true;
  end if;

  select count(*)::integer into peer_count
  from public.conversation_members cm
  where cm.conversation_id = p_conversation_id
    and cm.user_id <> requester_id;

  -- Fail closed if a non-group conversation does not have exactly one peer.
  if peer_count <> 1 then
    return false;
  end if;

  return not exists (
    select 1
    from public.conversation_members peer
    join public.user_blocks b
      on (b.blocker_id = requester_id and b.blocked_id = peer.user_id)
      or (b.blocker_id = peer.user_id and b.blocked_id = requester_id)
    where peer.conversation_id = p_conversation_id
      and peer.user_id <> requester_id
  );
end;
$$;

revoke all on function public.can_send_conversation_message(uuid) from public, anon;
grant execute on function public.can_send_conversation_message(uuid) to authenticated;

-- Serialize block creation with direct-chat creation for the same user pair.
-- The shared advisory-lock key prevents a new direct chat racing a block insert.
create or replace function public.block_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_id uuid := auth.uid();
begin
  if requester_id is null then
    raise exception 'Authentication required';
  end if;
  if p_user_id is null or p_user_id = requester_id then
    raise exception 'Choose another account to block';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Account not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      least(requester_id::text, p_user_id::text) || ':' ||
      greatest(requester_id::text, p_user_id::text),
      0
    )
  );

  insert into public.user_blocks(blocker_id, blocked_id)
  values (requester_id, p_user_id)
  on conflict (blocker_id, blocked_id) do nothing;

  delete from public.follows
  where (follower_id = requester_id and following_id = p_user_id)
     or (follower_id = p_user_id and following_id = requester_id);

  return true;
end;
$$;

revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

-- Refuse both new and previously-created direct conversations when a block is
-- active. Existing conversation rows are retained so unblocking can restore
-- access to the prior history without silently recreating or deleting data.
create or replace function public.create_direct_conversation(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_id uuid := auth.uid();
  existing_id uuid;
  created_id uuid;
begin
  if requester_id is null then
    raise exception 'Authentication required';
  end if;
  if other_user_id is null or other_user_id = requester_id then
    raise exception 'Choose another user';
  end if;
  if not exists (select 1 from public.profiles where id = other_user_id) then
    raise exception 'User not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      least(requester_id::text, other_user_id::text) || ':' ||
      greatest(requester_id::text, other_user_id::text),
      0
    )
  );

  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = requester_id and b.blocked_id = other_user_id)
       or (b.blocker_id = other_user_id and b.blocked_id = requester_id)
  ) then
    raise exception 'Direct messaging is unavailable while a block is active'
      using errcode = '42501';
  end if;

  select c.id into existing_id
  from public.conversations c
  join public.conversation_members mine
    on mine.conversation_id = c.id and mine.user_id = requester_id
  join public.conversation_members peer
    on peer.conversation_id = c.id and peer.user_id = other_user_id
  where c.is_group = false
    and (
      select count(*)
      from public.conversation_members cm
      where cm.conversation_id = c.id
    ) = 2
  order by c.created_at desc
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.conversations (is_group, created_by)
  values (false, requester_id)
  returning id into created_id;

  insert into public.conversation_members (conversation_id, user_id)
  values (created_id, requester_id), (created_id, other_user_id);

  return created_id;
end;
$$;

revoke all on function public.create_direct_conversation(uuid) from public, anon;
grant execute on function public.create_direct_conversation(uuid) to authenticated;

-- Preserve the existing owner-folder object-path validation while adding the
-- block check. SELECT remains available for historical conversation content.
drop policy if exists "Members can send as themselves" on public.messages;
create policy "Members can send when direct messaging is allowed"
  on public.messages
  for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and public.is_conversation_member(conversation_id, auth.uid())
    and public.can_send_conversation_message(conversation_id)
    and (
      media_url is null
      or (
        media_type in ('image', 'video')
        and split_part(media_url, '/', 1) = conversation_id::text
        and split_part(media_url, '/', 2) = auth.uid()::text
        and split_part(media_url, '/', 3) <> ''
      )
    )
  );

drop policy if exists "Sender can update own message" on public.messages;
create policy "Senders update messages when direct messaging is allowed"
  on public.messages
  for update
  to authenticated
  using (
    auth.uid() = sender_id
    and public.is_conversation_member(conversation_id, auth.uid())
    and public.can_send_conversation_message(conversation_id)
  )
  with check (
    auth.uid() = sender_id
    and public.is_conversation_member(conversation_id, auth.uid())
    and public.can_send_conversation_message(conversation_id)
    and (
      media_url is null
      or (
        media_type in ('image', 'video')
        and split_part(media_url, '/', 1) = conversation_id::text
        and split_part(media_url, '/', 2) = auth.uid()::text
        and split_part(media_url, '/', 3) <> ''
      )
    )
  );

-- Do not allow a blocked participant to create orphaned private attachments in
-- an existing direct chat. Historical attachment reads remain member-scoped.
drop policy if exists "Members upload own chat attachments" on storage.objects;
create policy "Members upload chat attachments when messaging is allowed"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and split_part(name, '/', 2) = (select auth.uid())::text
      then public.can_send_conversation_message(split_part(name, '/', 1)::uuid)
      else false
    end
  );

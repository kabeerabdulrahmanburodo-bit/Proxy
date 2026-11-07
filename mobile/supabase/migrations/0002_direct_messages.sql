-- Create or reuse a one-to-one conversation atomically.
-- SECURITY DEFINER is required because a new conversation has no members yet,
-- so the normal member-only SELECT policy cannot expose it during setup.
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

  -- Serialize creation for the same pair so two quick taps cannot create duplicate chats.
  perform pg_advisory_xact_lock(
    hashtextextended(
      least(requester_id::text, other_user_id::text) || ':' ||
      greatest(requester_id::text, other_user_id::text),
      0
    )
  );

  select c.id into existing_id
  from public.conversations c
  join public.conversation_members mine
    on mine.conversation_id = c.id and mine.user_id = requester_id
  join public.conversation_members peer
    on peer.conversation_id = c.id and peer.user_id = other_user_id
  where c.is_group = false
    and (select count(*) from public.conversation_members cm where cm.conversation_id = c.id) = 2
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

revoke all on function public.create_direct_conversation(uuid) from public;
grant execute on function public.create_direct_conversation(uuid) to authenticated;

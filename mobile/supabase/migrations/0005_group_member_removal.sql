-- Group membership removal is performed through a validated RPC.
-- Members may leave; only the creator may remove other members.
-- The creator may delete a group only when they are its sole remaining member.

create or replace function public.remove_group_conversation_member(
  target_conversation_id uuid,
  target_member_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_id uuid := auth.uid();
  group_creator_id uuid;
  member_count integer;
begin
  if requester_id is null then
    raise exception 'Authentication required';
  end if;

  select c.created_by
    into group_creator_id
  from public.conversations c
  where c.id = target_conversation_id
    and c.is_group = true
  for update;

  if not found then
    raise exception 'Group not found';
  end if;

  if not exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = target_conversation_id
      and cm.user_id = requester_id
  ) then
    raise exception 'You are not a member of this group';
  end if;

  if requester_id <> group_creator_id and target_member_id <> requester_id then
    raise exception 'Only the group creator can remove other members';
  end if;

  if target_member_id = group_creator_id then
    if requester_id <> group_creator_id then
      raise exception 'Only the group creator can delete this group';
    end if;

    select count(*) into member_count
    from public.conversation_members
    where conversation_id = target_conversation_id;

    if member_count > 1 then
      raise exception 'The group creator cannot leave while other members remain';
    end if;

    delete from public.conversations
    where id = target_conversation_id;

    return true;
  end if;

  delete from public.conversation_members
  where conversation_id = target_conversation_id
    and user_id = target_member_id;

  if not found then
    raise exception 'That user is not a member of this group';
  end if;

  return true;
end;
$$;

revoke all on function public.remove_group_conversation_member(uuid, uuid) from public;
grant execute on function public.remove_group_conversation_member(uuid, uuid) to authenticated;

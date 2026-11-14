-- Transfer group ownership atomically to an existing member.
-- The previous creator remains a normal member and may then leave safely.

create or replace function public.transfer_group_conversation_ownership(
  target_conversation_id uuid,
  new_owner_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_id uuid := auth.uid();
  current_creator_id uuid;
begin
  if requester_id is null then
    raise exception 'Authentication required';
  end if;
  if new_owner_id is null or new_owner_id = requester_id then
    raise exception 'Choose another group member as the new creator';
  end if;

  select c.created_by
    into current_creator_id
  from public.conversations c
  where c.id = target_conversation_id
    and c.is_group = true
  for update;

  if not found then
    raise exception 'Group not found';
  end if;
  if current_creator_id <> requester_id then
    raise exception 'Only the current group creator can transfer ownership';
  end if;
  if not exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = target_conversation_id
      and cm.user_id = requester_id
  ) then
    raise exception 'You are not a member of this group';
  end if;
  if not exists (
    select 1
    from public.conversation_members cm
    where cm.conversation_id = target_conversation_id
      and cm.user_id = new_owner_id
  ) then
    raise exception 'The new creator must already be a group member';
  end if;

  update public.conversations
  set created_by = new_owner_id
  where id = target_conversation_id
    and is_group = true
    and created_by = requester_id;

  if not found then
    raise exception 'Group ownership changed; refresh and try again';
  end if;

  return true;
end;
$$;

revoke all on function public.transfer_group_conversation_ownership(uuid, uuid) from public;
grant execute on function public.transfer_group_conversation_ownership(uuid, uuid) to authenticated;

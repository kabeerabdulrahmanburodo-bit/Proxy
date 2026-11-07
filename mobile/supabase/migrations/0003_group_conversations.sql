-- Group conversations are created and expanded through SECURITY DEFINER RPCs.
-- This keeps membership changes atomic and avoids exposing arbitrary member insertion.

create or replace function public.create_group_conversation(group_title text, member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_id uuid := auth.uid();
  clean_title text := btrim(coalesce(group_title, ''));
  selected_ids uuid[];
  missing_count integer;
  created_id uuid;
begin
  if requester_id is null then
    raise exception 'Authentication required';
  end if;
  if char_length(clean_title) not between 1 and 60 then
    raise exception 'Group name must be between 1 and 60 characters';
  end if;

  select coalesce(array_agg(id order by id), '{}'::uuid[])
    into selected_ids
  from (
    select distinct candidate as id
    from unnest(coalesce(member_ids, '{}'::uuid[])) as requested(candidate)
    where candidate is not null and candidate <> requester_id
  ) selected_members;

  if cardinality(selected_ids) < 2 then
    raise exception 'Choose at least two other people';
  end if;
  if cardinality(selected_ids) > 49 then
    raise exception 'A group can have at most 50 members';
  end if;

  select count(*) into missing_count
  from unnest(selected_ids) as selected(id)
  where not exists (select 1 from public.profiles p where p.id = selected.id);
  if missing_count > 0 then
    raise exception 'One or more selected users do not exist';
  end if;

  insert into public.conversations (is_group, title, created_by)
  values (true, clean_title, requester_id)
  returning id into created_id;

  insert into public.conversation_members (conversation_id, user_id)
  select created_id, requester_id
  union all
  select created_id, selected_id from unnest(selected_ids) as selected(selected_id);

  return created_id;
end;
$$;

revoke all on function public.create_group_conversation(text, uuid[]) from public;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;

create or replace function public.add_group_conversation_members(target_conversation_id uuid, member_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_id uuid := auth.uid();
  group_creator uuid;
  selected_ids uuid[];
  missing_count integer;
  current_count integer;
  added_count integer := 0;
begin
  if requester_id is null then
    raise exception 'Authentication required';
  end if;

  select created_by into group_creator
  from public.conversations
  where id = target_conversation_id and is_group = true
  for update;
  if not found then
    raise exception 'Group not found';
  end if;
  if group_creator <> requester_id then
    raise exception 'Only the group creator can add members';
  end if;

  select coalesce(array_agg(id order by id), '{}'::uuid[])
    into selected_ids
  from (
    select distinct candidate as id
    from unnest(coalesce(member_ids, '{}'::uuid[])) as requested(candidate)
    where candidate is not null
      and candidate <> requester_id
      and not exists (
        select 1 from public.conversation_members cm
        where cm.conversation_id = target_conversation_id and cm.user_id = candidate
      )
  ) pending_members;

  if cardinality(selected_ids) = 0 then
    return 0;
  end if;

  select count(*) into missing_count
  from unnest(selected_ids) as selected(id)
  where not exists (select 1 from public.profiles p where p.id = selected.id);
  if missing_count > 0 then
    raise exception 'One or more selected users do not exist';
  end if;

  select count(*) into current_count
  from public.conversation_members
  where conversation_id = target_conversation_id;
  if current_count + cardinality(selected_ids) > 50 then
    raise exception 'A group can have at most 50 members';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  select target_conversation_id, selected_id
  from unnest(selected_ids) as selected(selected_id)
  on conflict (conversation_id, user_id) do nothing;
  get diagnostics added_count = row_count;
  return added_count;
end;
$$;

revoke all on function public.add_group_conversation_members(uuid, uuid[]) from public;
grant execute on function public.add_group_conversation_members(uuid, uuid[]) to authenticated;

\set ON_ERROR_STOP on

-- Reuse the minimal feed schema and authenticated fixture users.
\ir 0013_personalized_video_feed.sql

create table public.user_blocks (
  blocker_id uuid not null,
  blocked_id uuid not null,
  primary key (blocker_id, blocked_id)
);

create or replace function public.users_blocked_for_viewer(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and p_user_id is not null
    and exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p_user_id)
         or (b.blocker_id = p_user_id and b.blocked_id = auth.uid())
    );
$$;
revoke all on function public.users_blocked_for_viewer(uuid) from public, anon;
grant execute on function public.users_blocked_for_viewer(uuid) to authenticated;

\ir ../migrations/0019_video_engagement.sql

-- Viewer 1 already likes video 1 from the 0013 fixture. Add three more likes,
-- a like on video 2, and a follower's like on video 4.
insert into public.video_likes(video_id, user_id) values
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003'),
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005'),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005');

insert into public.user_blocks values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004'
);

do $$
begin
  if has_function_privilege('anon','public.get_video_engagement(uuid[])','EXECUTE') then
    raise exception 'Anonymous role must not execute video engagement RPC';
  end if;
  if not has_function_privilege('authenticated','public.get_video_engagement(uuid[])','EXECUTE') then
    raise exception 'Authenticated role must execute video engagement RPC';
  end if;
end;
$$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$
declare
  first_likes bigint;
  first_liked boolean;
  second_likes bigint;
  second_liked boolean;
  visible_count integer;
  duplicate_count integer;
begin
  select likes_count, viewer_liked into first_likes, first_liked
  from public.get_video_engagement(array[
    '10000000-0000-0000-0000-000000000001'::uuid,
    '10000000-0000-0000-0000-000000000002'::uuid,
    '10000000-0000-0000-0000-000000000003'::uuid,
    '10000000-0000-0000-0000-000000000004'::uuid,
    '10000000-0000-0000-0000-000000000006'::uuid
  ])
  where video_id = '10000000-0000-0000-0000-000000000001';
  if first_likes <> 4 or first_liked is distinct from true then
    raise exception 'Expected video 1 to report four likes and viewer-liked=true; got %, %',
      first_likes, first_liked;
  end if;

  select likes_count, viewer_liked into second_likes, second_liked
  from public.get_video_engagement(array[
    '10000000-0000-0000-0000-000000000001'::uuid,
    '10000000-0000-0000-0000-000000000002'::uuid
  ])
  where video_id = '10000000-0000-0000-0000-000000000002';
  if second_likes <> 1 or second_liked is distinct from false then
    raise exception 'Expected video 2 to report one like and viewer-liked=false; got %, %',
      second_likes, second_liked;
  end if;

  select count(*) into visible_count
  from public.get_video_engagement(array[
    '10000000-0000-0000-0000-000000000001'::uuid,
    '10000000-0000-0000-0000-000000000002'::uuid,
    '10000000-0000-0000-0000-000000000003'::uuid,
    '10000000-0000-0000-0000-000000000004'::uuid,
    '10000000-0000-0000-0000-000000000006'::uuid
  ]);
  if visible_count <> 2 then
    raise exception 'Blocked, follower-only and private videos must not leak engagement metadata; got % rows',
      visible_count;
  end if;

  select count(*) into duplicate_count
  from public.get_video_engagement(array[
    '10000000-0000-0000-0000-000000000001'::uuid,
    '10000000-0000-0000-0000-000000000001'::uuid
  ]);
  if duplicate_count <> 1 then
    raise exception 'Duplicate request IDs must produce one engagement row; got %', duplicate_count;
  end if;

  if (select count(*) from public.get_video_engagement('{}'::uuid[])) <> 0 then
    raise exception 'An empty request must return no engagement rows';
  end if;

  begin
    perform * from public.get_video_engagement(array_fill(
      '10000000-0000-0000-0000-000000000001'::uuid, array[51]
    ));
    raise exception 'Oversized engagement requests must be rejected';
  exception when sqlstate '22023' then
    null;
  end;
end;
$$;
reset role;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
set role authenticated;
do $$
declare
  follower_likes bigint;
  follower_liked boolean;
begin
  select likes_count, viewer_liked into follower_likes, follower_liked
  from public.get_video_engagement(array[
    '10000000-0000-0000-0000-000000000004'::uuid
  ])
  where video_id = '10000000-0000-0000-0000-000000000004';
  if follower_likes <> 1 or follower_liked is distinct from true then
    raise exception 'An eligible follower should receive the follower-only video like state';
  end if;
end;
$$;
reset role;

select '0019 video engagement SQL checks passed' as result;

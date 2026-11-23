\set ON_ERROR_STOP on

-- Reuse the clean ranking fixture. Migration 0014 normally provides the block
-- helper; this isolated fixture defines its minimal equivalent for the RPC test.
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

\ir ../migrations/0017_personalized_video_feed_pagination.sql

-- Viewer 1 blocks creator 4. The paginated RPC must keep migration 0014's
-- mutual block filtering while returning all other eligible public videos.
insert into public.user_blocks values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000004'
);

insert into public.videos(id,user_id,caption,video_url,thumbnail_url,visibility,created_at)
select
  ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000002',
  'pagination fixture ' || n,
  'https://cdn.example/pagination/' || n || '.mp4',
  null,
  'public',
  now() - (n * interval '1 minute')
from generate_series(1,45) as fixture(n);

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$
declare
  page_one uuid[];
  page_two uuid[];
  page_three uuid[];
  default_page_count integer;
  negative_offset_count integer;
  capped_offset_count integer;
begin
  select array_agg(id) into page_one
  from public.get_personalized_video_feed(20, 0);
  select array_agg(id) into page_two
  from public.get_personalized_video_feed(20, 20);
  select array_agg(id) into page_three
  from public.get_personalized_video_feed(20, 40);

  if cardinality(page_one) <> 20 or cardinality(page_two) <> 20 then
    raise exception 'Expected two full 20-item pages; got %, %',
      cardinality(page_one), cardinality(page_two);
  end if;
  if cardinality(page_three) <> 8 then
    raise exception 'Expected 8 remaining eligible videos; got %', cardinality(page_three);
  end if;
  if page_one && page_two or page_one && page_three or page_two && page_three then
    raise exception 'Adjacent personalized feed pages must not overlap';
  end if;

  if page_one @> array['10000000-0000-0000-0000-000000000003'::uuid]
     or page_two @> array['10000000-0000-0000-0000-000000000003'::uuid]
     or page_three @> array['10000000-0000-0000-0000-000000000003'::uuid] then
    raise exception 'A creator blocked in either direction leaked into the feed';
  end if;

  select count(*) into default_page_count
  from public.get_personalized_video_feed(20);
  if default_page_count <> 20 then
    raise exception 'One-argument RPC compatibility should return the first page; got %',
      default_page_count;
  end if;

  select count(*) into negative_offset_count
  from public.get_personalized_video_feed(20, -10);
  if negative_offset_count <> 20 then
    raise exception 'Negative offsets should clamp to zero; got %', negative_offset_count;
  end if;

  select count(*) into capped_offset_count
  from public.get_personalized_video_feed(20, 999);
  if capped_offset_count <> 0 then
    raise exception 'Offsets beyond the 200-item cap should return no rows; got %',
      capped_offset_count;
  end if;

  if has_function_privilege('anon','public.get_personalized_video_feed(integer,integer)','EXECUTE') then
    raise exception 'Anonymous role must not execute the paginated feed RPC';
  end if;
  if not has_function_privilege('authenticated','public.get_personalized_video_feed(integer,integer)','EXECUTE') then
    raise exception 'Authenticated role must execute the paginated feed RPC';
  end if;
end;
$$;
reset role;

-- A different viewer who follows creator 4 and has no block must still see
-- that creator's follower-only story/video content.
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
set role authenticated;
do $$
begin
  if not exists (
    select 1 from public.get_personalized_video_feed(50, 0)
    where id = '10000000-0000-0000-0000-000000000004'
  ) then
    raise exception 'Follower should retain access to follower-only video';
  end if;
end;
$$;
reset role;

select '0017 personalized video feed pagination checks passed' as result;

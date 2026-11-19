\set ON_ERROR_STOP on

-- Isolated PostgreSQL fixture for video reporting and block enforcement.
create role anon noinherit;
create role authenticated noinherit;
create role service_role noinherit;
create schema auth;
create function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;

create table public.profiles (
  id uuid primary key,
  username text not null,
  avatar_url text
);
create table public.follows (
  follower_id uuid not null,
  following_id uuid not null,
  primary key (follower_id, following_id)
);
create table public.videos (
  id uuid primary key,
  user_id uuid not null,
  caption text,
  video_url text not null,
  thumbnail_url text,
  visibility text not null,
  created_at timestamptz not null
);
create table public.video_likes (
  video_id uuid not null,
  user_id uuid not null,
  primary key (video_id, user_id)
);
create table public.video_views (
  id uuid primary key,
  video_id uuid not null,
  user_id uuid,
  watch_seconds integer not null,
  completed boolean not null,
  created_at timestamptz not null
);
create table public.comments (
  id uuid primary key,
  video_id uuid not null,
  user_id uuid not null,
  body text not null
);
create table public.snaps (
  id uuid primary key,
  user_id uuid not null,
  expires_at timestamptz not null
);

alter table public.profiles enable row level security;
alter table public.videos enable row level security;
alter table public.snaps enable row level security;
alter table public.comments enable row level security;
alter table public.video_likes enable row level security;

grant select on public.profiles, public.videos, public.snaps,
  public.comments, public.video_likes to authenticated;
create policy "Profiles are viewable by signed-in users"
  on public.profiles for select to authenticated using (true);
create policy "Public videos and own videos readable"
  on public.videos for select to authenticated
  using (visibility = 'public' or user_id = auth.uid()
    or (visibility = 'followers' and exists (
      select 1 from public.follows f
      where f.follower_id = auth.uid() and f.following_id = user_id
    )));
create policy "Users see unexpired snaps and own snaps"
  on public.snaps for select to authenticated
  using (expires_at > now() and (user_id = auth.uid() or exists (
    select 1 from public.follows f
    where f.follower_id = auth.uid() and f.following_id = user_id
  )));
create policy "Comments readable"
  on public.comments for select to authenticated using (true);
create policy "Likes readable"
  on public.video_likes for select to authenticated using (true);

\ir ../migrations/0013_personalized_video_feed.sql
\ir ../migrations/0014_video_safety_controls.sql

insert into public.profiles(id, username, avatar_url) values
  ('00000000-0000-0000-0000-000000000001', 'viewer', null),
  ('00000000-0000-0000-0000-000000000002', 'outgoing_block', null),
  ('00000000-0000-0000-0000-000000000003', 'incoming_block', null),
  ('00000000-0000-0000-0000-000000000004', 'safe_creator', null);

insert into public.follows values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004');

insert into public.videos(id,user_id,caption,video_url,thumbnail_url,visibility,created_at) values
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','outgoing blocked','https://cdn.example/1.mp4',null,'public',now()),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','incoming blocked','https://cdn.example/2.mp4',null,'public',now()),
  ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','safe report target','https://cdn.example/3.mp4',null,'public',now()),
  ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','own video','https://cdn.example/4.mp4',null,'public',now()),
  ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000004','private target','https://cdn.example/5.mp4',null,'private',now());

insert into public.comments values
  ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','blocked comment'),
  ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','visible comment');
insert into public.video_likes values
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004'),
  ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004');
insert into public.snaps values
  ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',now()+interval '1 hour'),
  ('40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',now()+interval '1 hour'),
  ('40000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004',now()+interval '1 hour');

-- Simulate the other creator having blocked the viewer before this viewer blocks them.
insert into public.user_blocks(blocker_id, blocked_id)
values ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001');

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;

do $$
declare
  report_one uuid;
  report_two uuid;
  feed_ids uuid[];
  row_count integer;
begin
  if not public.block_user('00000000-0000-0000-0000-000000000002') then
    raise exception 'block_user should confirm a block';
  end if;
  perform public.block_user('00000000-0000-0000-0000-000000000002');

  if exists (
    select 1 from public.follows
    where (follower_id='00000000-0000-0000-0000-000000000001' and following_id='00000000-0000-0000-0000-000000000002')
       or (follower_id='00000000-0000-0000-0000-000000000002' and following_id='00000000-0000-0000-0000-000000000001')
  ) then
    raise exception 'Blocking must remove both follow directions';
  end if;

  if not public.users_blocked_for_viewer('00000000-0000-0000-0000-000000000002')
     or not public.users_blocked_for_viewer('00000000-0000-0000-0000-000000000003') then
    raise exception 'Block checks must work in both directions';
  end if;

  select array_agg(id) into feed_ids
  from public.get_personalized_video_feed(20);
  if array_position(feed_ids,'10000000-0000-0000-0000-000000000001') is not null
     or array_position(feed_ids,'10000000-0000-0000-0000-000000000002') is not null then
    raise exception 'Personalized feed leaked a blocked creator';
  end if;
  if array_position(feed_ids,'10000000-0000-0000-0000-000000000003') is null
     or array_position(feed_ids,'10000000-0000-0000-0000-000000000004') is null then
    raise exception 'Feed should retain safe public videos and the viewer own video';
  end if;

  select count(*) into row_count from public.videos
  where user_id in (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003'
  );
  if row_count <> 0 then
    raise exception 'Videos RLS must hide both directions of a block';
  end if;

  if not exists (select 1 from public.profiles where id='00000000-0000-0000-0000-000000000002')
     or exists (select 1 from public.profiles where id='00000000-0000-0000-0000-000000000003') then
    raise exception 'Profile RLS should keep the own block list identifiable but hide inbound blocks';
  end if;

  select count(*) into row_count from public.snaps
  where user_id in (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003'
  );
  if row_count <> 0 then
    raise exception 'Snap RLS must hide blocked creators';
  end if;

  select count(*) into row_count from public.comments
  where video_id='10000000-0000-0000-0000-000000000001';
  if row_count <> 0 then
    raise exception 'Comments on blocked videos must be hidden';
  end if;

  select count(*) into row_count from public.video_likes
  where video_id='10000000-0000-0000-0000-000000000001';
  if row_count <> 0 then
    raise exception 'Likes on blocked videos must be hidden';
  end if;

  select count(*) into row_count from public.user_blocks;
  if row_count <> 1 then
    raise exception 'The block list must show only the viewer outgoing block';
  end if;
  if has_table_privilege('authenticated','public.user_blocks','INSERT')
     or has_table_privilege('authenticated','public.user_blocks','DELETE') then
    raise exception 'Clients must not write block rows directly';
  end if;

  -- A block must also prevent direct API attempts to follow the other account.
  begin
    insert into public.follows values (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002'
    );
    raise exception 'Expected follow trigger to reject an active block';
  exception when check_violation then
    null;
  end;

  report_one := public.report_video(
    '10000000-0000-0000-0000-000000000003',
    'harassment',
    'A concise report detail'
  );
  report_two := public.report_video(
    '10000000-0000-0000-0000-000000000003',
    'spam',
    null
  );
  if report_one <> report_two then
    raise exception 'A repeated report must be idempotent per viewer/video';
  end if;

  begin
    perform public.report_video('10000000-0000-0000-0000-000000000004','spam',null);
    raise exception 'Expected own-video report to be rejected';
  exception when raise_exception then
    if sqlerrm = 'Expected own-video report to be rejected' then raise; end if;
  end;

  begin
    perform public.report_video('10000000-0000-0000-0000-000000000005','spam',null);
    raise exception 'Expected private-video report to be rejected';
  exception when raise_exception then
    if sqlerrm = 'Expected private-video report to be rejected' then raise; end if;
  end;

  begin
    perform public.report_video('10000000-0000-0000-0000-000000000003','invalid',null);
    raise exception 'Expected invalid report reason to be rejected';
  exception when raise_exception then
    if sqlerrm = 'Expected invalid report reason to be rejected' then raise; end if;
  end;

  if has_table_privilege('authenticated','public.video_reports','SELECT') then
    raise exception 'Mobile clients must not read the moderation report table';
  end if;
  if not has_table_privilege('service_role','public.video_reports','SELECT') then
    raise exception 'Trusted service role must be able to review reports';
  end if;
end;
$$;

reset role;

do $$
declare
  report_count integer;
begin
  select count(*) into report_count from public.video_reports
  where reporter_id='00000000-0000-0000-0000-000000000001'
    and video_id='10000000-0000-0000-0000-000000000003'
    and status='pending';
  if report_count <> 1 then
    raise exception 'Expected one private pending report row';
  end if;
end;
$$;

set role authenticated;
do $$
begin
  if not public.unblock_user('00000000-0000-0000-0000-000000000002') then
    raise exception 'Expected outgoing block to be removable';
  end if;
  if public.users_blocked_for_viewer('00000000-0000-0000-0000-000000000002') then
    raise exception 'Unblocking should remove the viewer initiated block';
  end if;
  if not public.users_blocked_for_viewer('00000000-0000-0000-0000-000000000003') then
    raise exception 'Unblocking must not remove the other account block';
  end if;
  if not exists (
    select 1 from public.get_personalized_video_feed(20)
    where id='10000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'Unblocked public creator should return to the feed';
  end if;
end;
$$;
reset role;

do $$
begin
  if has_function_privilege('anon','public.block_user(uuid)','EXECUTE')
     or has_function_privilege('anon','public.unblock_user(uuid)','EXECUTE')
     or has_function_privilege('anon','public.report_video(uuid,text,text)','EXECUTE') then
    raise exception 'Anonymous users must not execute safety RPCs';
  end if;
  if not has_function_privilege('authenticated','public.block_user(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.report_video(uuid,text,text)','EXECUTE') then
    raise exception 'Authenticated users must execute the approved safety RPCs';
  end if;
end;
$$;

select '0014 video safety SQL checks passed' as result;

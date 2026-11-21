\set ON_ERROR_STOP on

-- Minimal PostgreSQL fixture for migration 0013; no Supabase project or secrets needed.
create role anon noinherit;
create role authenticated noinherit;
create schema auth;
create function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;

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

\ir ../migrations/0013_personalized_video_feed.sql

insert into public.profiles(id, username, avatar_url) values
  ('00000000-0000-0000-0000-000000000001', 'viewer', null),
  ('00000000-0000-0000-0000-000000000002', 'followed_creator', null),
  ('00000000-0000-0000-0000-000000000003', 'watch_affinity_creator', null),
  ('00000000-0000-0000-0000-000000000004', 'unseen_creator', null),
  ('00000000-0000-0000-0000-000000000005', 'second_viewer', null);

insert into public.follows values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000004');

insert into public.videos(id,user_id,caption,video_url,thumbnail_url,visibility,created_at) values
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','followed + liked + watched','https://cdn.example/1.mp4',null,'public',now()-interval '1 hour'),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','creator affinity','https://cdn.example/2.mp4',null,'public',now()-interval '2 hours'),
  ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','unseen','https://cdn.example/3.mp4',null,'public',now()-interval '10 minutes'),
  ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004','followers only','https://cdn.example/4.mp4',null,'followers',now()-interval '5 minutes'),
  ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000003','watched history','https://cdn.example/5.mp4',null,'public',now()-interval '3 days'),
  ('10000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000004','private','https://cdn.example/6.mp4',null,'private',now()-interval '5 minutes');

insert into public.video_likes values
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
insert into public.video_views(id,video_id,user_id,watch_seconds,completed,created_at) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',45,true,now()),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001',120,true,now());

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$
declare
  top_video uuid;
  feed_ids uuid[];
  result_count integer;
begin
  select id into top_video from public.get_personalized_video_feed(10) limit 1;
  if top_video <> '10000000-0000-0000-0000-000000000001' then
    raise exception 'Expected followed, liked and watched video to rank first; got %', top_video;
  end if;

  select array_agg(id order by ordinality) into feed_ids
  from public.get_personalized_video_feed(10) with ordinality
    as feed(id,user_id,caption,video_url,thumbnail_url,created_at,username,avatar_url,ordinality);
  if array_position(feed_ids,'10000000-0000-0000-0000-000000000002') >
     array_position(feed_ids,'10000000-0000-0000-0000-000000000003') then
    raise exception 'Creator watch affinity should outrank an unseen creator';
  end if;
  if array_position(feed_ids,'10000000-0000-0000-0000-000000000004') is not null then
    raise exception 'Follower-only video leaked to a non-follower';
  end if;
  if array_position(feed_ids,'10000000-0000-0000-0000-000000000006') is not null then
    raise exception 'Private video leaked into the feed';
  end if;

  select count(*) into result_count from public.get_personalized_video_feed(0);
  if result_count <> 1 then
    raise exception 'Feed limit should clamp to at least one row; got %', result_count;
  end if;
end;
$$;
reset role;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
set role authenticated;
do $$
begin
  if not exists (
    select 1 from public.get_personalized_video_feed(20)
    where id = '10000000-0000-0000-0000-000000000004'
  ) then
    raise exception 'Follower should see follower-only video';
  end if;
end;
$$;
reset role;

do $$
begin
  if has_function_privilege('anon','public.get_personalized_video_feed(integer)','EXECUTE') then
    raise exception 'Anonymous role must not execute personalized feed RPC';
  end if;
  if not has_function_privilege('authenticated','public.get_personalized_video_feed(integer)','EXECUTE') then
    raise exception 'Authenticated role must be able to execute feed RPC';
  end if;
end;
$$;

select '0013 personalized video feed SQL checks passed' as result;

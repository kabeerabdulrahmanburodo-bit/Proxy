-- Video safety controls: private reports, viewer-scoped blocks and server-side feed filtering.
-- Blocking is mutual for content visibility but does not delete existing conversations.

create table if not exists public.user_blocks (
  blocker_id uuid not null,
  blocked_id uuid not null,
  created_at timestamptz not null default now(),
  constraint user_blocks_pkey primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id),
  constraint user_blocks_blocker_id_fkey foreign key (blocker_id)
    references public.profiles(id) on delete cascade,
  constraint user_blocks_blocked_id_fkey foreign key (blocked_id)
    references public.profiles(id) on delete cascade
);
create index if not exists user_blocks_blocked_id_idx
  on public.user_blocks(blocked_id, blocker_id);

alter table public.user_blocks enable row level security;
drop policy if exists "Read own outgoing blocks" on public.user_blocks;
create policy "Read own outgoing blocks"
  on public.user_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

revoke all on table public.user_blocks from public, anon, authenticated;
grant select on table public.user_blocks to authenticated;

-- A viewer can check only whether the target and the current viewer have a
-- block relationship; no arbitrary pair of users can be queried.
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
      select 1
      from public.user_blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p_user_id)
         or (b.blocker_id = p_user_id and b.blocked_id = auth.uid())
    );
$$;
revoke all on function public.users_blocked_for_viewer(uuid) from public, anon;
grant execute on function public.users_blocked_for_viewer(uuid) to authenticated;

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

  insert into public.user_blocks(blocker_id, blocked_id)
  values (requester_id, p_user_id)
  on conflict (blocker_id, blocked_id) do nothing;

  -- Remove both follow directions. Unblocking never silently restores follows.
  delete from public.follows
  where (follower_id = requester_id and following_id = p_user_id)
     or (follower_id = p_user_id and following_id = requester_id);

  return true;
end;
$$;
revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

create or replace function public.unblock_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'Invalid account';
  end if;

  delete from public.user_blocks
  where blocker_id = auth.uid() and blocked_id = p_user_id;
  get diagnostics removed_count = row_count;
  return removed_count > 0;
end;
$$;
revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;

-- Enforce the block relationship even if a client bypasses the app's follow UI.
create or replace function public.prevent_follow_between_blocked_users()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = new.follower_id and b.blocked_id = new.following_id)
       or (b.blocker_id = new.following_id and b.blocked_id = new.follower_id)
  ) then
    raise exception 'Following is unavailable while a block is active'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_follow_between_blocked_users() from public, anon, authenticated;
drop trigger if exists prevent_follow_between_blocked_users on public.follows;
create trigger prevent_follow_between_blocked_users
  before insert or update of follower_id, following_id on public.follows
  for each row execute function public.prevent_follow_between_blocked_users();

-- Reports are intentionally not readable or writable by mobile clients.
-- The authenticated report_video RPC is the only client write path; review is
-- reserved for a future trusted moderation console/service role.
create table if not exists public.video_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  reason text not null check (reason in (
    'spam', 'harassment', 'hate', 'nudity', 'violence', 'copyright', 'other'
  )),
  details text check (details is null or char_length(details) <= 500),
  status text not null default 'pending'
    check (status in ('pending', 'reviewed', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  constraint video_reports_reporter_video_key unique (reporter_id, video_id)
);
create index if not exists video_reports_status_created_idx
  on public.video_reports(status, created_at);
create index if not exists video_reports_video_idx
  on public.video_reports(video_id);

alter table public.video_reports enable row level security;
revoke all on table public.video_reports from public, anon, authenticated;
grant all on table public.video_reports to service_role;

create or replace function public.report_video(
  p_video_id uuid,
  p_reason text,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requester_id uuid := auth.uid();
  video_owner uuid;
  report_id uuid;
  clean_details text := nullif(btrim(p_details), '');
begin
  if requester_id is null then
    raise exception 'Authentication required';
  end if;
  if p_video_id is null then
    raise exception 'A video is required';
  end if;
  if p_reason is null or p_reason not in (
    'spam', 'harassment', 'hate', 'nudity', 'violence', 'copyright', 'other'
  ) then
    raise exception 'Choose a valid report reason';
  end if;
  if char_length(coalesce(clean_details, '')) > 500 then
    raise exception 'Report details must be 500 characters or fewer';
  end if;

  select v.user_id into video_owner
  from public.videos v
  where v.id = p_video_id
    and (
      v.visibility = 'public'
      or (
        v.visibility = 'followers'
        and exists (
          select 1 from public.follows f
          where f.follower_id = requester_id and f.following_id = v.user_id
        )
      )
    );

  if not found then
    raise exception 'This video is unavailable for reporting';
  end if;
  if video_owner = requester_id then
    raise exception 'You cannot report your own video';
  end if;
  if public.users_blocked_for_viewer(video_owner) then
    raise exception 'This video is unavailable for reporting';
  end if;

  insert into public.video_reports(reporter_id, video_id, reason, details)
  values (requester_id, p_video_id, p_reason, clean_details)
  on conflict (reporter_id, video_id) do nothing;

  select r.id into report_id
  from public.video_reports r
  where r.reporter_id = requester_id and r.video_id = p_video_id;

  return report_id;
end;
$$;
revoke all on function public.report_video(uuid, text, text) from public, anon;
grant execute on function public.report_video(uuid, text, text) to authenticated;

-- Hide blocked profiles from discovery, while still allowing the blocker to
-- identify/remove their own outgoing blocks in Profile settings.
drop policy if exists "Profiles are viewable by signed-in users" on public.profiles;
create policy "Profiles are viewable unless blocked"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or not public.users_blocked_for_viewer(id)
    or exists (
      select 1 from public.user_blocks b
      where b.blocker_id = (select auth.uid()) and b.blocked_id = id
    )
  );

drop policy if exists "Public videos and own videos readable" on public.videos;
create policy "Public videos and own videos readable"
  on public.videos for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      not public.users_blocked_for_viewer(user_id)
      and (
        visibility = 'public'
        or (
          visibility = 'followers'
          and exists (
            select 1 from public.follows f
            where f.follower_id = (select auth.uid())
              and f.following_id = user_id
          )
        )
      )
    )
  );

drop policy if exists "Users see unexpired snaps and own snaps" on public.snaps;
create policy "Users see unexpired snaps and own snaps"
  on public.snaps for select to authenticated
  using (
    expires_at > now()
    and (
      user_id = (select auth.uid())
      or (
        not public.users_blocked_for_viewer(user_id)
        and exists (
          select 1 from public.follows f
          where f.follower_id = (select auth.uid())
            and f.following_id = user_id
        )
      )
    )
  );

-- Comments and likes are visible only when their parent video is visible.
drop policy if exists "Comments readable" on public.comments;
create policy "Comments readable for visible videos"
  on public.comments for select to authenticated
  using (exists (
    select 1 from public.videos v where v.id = comments.video_id
  ));

drop policy if exists "Likes readable" on public.video_likes;
create policy "Likes readable for visible videos"
  on public.video_likes for select to authenticated
  using (exists (
    select 1 from public.videos v where v.id = video_likes.video_id
  ));

-- Keep the personalized feed's existing contract while filtering both directions
-- of a block relationship inside the SECURITY DEFINER query.
create or replace function public.get_personalized_video_feed(p_limit integer default 20)
returns table (
  id uuid,
  user_id uuid,
  caption text,
  video_url text,
  thumbnail_url text,
  created_at timestamptz,
  username text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with viewer as (
    select auth.uid() as user_id
  ),
  requested as (
    select least(greatest(coalesce(p_limit, 20), 1), 50) as feed_limit
  ),
  candidates as (
    select
      v.id,
      v.user_id,
      v.caption,
      v.video_url,
      v.thumbnail_url,
      v.created_at,
      p.username,
      p.avatar_url,
      (f.following_id is not null) as creator_followed,
      (liked.user_id is not null) as viewer_liked,
      coalesce(video_stats.watch_seconds, 0)::double precision as video_watch_seconds,
      coalesce(video_stats.completions, 0)::bigint as video_completions,
      coalesce(creator_stats.watch_seconds, 0)::double precision as creator_watch_seconds,
      coalesce(creator_stats.completions, 0)::bigint as creator_completions,
      coalesce(creator_stats.watched_videos, 0)::bigint as creator_watched_videos
    from public.videos v
    join viewer on viewer.user_id is not null
    left join public.profiles p on p.id = v.user_id
    left join public.follows f
      on f.follower_id = viewer.user_id and f.following_id = v.user_id
    left join public.video_likes liked
      on liked.video_id = v.id and liked.user_id = viewer.user_id
    left join lateral (
      select
        coalesce(sum(vv.watch_seconds), 0) as watch_seconds,
        count(*) filter (where vv.completed) as completions
      from public.video_views vv
      where vv.user_id = viewer.user_id and vv.video_id = v.id
    ) video_stats on true
    left join lateral (
      select
        coalesce(sum(vv.watch_seconds), 0) as watch_seconds,
        count(*) filter (where vv.completed) as completions,
        count(distinct vv.video_id) as watched_videos
      from public.video_views vv
      join public.videos watched on watched.id = vv.video_id
      where vv.user_id = viewer.user_id and watched.user_id = v.user_id
    ) creator_stats on true
    where
      v.visibility in ('public', 'followers')
      and (
        v.visibility = 'public'
        or v.user_id = viewer.user_id
        or f.following_id is not null
      )
      and (
        v.user_id = viewer.user_id
        or not public.users_blocked_for_viewer(v.user_id)
      )
    order by v.created_at desc
    limit (select feed_limit * 5 from requested)
  ),
  scored as (
    select
      candidates.*,
      (
        case when creator_followed then 2.25 else 0 end
        + case when viewer_liked then 1.25 else 0 end
        + least(video_watch_seconds / 30.0, 1.25)
        + least(creator_watch_seconds / 120.0, 0.75)
        + least(video_completions, 2) * 0.5
        + least(creator_completions, 3) * 0.15
        + greatest(
            0.0,
            1.5 - (extract(epoch from (now() - created_at)) / 86400.0 * 1.5)
          )
        + case when video_watch_seconds = 0 then 0.35 else -0.25 end
      )::double precision as base_score
    from candidates
  ),
  diversified as (
    select
      scored.*,
      row_number() over (
        partition by user_id
        order by base_score desc, created_at desc
      ) as creator_position
    from scored
  )
  select
    diversified.id,
    diversified.user_id,
    diversified.caption,
    diversified.video_url,
    diversified.thumbnail_url,
    diversified.created_at,
    diversified.username,
    diversified.avatar_url
  from diversified
  order by
    (base_score - ((creator_position - 1)::double precision * 0.45)) desc,
    created_at desc
  limit (select feed_limit from requested);
$$;

revoke all on function public.get_personalized_video_feed(integer) from public;
revoke execute on function public.get_personalized_video_feed(integer) from anon;
grant execute on function public.get_personalized_video_feed(integer) to authenticated;

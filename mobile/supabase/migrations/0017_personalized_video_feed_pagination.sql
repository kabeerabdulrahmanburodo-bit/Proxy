-- Add bounded offset pagination as a separate RPC overload.
-- Keeping the original one-argument function allows older app builds and
-- PostgREST schema caches to continue using the existing first-page endpoint.
-- Candidate and offset limits bound work to the newest 1,250 eligible videos.
-- Personalized video ranking based on the viewer's own watch history and follows.
-- This SECURITY DEFINER RPC returns only videos the signed-in viewer is allowed to see.
create index if not exists video_views_user_video_created_idx
  on public.video_views(user_id, video_id, created_at desc);
create index if not exists videos_visibility_created_idx
  on public.videos(visibility, created_at desc);

create function public.get_personalized_video_feed(p_limit integer, p_offset integer)
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
    select
      least(greatest(coalesce(p_limit, 20), 1), 50) as feed_limit,
      least(greatest(coalesce(p_offset, 0), 0), 200) as feed_offset
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
    order by v.created_at desc, v.id asc
    limit (select (feed_limit + feed_offset) * 5 from requested)
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
        order by base_score desc, created_at desc, id asc
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
    created_at desc,
    id asc
  limit (select feed_limit from requested)
  offset (select feed_offset from requested);
$$;

revoke all on function public.get_personalized_video_feed(integer, integer) from public;
revoke execute on function public.get_personalized_video_feed(integer, integer) from anon;
grant execute on function public.get_personalized_video_feed(integer, integer) to authenticated;

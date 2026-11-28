-- Batched viewer-scoped engagement data for the vertical video feed.
-- Counts are returned only for requested videos the authenticated viewer may access.
create or replace function public.get_video_engagement(p_video_ids uuid[])
returns table (
  video_id uuid,
  likes_count bigint,
  viewer_liked boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  viewer_id uuid := auth.uid();
begin
  if viewer_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_video_ids), 0) > 50 then
    raise exception 'At most 50 video IDs may be requested at once'
      using errcode = '22023';
  end if;

  return query
  select
    v.id,
    (
      select count(*)::bigint
      from public.video_likes likes
      where likes.video_id = v.id
    ) as likes_count,
    exists (
      select 1
      from public.video_likes likes
      where likes.video_id = v.id
        and likes.user_id = viewer_id
    ) as viewer_liked
  from public.videos v
  where v.id = any(coalesce(p_video_ids, '{}'::uuid[]))
    and (
      v.user_id = viewer_id
      or (
        not public.users_blocked_for_viewer(v.user_id)
        and (
          v.visibility = 'public'
          or (
            v.visibility = 'followers'
            and exists (
              select 1
              from public.follows f
              where f.follower_id = viewer_id
                and f.following_id = v.user_id
            )
          )
        )
      )
    );
end;
$$;

revoke all on function public.get_video_engagement(uuid[]) from public, anon;
grant execute on function public.get_video_engagement(uuid[]) to authenticated;

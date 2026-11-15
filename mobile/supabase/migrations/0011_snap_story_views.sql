-- Record a Snap view only when the viewer can currently access that active story.
-- This prevents authenticated users from creating view rows for private/unfollowed or expired Snaps.
drop policy if exists "Record own snap views" on public.snap_views;
drop policy if exists "Record views of visible active snaps" on public.snap_views;

create policy "Record views of visible active snaps"
  on public.snap_views
  for insert
  to authenticated
  with check (
    viewer_id = (select auth.uid())
    and exists (
      select 1
      from public.snaps s
      where s.id = snap_views.snap_id
        and s.expires_at > now()
        and (
          s.user_id = (select auth.uid())
          or exists (
            select 1
            from public.follows f
            where f.follower_id = (select auth.uid())
              and f.following_id = s.user_id
          )
        )
    )
  );

create index if not exists snaps_user_expiry_created_idx
  on public.snaps(user_id, expires_at, created_at);

-- The existing primary key makes each viewer count at most once per Snap.
-- The existing SELECT policy still limits audience lists to the owner or viewer.

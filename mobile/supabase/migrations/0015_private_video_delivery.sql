-- Private feed-video delivery.
-- Existing same-project public Storage URLs become owner-scoped object paths.
-- Unknown/external or owner-mismatched legacy media is retained but made private
-- so it cannot keep appearing in a feed without an enforceable Storage policy.

update public.videos
set video_url = regexp_replace(
  video_url,
  '^https?://[A-Za-z0-9-]+\.supabase\.co/storage/v1/object/public/videos/',
  '',
  'i'
)
where video_url ~* '^https?://[A-Za-z0-9-]+\.supabase\.co/storage/v1/object/public/videos/[A-Za-z0-9._/-]+$';

update public.videos
set visibility = 'private'
where video_url !~ ('^' || user_id::text || '/[A-Za-z0-9._-]{1,120}$');

create index if not exists videos_video_url_idx
  on public.videos(video_url);

-- New and changed media references must remain inside the uploader's folder.
-- Caption/visibility edits on retained legacy rows do not rewrite the old path.
create or replace function public.enforce_video_object_path()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.video_url !~ ('^' || new.user_id::text || '/[A-Za-z0-9._-]{1,120}$') then
    raise exception 'Video media must use an owner-scoped Storage object path'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_video_object_path() from public, anon, authenticated;
drop trigger if exists enforce_video_object_path on public.videos;
create trigger enforce_video_object_path
  before insert or update of video_url, user_id on public.videos
  for each row execute function public.enforce_video_object_path();

-- Stop anonymous/public object delivery. Upload and owner-delete policies from
-- migration 0001 remain in place; this policy only controls reads.
update storage.buckets
set public = false
where id = 'videos';

drop policy if exists "Public can read videos" on storage.objects;
drop policy if exists "Authorized viewers can read video objects" on storage.objects;
create policy "Authorized viewers can read video objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'videos'
    and (
      -- The owner may verify/resume an upload before its videos row is finalized.
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1
        from public.videos v
        where v.video_url = storage.objects.name
          and (
            v.user_id = (select auth.uid())
            or (
              not public.users_blocked_for_viewer(v.user_id)
              and (
                v.visibility = 'public'
                or (
                  v.visibility = 'followers'
                  and exists (
                    select 1
                    from public.follows f
                    where f.follower_id = (select auth.uid())
                      and f.following_id = v.user_id
                  )
                )
              )
            )
          )
      )
    )
  );

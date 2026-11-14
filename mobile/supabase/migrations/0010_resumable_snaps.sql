-- Snap media is stored as a private Storage object path, not as a signed bearer URL.
-- Followers may read the object only while its matching snap row is visible under snaps RLS.

update storage.buckets
set public = false,
    file_size_limit = 104857600,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'video/mp4',
      'video/quicktime'
    ]
where id = 'snaps';

create index if not exists snaps_media_url_idx
  on public.snaps(media_url);

-- New snap rows must reference a file in the owner's top-level Storage folder.
-- Existing legacy rows containing signed URLs remain readable until they expire,
-- but new or edited rows cannot introduce external URLs or another user's paths.
create or replace function public.validate_snap_object_path()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.media_url ~* '^https?://' then
    raise exception 'Snap media must be stored in the private snaps bucket';
  end if;

  if new.media_url !~ ('^' || new.user_id::text || '/[A-Za-z0-9._-]+$') then
    raise exception 'Snap media path must be inside the owner's Storage folder';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_snap_object_path_before_write on public.snaps;
create trigger validate_snap_object_path_before_write
  before insert or update of media_url, user_id
  on public.snaps
  for each row
  execute function public.validate_snap_object_path();

-- Keep owner access so the uploader can verify an object after a TUS upload
-- but before the snaps row is inserted. Other users need a visible, unexpired
-- snap row; the public.snaps SELECT RLS policy limits that to the owner/followers.
drop policy if exists "Owners read own snaps" on storage.objects;
drop policy if exists "Owners and followers read active snap media" on storage.objects;
create policy "Owners and followers read active snap media"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'snaps'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or exists (
        select 1
        from public.snaps s
        where s.media_url = storage.objects.name
      )
    )
  );

-- Upload and delete policies from 0001 remain scoped to the authenticated
-- owner's first path segment. The bucket stays private; no anon read policy is added.

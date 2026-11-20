\\set ON_ERROR_STOP on

-- Reuse the full block/report fixture, then add Storage RLS coverage.
\\ir 0014_video_safety_controls.sql

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  bucket_id text not null,
  name text not null,
  primary key (bucket_id, name)
);
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select case
    when position('/' in name) > 0
      then string_to_array(regexp_replace(name, '/[^/]*$', ''), '/')
    else array[]::text[]
  end;
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets, storage.objects to anon, authenticated, service_role;
grant insert, delete on storage.objects to authenticated;
alter table storage.objects enable row level security;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 524288000, array['video/mp4','video/quicktime','video/webm']);

create policy "Public can read videos"
  on storage.objects for select to public
  using (bucket_id = 'videos');
create policy "Authenticated users upload own videos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "Owners delete own videos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

insert into public.profiles(id, username, avatar_url)
values ('00000000-0000-0000-0000-000000000005', 'outsider', null);

insert into public.videos(id,user_id,caption,video_url,thumbnail_url,visibility,created_at) values
  ('10000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000004','public','00000000-0000-0000-0000-000000000004/public.mp4',null,'public',now()),
  ('10000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000004','followers','00000000-0000-0000-0000-000000000004/followers.mp4',null,'followers',now()),
  ('10000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000002','blocked outgoing','00000000-0000-0000-0000-000000000002/blocked-out.mp4',null,'public',now()),
  ('10000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000003','blocked incoming','00000000-0000-0000-0000-000000000003/blocked-in.mp4',null,'public',now()),
  ('10000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','owner private','00000000-0000-0000-0000-000000000001/own-private.mp4',null,'private',now()),
  ('10000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000004','legacy supabase url','https://project-ref.supabase.co/storage/v1/object/public/videos/00000000-0000-0000-0000-000000000004/legacy.mp4',null,'public',now()),
  ('10000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000004','external legacy url','https://cdn.example/legacy.mp4',null,'public',now()),
  ('10000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000004','mismatched owner path','00000000-0000-0000-0000-000000000002/mismatch.mp4',null,'public',now()),
  ('10000000-0000-0000-0000-000000000016','00000000-0000-0000-0000-000000000004','external URL mimics Storage path','https://cdn.example/storage/v1/object/public/videos/00000000-0000-0000-0000-000000000004/spoof.mp4',null,'public',now());

insert into storage.objects(bucket_id,name) values
  ('videos','00000000-0000-0000-0000-000000000004/public.mp4'),
  ('videos','00000000-0000-0000-0000-000000000004/followers.mp4'),
  ('videos','00000000-0000-0000-0000-000000000002/blocked-out.mp4'),
  ('videos','00000000-0000-0000-0000-000000000003/blocked-in.mp4'),
  ('videos','00000000-0000-0000-0000-000000000001/own-private.mp4'),
  ('videos','00000000-0000-0000-0000-000000000001/pending.mp4'),
  ('videos','00000000-0000-0000-0000-000000000004/legacy.mp4'),
  ('videos','00000000-0000-0000-0000-000000000004/unpublished.mp4');

\\ir ../migrations/0015_private_video_delivery.sql

do $$
begin
  if (select public from storage.buckets where id='videos') then
    raise exception 'The videos bucket must be private';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='Public can read videos'
  ) then
    raise exception 'The public video read policy must be removed';
  end if;
  if (select video_url from public.videos where id='10000000-0000-0000-0000-000000000011')
      <> '00000000-0000-0000-0000-000000000004/legacy.mp4' then
    raise exception 'Same-project legacy public URL was not normalized';
  end if;
  if (select visibility from public.videos where id='10000000-0000-0000-0000-000000000012')
      <> 'private' then
    raise exception 'Unknown external legacy URL must be hidden pending re-upload';
  end if;
  if (select visibility from public.videos where id='10000000-0000-0000-0000-000000000013')
      <> 'private' then
    raise exception 'Owner-mismatched media path must be hidden';
  end if;
  if (select visibility from public.videos where id='10000000-0000-0000-0000-000000000016')
      <> 'private' then
    raise exception 'A non-Supabase host mimicking the public Storage path must remain private';
  end if;
end;
$$;

-- A new video row cannot point at an external URL or another user's folder.
do $$
begin
  begin
    insert into public.videos(id,user_id,caption,video_url,visibility,created_at)
    values ('10000000-0000-0000-0000-000000000014',
      '00000000-0000-0000-0000-000000000001','invalid',
      'https://cdn.example/unsafe.mp4','public',now());
    raise exception 'Expected external video URL to be rejected';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.videos(id,user_id,caption,video_url,visibility,created_at)
    values ('10000000-0000-0000-0000-000000000015',
      '00000000-0000-0000-0000-000000000001','invalid',
      '00000000-0000-0000-0000-000000000002/other.mp4','public',now());
    raise exception 'Expected foreign owner path to be rejected';
  exception when check_violation then
    null;
  end;
end;
$$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$
begin
  if not exists (select 1 from storage.objects where bucket_id='videos' and name='00000000-0000-0000-0000-000000000004/public.mp4') then
    raise exception 'Authenticated users should read public video objects';
  end if;
  if not exists (select 1 from storage.objects where bucket_id='videos' and name='00000000-0000-0000-0000-000000000004/followers.mp4') then
    raise exception 'Followers should read follower-only video objects';
  end if;
  if exists (select 1 from storage.objects where bucket_id='videos' and name='00000000-0000-0000-0000-000000000002/blocked-out.mp4') then
    raise exception 'Outgoing blocked creator object must be hidden';
  end if;
  if exists (select 1 from storage.objects where bucket_id='videos' and name='00000000-0000-0000-0000-000000000003/blocked-in.mp4') then
    raise exception 'Incoming blocked creator object must be hidden';
  end if;
  if not exists (select 1 from storage.objects where bucket_id='videos' and name='00000000-0000-0000-0000-000000000001/own-private.mp4') then
    raise exception 'Owners should retain access to their own private videos';
  end if;
  if not exists (select 1 from storage.objects where bucket_id='videos' and name='00000000-0000-0000-0000-000000000001/pending.mp4') then
    raise exception 'Owners must be able to verify an upload before row finalization';
  end if;
  if exists (select 1 from storage.objects where bucket_id='videos' and name='00000000-0000-0000-0000-000000000004/unpublished.mp4') then
    raise exception 'Unpublished objects outside the viewer folder must remain private';
  end if;
end;
$$;
reset role;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005';
set role authenticated;
do $$
begin
  if not exists (select 1 from storage.objects where bucket_id='videos' and name='00000000-0000-0000-0000-000000000004/public.mp4') then
    raise exception 'Non-followers should read public video objects';
  end if;
  if exists (select 1 from storage.objects where bucket_id='videos' and name='00000000-0000-0000-0000-000000000004/followers.mp4') then
    raise exception 'Non-followers must not read follower-only video objects';
  end if;
end;
$$;
reset role;

set request.jwt.claim.sub = '';
set role anon;
do $$
begin
  if exists (select 1 from storage.objects where bucket_id='videos' and name='00000000-0000-0000-0000-000000000004/public.mp4') then
    raise exception 'Anonymous users must not read private video objects';
  end if;
end;
$$;
reset role;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set role authenticated;
insert into storage.objects(bucket_id,name)
values ('videos','00000000-0000-0000-0000-000000000001/new-upload.mp4');
do $$
begin
  begin
    insert into storage.objects(bucket_id,name)
    values ('videos','00000000-0000-0000-0000-000000000002/forbidden.mp4');
    raise exception 'Expected cross-user video upload to be rejected';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

select '0015 private video delivery SQL checks passed' as result;

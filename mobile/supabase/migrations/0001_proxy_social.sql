-- PROXY social schema. Run in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text,
  bio text check (char_length(bio) <= 160),
  avatar_url text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare requested_username text;
begin
  requested_username := lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)));
  requested_username := regexp_replace(requested_username, '[^a-z0-9_]', '_', 'g');
  if length(requested_username) < 3 then requested_username := 'user_' || substr(new.id::text,1,8); end if;
  insert into public.profiles(id, username, display_name)
  values(new.id, requested_username, coalesce(new.raw_user_meta_data->>'display_name', requested_username))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.follows (
  follower_id uuid references public.profiles(id) on delete cascade,
  following_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(follower_id, following_id), check (follower_id <> following_id)
);
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  caption text check (char_length(caption) <= 2200),
  video_url text not null,
  thumbnail_url text,
  visibility text not null default 'public' check (visibility in ('public','followers','private')),
  created_at timestamptz not null default now()
);
create table if not exists public.video_likes (
  video_id uuid references public.videos(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(video_id,user_id)
);
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create table if not exists public.video_views (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  watch_seconds integer not null default 0 check (watch_seconds >= 0),
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  title text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.conversation_members (
  conversation_id uuid references public.conversations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(conversation_id,user_id)
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null default '' check (char_length(body) <= 5000),
  media_url text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (body <> '' or media_url is not null)
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at desc);

create table if not exists public.snaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_url text not null,
  media_type text not null check (media_type in ('image','video')),
  caption text check (char_length(caption) <= 300),
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now()
);
create index if not exists snaps_expiry_idx on public.snaps(expires_at);
create table if not exists public.snap_views (
  snap_id uuid references public.snaps(id) on delete cascade,
  viewer_id uuid references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key(snap_id,viewer_id)
);
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('follow','like','comment','message')),
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.videos enable row level security;
alter table public.video_likes enable row level security;
alter table public.comments enable row level security;
alter table public.video_views enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.snaps enable row level security;
alter table public.snap_views enable row level security;
alter table public.notifications enable row level security;

create policy "Profiles are viewable by signed-in users" on public.profiles for select to authenticated using (true);
create policy "Users update own profile" on public.profiles for update to authenticated using (auth.uid()=id) with check (auth.uid()=id);
create policy "Follow graph readable" on public.follows for select to authenticated using (true);
create policy "Follow as yourself" on public.follows for insert to authenticated with check (auth.uid()=follower_id);
create policy "Unfollow as yourself" on public.follows for delete to authenticated using (auth.uid()=follower_id);
create policy "Public videos and own videos readable" on public.videos for select to authenticated using (visibility='public' or user_id=auth.uid() or (visibility='followers' and exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=user_id)));
create policy "Create own videos" on public.videos for insert to authenticated with check (auth.uid()=user_id);
create policy "Manage own videos" on public.videos for update to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "Delete own videos" on public.videos for delete to authenticated using (auth.uid()=user_id);
create policy "Likes readable" on public.video_likes for select to authenticated using (true);
create policy "Like as yourself" on public.video_likes for insert to authenticated with check (auth.uid()=user_id);
create policy "Unlike as yourself" on public.video_likes for delete to authenticated using (auth.uid()=user_id);
create policy "Comments readable" on public.comments for select to authenticated using (true);
create policy "Comment as yourself" on public.comments for insert to authenticated with check (auth.uid()=user_id);
create policy "Delete own comments" on public.comments for delete to authenticated using (auth.uid()=user_id);
create policy "Record own views" on public.video_views for insert to authenticated with check (auth.uid()=user_id);
create policy "View own view history" on public.video_views for select to authenticated using (auth.uid()=user_id);

create or replace function public.is_conversation_member(_conversation_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $ select exists(select 1 from public.conversation_members where conversation_id=_conversation_id and user_id=_user_id); $;
create policy "Members can view conversations" on public.conversations for select to authenticated using (public.is_conversation_member(id,auth.uid()));
create policy "Authenticated users create conversations" on public.conversations for insert to authenticated with check (auth.uid()=created_by);
create policy "Members list members" on public.conversation_members for select to authenticated using (public.is_conversation_member(conversation_id,auth.uid()));
create policy "Conversation creator adds members" on public.conversation_members for insert to authenticated with check (exists(select 1 from public.conversations c where c.id=conversation_id and c.created_by=auth.uid()));
create policy "Members can read messages" on public.messages for select to authenticated using (public.is_conversation_member(conversation_id,auth.uid()));
create policy "Members can send as themselves" on public.messages for insert to authenticated with check (auth.uid()=sender_id and public.is_conversation_member(conversation_id,auth.uid()));
create policy "Sender can update own message" on public.messages for update to authenticated using (auth.uid()=sender_id) with check (auth.uid()=sender_id);

create policy "Users see unexpired snaps and own snaps" on public.snaps for select to authenticated using (expires_at > now() and (user_id=auth.uid() or exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=user_id)));
create policy "Create own snaps" on public.snaps for insert to authenticated with check (auth.uid()=user_id);
create policy "Delete own snaps" on public.snaps for delete to authenticated using (auth.uid()=user_id);
create policy "View snap views" on public.snap_views for select to authenticated using (exists(select 1 from public.snaps s where s.id=snap_id and s.user_id=auth.uid()) or auth.uid()=viewer_id);
create policy "Record own snap views" on public.snap_views for insert to authenticated with check (auth.uid()=viewer_id);
create policy "Read own notifications" on public.notifications for select to authenticated using (auth.uid()=user_id);
create policy "Update own notifications" on public.notifications for update to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);

-- Realtime events for chat. Add only when not already published.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- Storage: videos are public for feed playback; snaps remain private.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('videos','videos',true,524288000,array['video/mp4','video/quicktime','video/webm'])
on conflict (id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('snaps','snaps',false,104857600,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'])
on conflict (id) do nothing;
create policy "Authenticated users upload own videos" on storage.objects for insert to authenticated with check (bucket_id='videos' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Public can read videos" on storage.objects for select to public using (bucket_id='videos');
create policy "Owners delete own videos" on storage.objects for delete to authenticated using (bucket_id='videos' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Authenticated users upload own snaps" on storage.objects for insert to authenticated with check (bucket_id='snaps' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Owners read own snaps" on storage.objects for select to authenticated using (bucket_id='snaps' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Owners delete own snaps" on storage.objects for delete to authenticated using (bucket_id='snaps' and (storage.foldername(name))[1]=auth.uid()::text);

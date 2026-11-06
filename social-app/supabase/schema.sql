-- PROXY starter schema. Run in the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  bio text default '',
  created_at timestamptz default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_url text not null,
  media_type text not null check (media_type in ('image','video')),
  caption text default '',
  visibility text not null default 'public' check (visibility in ('public','followers','private')),
  created_at timestamptz default now()
);

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_url text not null,
  media_type text not null check (media_type in ('image','video')),
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz default now()
);

create table if not exists public.follows (
  follower_id uuid references public.profiles(id) on delete cascade,
  followed_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  media_url text,
  expires_at timestamptz,
  read_at timestamptz,
  created_at timestamptz default now(),
  check (body is not null or media_url is not null)
);

create table if not exists public.likes (
  user_id uuid references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, post_id)
);

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.stories enable row level security;
alter table public.follows enable row level security;
alter table public.messages enable row level security;
alter table public.likes enable row level security;

create policy "Profiles are readable by signed-in users" on public.profiles
 for select to authenticated using (true);
create policy "Users create own profile" on public.profiles
 for insert to authenticated with check (auth.uid() = id);
create policy "Users update own profile" on public.profiles
 for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "Public posts readable by signed-in users" on public.posts
 for select to authenticated using (visibility = 'public' or user_id = auth.uid());
create policy "Users create own posts" on public.posts
 for insert to authenticated with check (user_id = auth.uid());
create policy "Users delete own posts" on public.posts
 for delete to authenticated using (user_id = auth.uid());

create policy "Stories readable before expiry" on public.stories
 for select to authenticated using (expires_at > now());
create policy "Users create own stories" on public.stories
 for insert to authenticated with check (user_id = auth.uid());
create policy "Users delete own stories" on public.stories
 for delete to authenticated using (user_id = auth.uid());

create policy "Follows visible to signed-in users" on public.follows
 for select to authenticated using (true);
create policy "Users follow as themselves" on public.follows
 for insert to authenticated with check (follower_id = auth.uid());
create policy "Users unfollow as themselves" on public.follows
 for delete to authenticated using (follower_id = auth.uid());

create policy "Participants can read messages" on public.messages
 for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());
create policy "Senders create messages" on public.messages
 for insert to authenticated with check (sender_id = auth.uid());
create policy "Recipients mark messages read" on public.messages
 for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create policy "Likes visible to signed-in users" on public.likes
 for select to authenticated using (true);
create policy "Users like as themselves" on public.likes
 for insert to authenticated with check (user_id = auth.uid());
create policy "Users remove own likes" on public.likes
 for delete to authenticated using (user_id = auth.uid());

-- Add messages to Realtime in the Supabase dashboard if you want live updates.

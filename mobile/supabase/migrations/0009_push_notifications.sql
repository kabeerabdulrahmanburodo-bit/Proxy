-- Push notification devices, per-user preferences and server-only delivery outbox.
-- The client never receives Expo service credentials or a Supabase service-role key.

create table if not exists public.push_devices (
  expo_push_token text primary key
    check (expo_push_token ~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  device_label text check (device_label is null or char_length(device_label) <= 80),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_devices_user_enabled_idx
  on public.push_devices(user_id, enabled);

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  messages boolean not null default true,
  follows boolean not null default true,
  likes boolean not null default true,
  comments boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists push_outbox_pending_idx
  on public.push_outbox(status, created_at)
  where status in ('pending', 'failed', 'processing');

alter table public.push_devices enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_outbox enable row level security;

drop policy if exists "Users read own push devices" on public.push_devices;
create policy "Users read own push devices"
  on public.push_devices for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users read own notification preferences" on public.notification_preferences;
create policy "Users read own notification preferences"
  on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users create own notification preferences" on public.notification_preferences;
create policy "Users create own notification preferences"
  on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users update own notification preferences" on public.notification_preferences;
create policy "Users update own notification preferences"
  on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on table public.push_devices from anon, authenticated;
grant select on table public.push_devices to authenticated;
revoke all on table public.notification_preferences from anon, authenticated;
grant select, insert, update on table public.notification_preferences to authenticated;
revoke all on table public.push_outbox from anon, authenticated;
grant all on table public.push_outbox to service_role;

create or replace function public.register_push_device(
  device_token text,
  device_platform text,
  device_label text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  affected_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if device_platform not in ('ios', 'android') then
    raise exception 'Unsupported push platform';
  end if;
  if device_token is null
     or device_token !~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$' then
    raise exception 'Invalid Expo push token';
  end if;

  insert into public.push_devices (
    expo_push_token, user_id, platform, device_label, enabled, last_seen_at
  )
  values (
    device_token, current_user_id, device_platform,
    left(nullif(trim(device_label), ''), 80), true, now()
  )
  on conflict (expo_push_token) do update
    set platform = excluded.platform,
        device_label = excluded.device_label,
        enabled = true,
        last_seen_at = now()
    where public.push_devices.user_id = excluded.user_id;

  get diagnostics affected_count = row_count;
  if affected_count = 0 then
    raise exception 'This device token is already registered to another account';
  end if;

  insert into public.notification_preferences(user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;
end;
$$;
revoke all on function public.register_push_device(text, text, text) from public, anon;
grant execute on function public.register_push_device(text, text, text) to authenticated;

create or replace function public.unregister_push_device(device_token text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare removed_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  delete from public.push_devices
  where expo_push_token = device_token
    and user_id = auth.uid();
  get diagnostics removed_count = row_count;
  return removed_count > 0;
end;
$$;
revoke all on function public.unregister_push_device(text) from public, anon;
grant execute on function public.unregister_push_device(text) to authenticated;

create or replace function public.claim_push_outbox(target_id uuid)
returns setof public.push_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.push_outbox as item
     set status = 'processing',
         attempts = item.attempts + 1,
         updated_at = now()
   where item.id = target_id
     and item.attempts < 5
     and (
       item.status in ('pending', 'failed')
       or (item.status = 'processing' and item.updated_at < now() - interval '5 minutes')
     )
  returning item.*;
end;
$$;
revoke all on function public.claim_push_outbox(uuid) from public, anon, authenticated;
grant execute on function public.claim_push_outbox(uuid) to service_role;

create or replace function public.enqueue_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  push_allowed boolean;
  actor_label text;
  push_title text;
  push_body text;
  payload jsonb;
begin
  select case new.kind
    when 'message' then messages
    when 'follow' then follows
    when 'like' then likes
    when 'comment' then comments
    else false
  end
  into push_allowed
  from public.notification_preferences
  where user_id = new.user_id;

  if not coalesce(push_allowed, true) then
    return new;
  end if;

  select coalesce(nullif(display_name, ''), '@' || username, 'Someone')
    into actor_label
  from public.profiles
  where id = new.actor_id;
  actor_label := coalesce(actor_label, 'Someone');

  case new.kind
    when 'message' then
      push_title := 'New message';
      push_body := actor_label || ' sent you a message.';
    when 'follow' then
      push_title := 'New follower';
      push_body := actor_label || ' started following you.';
    when 'like' then
      push_title := 'New like';
      push_body := actor_label || ' liked your video.';
    when 'comment' then
      push_title := 'New comment';
      push_body := actor_label || ' commented on your video.';
    else
      return new;
  end case;

  payload := jsonb_build_object(
    'kind', new.kind,
    'entity_id', new.entity_id,
    'actor_id', new.actor_id
  );

  insert into public.push_outbox(notification_id, user_id, title, body, data)
  values (new.id, new.user_id, push_title, push_body, payload)
  on conflict (notification_id) do nothing;
  return new;
end;
$$;

drop trigger if exists enqueue_push_after_notification on public.notifications;
create trigger enqueue_push_after_notification
  after insert on public.notifications
  for each row execute function public.enqueue_push_notification();

create or replace function public.notify_message_recipients()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare recipient record;
begin
  for recipient in
    select user_id
    from public.conversation_members
    where conversation_id = new.conversation_id
      and user_id <> new.sender_id
  loop
    insert into public.notifications(user_id, actor_id, kind, entity_id)
    values (recipient.user_id, new.sender_id, 'message', new.conversation_id);
  end loop;
  return new;
end;
$$;

create or replace function public.notify_new_follow()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications(user_id, actor_id, kind, entity_id)
  values (new.following_id, new.follower_id, 'follow', new.follower_id);
  return new;
end;
$$;

create or replace function public.notify_video_like()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare video_owner uuid;
begin
  select user_id into video_owner from public.videos where id = new.video_id;
  if video_owner is not null and video_owner <> new.user_id then
    insert into public.notifications(user_id, actor_id, kind, entity_id)
    values (video_owner, new.user_id, 'like', new.video_id);
  end if;
  return new;
end;
$$;

create or replace function public.notify_video_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare video_owner uuid;
begin
  select user_id into video_owner from public.videos where id = new.video_id;
  if video_owner is not null and video_owner <> new.user_id then
    insert into public.notifications(user_id, actor_id, kind, entity_id)
    values (video_owner, new.user_id, 'comment', new.video_id);
  end if;
  return new;
end;
$$;

drop trigger if exists create_message_notifications on public.messages;
create trigger create_message_notifications
  after insert on public.messages
  for each row execute function public.notify_message_recipients();

drop trigger if exists create_follow_notifications on public.follows;
create trigger create_follow_notifications
  after insert on public.follows
  for each row execute function public.notify_new_follow();

drop trigger if exists create_video_like_notifications on public.video_likes;
create trigger create_video_like_notifications
  after insert on public.video_likes
  for each row execute function public.notify_video_like();

drop trigger if exists create_video_comment_notifications on public.comments;
create trigger create_video_comment_notifications
  after insert on public.comments
  for each row execute function public.notify_video_comment();

create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);

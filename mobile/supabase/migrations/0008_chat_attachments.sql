-- Private chat attachments. Database rows store object paths, never signed bearer URLs.
-- Object layout: <conversation UUID>/<uploader UUID>/<timestamp>-<filename>.

alter table public.messages
  add column if not exists media_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_media_type_check'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_media_type_check
      check (media_type is null or media_type in ('image', 'video'));
  end if;
end;
$$;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  104857600,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Conversation members read chat attachments" on storage.objects;
create policy "Conversation members read chat attachments"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_conversation_member(
        split_part(name, '/', 1)::uuid,
        (select auth.uid())
      )
      else false
    end
  );

drop policy if exists "Members upload own chat attachments" on storage.objects;
create policy "Members upload own chat attachments"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and split_part(name, '/', 2) = (select auth.uid())::text
      then public.is_conversation_member(
        split_part(name, '/', 1)::uuid,
        (select auth.uid())
      )
      else false
    end
  );

drop policy if exists "Uploaders delete own chat attachments" on storage.objects;
create policy "Uploaders delete own chat attachments"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'chat-attachments'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_conversation_member(
        split_part(name, '/', 1)::uuid,
        (select auth.uid())
      )
      else false
    end
  );

-- Messages already require an authenticated conversation member and sender_id = auth.uid().
-- The object-path policy above ensures only members can mint signed URLs for that conversation.

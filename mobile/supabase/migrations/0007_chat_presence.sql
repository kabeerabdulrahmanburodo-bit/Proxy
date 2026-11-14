-- Private per-conversation Presence for online and typing indicators.
-- The client uses private channel topics: proxy-chat:<conversation UUID>.
-- Only current conversation members may subscribe to or publish Presence.

drop policy if exists "Conversation members receive private chat presence" on realtime.messages;
create policy "Conversation members receive private chat presence"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'presence'
    and case
      when realtime.topic() ~ '^proxy-chat:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then public.is_conversation_member(
        split_part(realtime.topic(), ':', 2)::uuid,
        (select auth.uid())
      )
      else false
    end
  );

drop policy if exists "Conversation members publish private chat presence" on realtime.messages;
create policy "Conversation members publish private chat presence"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and case
      when realtime.topic() ~ '^proxy-chat:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then public.is_conversation_member(
        split_part(realtime.topic(), ':', 2)::uuid,
        (select auth.uid())
      )
      else false
    end
  );

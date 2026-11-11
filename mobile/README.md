# PROXY Mobile

Expo / React Native social app foundation using Supabase Auth, PostgreSQL, Realtime and Storage.

## Requirements
- Node.js 20+
- Expo-compatible iOS Simulator or Android emulator/device
- A Supabase project

## Install and run
```bash
cd mobile
npm install
cp .env.example .env
# Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env
npx expo start
```

In Supabase SQL Editor, run migrations `0001_proxy_social.sql` through `0008_chat_attachments.sql` in filename order. In Authentication settings, configure email confirmation and password policies. Never put a Supabase service-role key in the mobile app; only the anon/publishable key belongs in EXPO_PUBLIC variables. RLS is the security boundary.

## Current implementation
- Expo Router mobile shell with Discover, Chats, Snaps and Profile tabs
- Email/password sign-up and sign-in through Supabase Auth
- Profile creation trigger and PostgreSQL schema
- RLS policies for profiles, follows, videos, likes, comments, chat membership, messages, snaps and notifications
- Search signed-in users by username or display name
- Start or reopen direct conversations without copying a conversation UUID
- Create named group chats with up to 50 members, add participants, remove members as creator, transfer ownership, and let members leave
- Recent conversation list with the latest message preview
- Realtime direct and group messaging, member-scoped online presence and live typing indicators
- Message history pagination in 30-message pages, ordered by timestamp and UUID cursor
- Per-recipient read receipts for direct and group chats, including realtime Seen indicators
- Share images and short videos in direct or group chats; media appears inline in the conversation
- Vertical, swipeable video feed using `expo-video`; only the currently visible item plays
- Video picker and publishing flow: uploads to the public `videos` bucket, inserts the matching `videos` row, and removes the uploaded object if the row insert fails
- Periodic watch-time and completion signals written to `video_views`
- Snap media upload to a private bucket and 24-hour expiry metadata

## Messaging behavior and security
Read receipts are stored in `message_reads` rather than the legacy `messages.read_at` field, so group chats can record each reader separately. The authenticated RPC derives the reader from `auth.uid()`, checks conversation membership, and inserts receipts idempotently. RLS lets a user see their own receipts and lets a sender see receipts for their own messages. Apply migration `0004_message_pagination_read_receipts.sql` before expecting Seen indicators to work.

Group membership changes use SECURITY DEFINER RPCs with a fixed search path. Migration `0005_group_member_removal.sql` allows members to leave and lets creators remove other members; the creator may delete a group only when they are its sole member. Migration `0006_group_ownership_transfer.sql` allows only the current creator to transfer ownership to an existing member. The previous creator remains a member and can then leave. The client has no direct membership-delete or ownership-update policy.

Migration `0007_chat_presence.sql` scopes private Supabase Presence channels to current conversation members. The client joins `proxy-chat:<conversation UUID>` with `private: true`; RLS checks the authenticated user against `conversation_members` and permits only Presence events on that topic. Online state is ephemeral, is cleared when a client disconnects, and is marked offline while the app is backgrounded; it is restored when the app returns to the foreground. Typing state automatically returns to idle after 1.6 seconds without input and is cleared when the app backgrounds or the user sends a message. Existing Postgres Changes subscriptions for messages and read receipts remain separate.

Migration `0008_chat_attachments.sql` creates the private `chat-attachments` bucket and adds a nullable `messages.media_type` field. Object paths are stored in message rows, not signed URLs. The path format is `<conversation UUID>/<uploader UUID>/<filename>`. Storage RLS checks current conversation membership for reads and uploads, verifies that the uploader folder matches `auth.uid()`, and limits deletion to the uploader while they remain a member. The client mints one-hour signed URLs only when rendering messages; those URLs are temporary bearer links and are not persisted in PostgreSQL. Supported media are JPEG, PNG, WebP, MP4, QuickTime and WebM. The client enforces 15 MB per image and 50 MB per video; the bucket has a 100 MB hard limit.

Pagination fetches the newest 30 messages first, then older pages using a timestamp + message UUID cursor. The screen subscribes to message inserts and receipt inserts while it is open.

## Video feed behavior and limits
The feed prioritizes followed creators, then recent posts. Supabase RLS controls which public and followed-only rows a signed-in user can read. This is a starter ranking, not a machine-learning recommendation system. Watch metrics are sampled while a video is actively playing; short sessions under the five-second sampling interval may not be recorded. Upload currently reads the selected local URI into a Blob, which can use substantial memory for large files. For production, move to resumable uploads, background transfer, moderation, transcoding, thumbnails and CDN delivery.

## Important production work still required
1. Add push notifications for messages, follows and activity, using server-side delivery credentials and user-controlled device preferences.
2. Add resumable/background uploads for large chat and feed videos; current chat attachment upload buffers a Blob in memory and is intended for modest file sizes.
3. Replace the starter feed ordering with a server-side recommendation pipeline using watch duration, completion, skips, follows, likes, freshness, safety and diversity. Do not rank solely by likes.
4. Add an automated scheduled cleanup job for expired snap rows and their private Storage objects. Expiry filtering alone does not physically delete media.
5. Implement WebRTC calling with a native WebRTC module, signaling, STUN/TURN credentials, call lifecycle, permissions, reconnect handling and abuse controls. Native WebRTC is not supported in Expo Go; use an Expo development build / EAS Build and validate the selected WebRTC package against the Expo SDK.
6. Add automated tests, error reporting, rate limits, moderation/report flows, account deletion/export, privacy policy, terms and load/security testing.

## Media and privacy notes
- Video bucket is public for playback. Do not upload private content there.
- Chat attachments use a private bucket. Do not persist signed URLs; they grant bearer access until expiration. Storage RLS is required for minting signed URLs.
- Snap bucket is private. The starter snap helper stores a signed URL; for a hardened release, store the object path in the database and mint short-lived signed URLs only after authorization. A signed URL is a bearer link until it expires.
- Set explicit Supabase bucket size/MIME limits appropriate to your launch. Configure storage lifecycle cleanup.
- Supabase Realtime message subscriptions require the messages and message_reads tables to be in the Realtime publication; migrations add them if absent.

## Suggested next milestones
1. Add push notifications with server-side delivery and per-device preferences.
2. Add resumable/background media uploads and attachment cleanup.
3. Add WebRTC calls with an Expo development build.
4. Ship feed ranking, push notifications and moderation.

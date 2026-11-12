# PROXY Mobile

Expo / React Native social app foundation using Supabase Auth, PostgreSQL, Realtime and Storage.

## Requirements
- Node.js 20+
- Expo-compatible iOS Simulator or Android emulator/device
- A Supabase project

## Install and run
~~~bash
cd mobile
npm install
cp .env.example .env
# Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env
npx expo start
~~~

In Supabase SQL Editor, run migrations 0001 through 0009 in filename order. In Authentication settings, configure email confirmation and password policies. Never put a Supabase service-role key in the mobile app; only the anon/publishable key belongs in EXPO_PUBLIC variables. RLS is the security boundary.

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
- Vertical, swipeable video feed using expo-video; only the currently visible item plays
- Video picker and publishing flow: uploads to the public videos bucket, inserts the matching videos row, and removes the uploaded object if the row insert fails
- Periodic watch-time and completion signals written to video_views
- Snap media upload to a private bucket and 24-hour expiry metadata
- Device push registration, per-category notification preferences and push tap navigation

## Messaging behavior and security
Read receipts are stored in message_reads rather than the legacy messages.read_at field, so group chats can record each reader separately. The authenticated RPC derives the reader from auth.uid(), checks conversation membership, and inserts receipts idempotently. RLS lets a user see their own receipts and lets a sender see receipts for their own messages. Apply migration 0004 before expecting Seen indicators to work.

Group membership changes use SECURITY DEFINER RPCs with a fixed search path. Migration 0005 allows members to leave and lets creators remove other members; the creator may delete a group only when they are its sole member. Migration 0006 allows only the current creator to transfer ownership to an existing member. The previous creator remains a member and can then leave. The client has no direct membership-delete or ownership-update policy.

Migration 0007 scopes private Supabase Presence channels to current conversation members. The client joins a proxy-chat:<conversation UUID> channel with private: true; RLS checks the authenticated user against conversation_members and permits only Presence events on that topic. Online state is ephemeral, is cleared when a client disconnects, and is marked offline while the app is backgrounded; it is restored when the app returns to the foreground. Typing state automatically returns to idle after 1.6 seconds without input and is cleared when the app backgrounds or the user sends a message.

Migration 0008 creates the private chat-attachments bucket and adds messages.media_type. Object paths are stored in message rows, not signed URLs. Storage RLS checks current conversation membership for reads and uploads, verifies the uploader folder matches auth.uid(), and limits deletion to the uploader while they remain a member. The client mints one-hour signed URLs only when rendering messages. Supported media are JPEG, PNG, WebP, MP4, QuickTime and WebM. The client enforces 15 MB per image and 50 MB per video; the bucket has a 100 MB hard limit.

Pagination fetches the newest 30 messages first, then older pages using a timestamp + message UUID cursor. The screen subscribes to message inserts and receipt inserts while it is open.

## Push notifications
Migration 0009 creates:
- push_devices, whose tokens can only be registered/unregistered through authenticated RPCs and read by their owner
- notification_preferences, with separate message, follow, like and comment switches protected by per-user RLS
- push_outbox, which has no client policies or client grants and is accessible only to the server-side service role

PostgreSQL creates in-app notification rows for new direct/group messages, follows, video likes and video comments. An insert trigger adds eligible events to the private outbox unless that category is disabled. The Edge Function claims an outbox row atomically, sends Expo Push Service messages in batches, disables tokens reported as DeviceNotRegistered, and records delivery status. A webhook secret protects the Edge Function endpoint; the service-role key remains server-side.

### Push deployment (required; not completed by this repository commit)
1. Run migrations 0001 through 0009 in order.
2. Link the Supabase project from mobile/ with the Supabase CLI and deploy supabase/functions/send-push-notification. Only this function has JWT verification disabled; it requires the x-proxy-webhook-secret header.
3. Set the Edge Function secret PROXY_PUSH_WEBHOOK_SECRET to a long random value. Supabase supplies SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Edge Functions; do not copy either into the app.
4. In Supabase Dashboard, create a Database Webhook for INSERT on public.push_outbox, targeting the deployed send-push-notification function URL. Add a custom header named x-proxy-webhook-secret with the same secret. Do not expose that secret in the mobile app or repository.
5. Run eas init in mobile/, then add the generated EAS project ID to expo.extra.eas.projectId in app.json. Configure APNs and FCM credentials in EAS and create a development/release build. Remote push requires a native build and physical device; Android Expo Go does not support remote push for SDK 54.
6. Enable notifications from Profile on the device. Users can disable this device or switch message/follow/like/comment categories independently.

If a push delivery attempt fails, the outbox records the failure and attempt count. A server operator can reset a failed row to pending and re-invoke the webhook/function after correcting the cause. No service credentials or webhook secret are committed.

## Video feed behavior and limits
The feed prioritizes followed creators, then recent posts. Supabase RLS controls which public and followed-only rows a signed-in user can read. This is a starter ranking, not a machine-learning recommendation system. Watch metrics are sampled while a video is actively playing; short sessions under the five-second sampling interval may not be recorded. Upload currently reads the selected local URI into a Blob, which can use substantial memory for large files. For production, move to resumable uploads, background transfer, moderation, transcoding, thumbnails and CDN delivery.

## Important production work still required
1. Add resumable/background uploads for large chat and feed videos; current chat attachment upload buffers a Blob in memory and is intended for modest file sizes.
2. Replace starter feed ordering with a server-side recommendation pipeline using watch duration, completion, skips, follows, likes, freshness, safety and diversity.
3. Add an automated scheduled cleanup job for expired snap rows and their private Storage objects. Expiry filtering alone does not physically delete media.
4. Implement WebRTC calling with a native WebRTC module, signaling, STUN/TURN credentials, call lifecycle, permissions, reconnect handling and abuse controls. Native WebRTC is not supported in Expo Go; use an Expo development build / EAS Build.
5. Add automated tests, error reporting, rate limits, moderation/report flows, account deletion/export, privacy policy, terms and load/security testing.

## Media and privacy notes
- Video bucket is public for playback. Do not place private media there.
- Chat attachments use a private bucket. Do not persist signed URLs; they grant bearer access until expiration. Storage RLS is required for minting signed URLs.
- Snap bucket is private. The starter snap helper stores a signed URL; for a hardened release, store the object path in the database and mint short-lived signed URLs only after authorization.
- Set explicit Supabase bucket size/MIME limits appropriate to your launch. Configure storage lifecycle cleanup.
- Supabase Realtime message subscriptions require the messages and message_reads tables to be in the Realtime publication; migrations add them if absent.

## Suggested next milestones
1. Add resumable/background media uploads and attachment cleanup.
2. Add WebRTC calls with an Expo development build.
3. Ship feed ranking, moderation and in-app notification history.

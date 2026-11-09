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

In Supabase SQL Editor, run the migrations in `supabase/migrations/` in filename order. In Authentication settings, configure email confirmation and password policies. Never put a Supabase service-role key in the mobile app; only the anon/publishable key belongs in EXPO_PUBLIC variables. RLS is the security boundary.

## Current implementation
- Expo Router mobile shell with Discover, Chats, Snaps and Profile tabs
- Email/password sign-up and sign-in through Supabase Auth
- Profile creation trigger and PostgreSQL schema
- RLS policies for profiles, follows, videos, likes, comments, chat membership, messages, snaps and notifications
- Search signed-in users by username or display name
- Start or reopen direct conversations without copying a conversation UUID
- Create named group chats with up to 50 members, add participants, remove members as creator, and let non-creators leave
- Recent conversation list with the latest message preview
- Realtime direct and group messaging
- Message history pagination in 30-message pages, ordered by timestamp and UUID cursor
- Per-recipient read receipts for direct and group chats, including realtime Seen indicators
- Vertical, swipeable video feed using `expo-video`; only the currently visible item plays
- Video picker and publishing flow: uploads to the public `videos` bucket, inserts the matching `videos` row, and removes the uploaded object if the row insert fails
- Periodic watch-time and completion signals written to `video_views`
- Snap media upload to a private bucket and 24-hour expiry metadata

## Messaging behavior and security
Read receipts are stored in `message_reads` rather than the legacy `messages.read_at` field, so group chats can record each reader separately. The authenticated RPC derives the reader from `auth.uid()`, checks conversation membership, and inserts receipts idempotently. RLS lets a user see their own receipts and lets a sender see receipts for their own messages. Apply migration `0004_message_pagination_read_receipts.sql` before expecting Seen indicators to work.\n\nGroup membership changes use the `remove_group_conversation_member` SECURITY DEFINER RPC from migration `0005_group_member_removal.sql`. It checks the signed-in user against the group creator and current membership: creators may remove other members, non-creators may remove only themselves, and a creator can delete a group only when they are its sole member. The client has no direct membership-delete policy. Ownership transfer and creator departure from an active group are not yet supported.

Pagination fetches the newest 30 messages first, then older pages using a timestamp + message UUID cursor. The screen subscribes to message inserts and receipt inserts while it is open.

## Video feed behavior and limits
The feed prioritizes followed creators, then recent posts. Supabase RLS controls which public and followed-only rows a signed-in user can read. This is a starter ranking, not a machine-learning recommendation system. Watch metrics are sampled while a video is actively playing; short sessions under the five-second sampling interval may not be recorded. Upload currently reads the selected local URI into a Blob, which can use substantial memory for large files. For production, move to resumable uploads, background transfer, moderation, transcoding, thumbnails and CDN delivery.

## Important production work still required
1. Add group ownership transfer, typing presence, push notifications and attachment handling.
2. Replace the starter feed ordering with a server-side recommendation pipeline using watch duration, completion, skips, follows, likes, freshness, safety and diversity. Do not rank solely by likes.
3. Add an automated scheduled cleanup job for expired snap rows and their private Storage objects. Expiry filtering alone does not physically delete media.
4. Implement WebRTC calling with a native WebRTC module, signaling, STUN/TURN credentials, call lifecycle, permissions, reconnect handling and abuse controls. Native WebRTC is not supported in Expo Go; use an Expo development build / EAS Build and validate the selected WebRTC package against the Expo SDK.
5. Add tests, error reporting, rate limits, moderation/report flows, account deletion/export, privacy policy, terms and load/security testing.

## Media and privacy notes
- Video bucket is public for playback. Do not upload private content there.
- Snap bucket is private. The starter snap helper stores a signed URL; for a hardened release, store the object path in the database and mint short-lived signed URLs only after authorization. A signed URL is a bearer link until it expires.
- Set explicit Supabase bucket size/MIME limits appropriate to your launch. Configure storage lifecycle cleanup.
- Supabase Realtime message subscriptions require the messages and message_reads tables to be in the Realtime publication; migrations add them if absent.

## Suggested next milestones
1. Add group member removal/leave controls, typing presence, push notifications and attachment handling.
2. Add WebRTC calls with an Expo development build.
3. Ship feed ranking, push notifications and moderation.

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
- Realtime message subscription
- Vertical, swipeable video feed using `expo-video`; only the currently visible item plays
- Video picker and publishing flow: uploads to the public `videos` bucket, inserts the matching `videos` row, and removes the uploaded object if the row insert fails
- Periodic watch-time and completion signals written to `video_views`
- Snap media upload to a private bucket and 24-hour expiry metadata

## Video feed behavior and limits
The feed prioritizes followed creators, then recent posts. Supabase RLS controls which public and followed-only rows a signed-in user can read. This is a starter ranking, not a machine-learning recommendation system. Watch metrics are sampled while a video is actively playing; short sessions under the five-second sampling interval may not be recorded. Upload currently reads the selected local URI into a Blob, which can use substantial memory for large files. For production, move to resumable uploads, background transfer, moderation, transcoding, thumbnails and CDN delivery.

## Important production work still required
1. Add contact/user discovery, create-conversation flow, group chat UI, message pagination, read receipts, typing presence, push notifications and attachment handling.
2. Replace the starter feed ordering with a server-side recommendation pipeline using watch duration, completion, skips, follows, likes, freshness, safety and diversity. Do not rank solely by likes.
3. Add an automated scheduled cleanup job for expired snap rows and their private Storage objects. Expiry filtering alone does not physically delete media.
4. Implement WebRTC calling with a native WebRTC module, signaling, STUN/TURN credentials, call lifecycle, permissions, reconnect handling and abuse controls. Native WebRTC is not supported in Expo Go; use an Expo development build / EAS Build and validate the selected WebRTC package against the Expo SDK.
5. Add tests, error reporting, rate limits, moderation/report flows, account deletion/export, privacy policy, terms and load/security testing.

## Media and privacy notes
- Video bucket is public for playback. Do not upload private content there.
- Snap bucket is private. The starter snap helper stores a signed URL; for a hardened release, store the object path in the database and mint short-lived signed URLs only after authorization. A signed URL is a bearer link until it expires.
- Set explicit Supabase bucket size/MIME limits appropriate to your launch. Configure storage lifecycle cleanup.
- Supabase Realtime message subscriptions require the messages table to be in the Realtime publication; the migration adds it if absent.

## Suggested next milestones
1. Finish user discovery and conversation creation.
2. Add WebRTC calls with an Expo development build.
3. Ship feed ranking, push notifications and moderation.

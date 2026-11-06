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

In Supabase SQL Editor, run `supabase/migrations/0001_proxy_social.sql`. In Authentication settings, configure email confirmation and password policies. Never put a Supabase service-role key in the mobile app; only the anon/publishable key belongs in EXPO_PUBLIC variables. RLS is the security boundary.

## Current implementation
- Expo Router mobile shell with Discover, Chats, Snaps and Profile tabs
- Email/password sign-up and sign-in through Supabase Auth
- Profile creation trigger and PostgreSQL schema
- RLS policies for profiles, follows, videos, likes, comments, chat membership, messages, snaps and notifications
- Realtime message subscription
- Video feed query with a starter followed-creator-first ranking
- Snap media upload to a private bucket and 24-hour expiry metadata

## Important production work still required
This branch is a working foundation, not a production-complete Snapchat/TikTok replacement:
1. Add contact/user discovery, create-conversation flow, group chat UI, message pagination, read receipts, typing presence, push notifications and attachment handling.
2. Build a proper vertical video player and creator upload/publish screen. The storage upload helper must be followed by an insert into `videos`; add moderation, transcoding, thumbnails, resumable uploads and CDN delivery before launch.
3. Replace the starter feed ordering with a server-side recommendation pipeline using watch duration, completion, skips, follows, likes, freshness, safety and diversity. Do not rank solely by likes.
4. Add an automated scheduled cleanup job for expired snap rows and their private Storage objects. Expiry filtering alone does not physically delete media.
5. Implement WebRTC calling with a native WebRTC module, signaling, STUN/TURN credentials, call lifecycle, permissions, reconnect handling and abuse controls. Native WebRTC is not supported in Expo Go; use an Expo development build / EAS Build and validate the selected WebRTC package against the Expo SDK.
6. Add tests, error reporting, rate limits, moderation/report flows, account deletion/export, privacy policy, terms and load/security testing.

## Media and privacy notes
- Video bucket is public for playback. Do not upload private content there.
- Snap bucket is private. The starter snap helper stores a signed URL; for a hardened release, store the object path in the database and mint short-lived signed URLs only after authorization. A signed URL is a bearer link until it expires.
- Set explicit Supabase bucket size/MIME limits appropriate to your launch. Configure storage lifecycle cleanup.
- Supabase Realtime message subscriptions require the messages table to be in the Realtime publication; the migration adds it if absent.

## Suggested next milestones
1. Complete video publish + playback.
2. Finish user discovery and conversation creation.
3. Add WebRTC calls with an Expo development build.
4. Ship feed ranking, push notifications and moderation.

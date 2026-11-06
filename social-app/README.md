# PROXY — Social app starter

A mobile-first social app starter combining short videos, stories, camera posts and direct messaging.

## Stack
- Expo SDK 58 + React Native 0.88 + TypeScript
- Expo Router
- Supabase Auth, Postgres, Realtime and Storage

## Requirements
- Node.js 22.13 or newer (required by Expo SDK 58)
- npm
- Expo Go on a compatible phone, or an iOS Simulator / Android emulator

## Run locally
From the repository root:

```bash
cd social-app
npm install
npx expo install --fix
npx expo start
```

Scan the QR code with Expo Go, or press the appropriate key to open a simulator.

## Supabase setup
1. Create a Supabase project.
2. Copy `.env.example` to `.env` and set the project URL and anon/publishable key.
3. Run `supabase/schema.sql` in the Supabase SQL editor.
4. Add the `messages` table to Supabase Realtime if you want live message updates.
5. Configure storage buckets and access policies before enabling media publishing.

## Included starter
- For You style feed screen (visual demo placeholder, not yet a real video player)
- Stories row
- Camera/gallery media selection
- Chat inbox and local-only conversation demo
- Profile and discover screens
- Supabase client and initial database schema

## Not yet production-ready
Authentication screens and session handling, real Supabase-backed conversations, media uploads, video playback/transcoding, feed ranking, friend-only story visibility, push notifications, moderation/reporting, live streaming and WebRTC calling still need implementation and testing. Review `SECURITY-NOTES.md` before using real user data.

# PROXY — Social app starter

A mobile-first social app starter combining short videos, stories, camera posts and direct messaging.

## Stack
- Expo + React Native + TypeScript
- Expo Router
- Supabase Auth, Postgres, Realtime and Storage

## Run locally
```bash
npm install
npx expo start
```

## Supabase setup
1. Create a Supabase project.
2. Copy `.env.example` to `.env` and set the project URL and anon key.
3. Run `supabase/schema.sql` in the Supabase SQL editor.
4. Create public buckets named `posts` and `avatars`; for production, tighten storage policies and use signed URLs for private media.

## Included starter
- Feed screen with a vertical-video style layout
- Stories row
- Chat inbox and conversation screen
- Profile screen
- Tab navigation
- Supabase client and initial database schema

This is a starter scaffold, not a production-ready Snapchat/TikTok clone. Upload workflows, push notifications, moderation, real video transcoding, live streaming and WebRTC calling need additional implementation and testing.

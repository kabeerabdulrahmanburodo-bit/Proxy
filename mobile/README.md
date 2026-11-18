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

In Supabase SQL Editor, run migrations 0001 through 0013 in filename order. Before applying migration 0012, deploy the Snap cleanup Edge Function and configure its Vault secrets as described below. Apply migration 0013 after 0012. In Authentication settings, configure email confirmation and password policies. Never put a Supabase service-role key in the mobile app; only the anon/publishable key belongs in EXPO_PUBLIC variables. RLS is the security boundary.

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
- Share images and short videos in direct or group chats; media appears inline in the conversation and uses the same resumable TUS upload queue
- Vertical, swipeable video feed using expo-video; only the currently visible item plays
- Video picker and publishing flow: stages the selected file locally, uploads to the public videos bucket in resumable TUS chunks, inserts the matching videos row, and cleans up the object if database finalization fails
- Periodic watch-time and completion signals written to video_views
- Persistent upload queue for feed videos, chat attachments and 24-hour snaps, with progress, retry, local file staging, and resume after app restarts
- Resumable Snap photo/video uploads to the private `snaps` bucket, with 24-hour expiry metadata and owner/follower-scoped media access
- Active Snap story tray grouped by creator, with sequential photo/video playback, expiry-aware advancement and short-lived signed URLs
- Per-viewer Snap receipts recorded once per story; owners can see the view count for their own Snaps
- Device push registration, per-category notification preferences and push tap navigation

## Messaging behavior and security
Read receipts are stored in message_reads rather than the legacy messages.read_at field, so group chats can record each reader separately. The authenticated RPC derives the reader from auth.uid(), checks conversation membership, and inserts receipts idempotently. RLS lets a user see their own receipts and lets a sender see receipts for their own messages. Apply migration 0004 before expecting Seen indicators to work.

Group membership changes use SECURITY DEFINER RPCs with a fixed search path. Migration 0005 allows members to leave and lets creators remove other members; the creator may delete a group only when they are its sole member. Migration 0006 allows only the current creator to transfer ownership to an existing member. The previous creator remains a member and can then leave. The client has no direct membership-delete or ownership-update policy.

Migration 0007 scopes private Supabase Presence channels to current conversation members. The client joins a proxy-chat:<conversation UUID> channel with private: true; RLS checks the authenticated user against conversation_members and permits only Presence events on that topic. Online state is ephemeral, is cleared when a client disconnects, and is marked offline while the app is backgrounded; it is restored when the app returns to the foreground. Typing state automatically returns to idle after 1.6 seconds without input and is cleared when the app backgrounds or the user sends a message.

Migration 0008 creates the private chat-attachments bucket and adds messages.media_type. Object paths are stored in message rows, not signed URLs. Storage RLS checks current conversation membership for reads and uploads, verifies the uploader folder matches auth.uid(), and limits deletion to the uploader while they remain a member. The client mints one-hour signed URLs only when rendering messages. Supported media are JPEG, PNG, WebP, MP4, QuickTime and WebM. The client enforces 15 MB per image and 50 MB per video; the bucket has a 100 MB hard limit.

Feed videos, chat attachments and Snap media use Supabase Storage's TUS resumable endpoint with 6 MiB chunks and retry delays. Expo FileSystem copies the picker URI into the app's persistent document directory so a transfer can be resumed after the app process is restarted. The TUS upload URL and queue metadata are persisted in AsyncStorage; access tokens are not persisted with the upload. Supabase TUS session URLs expire after 24 hours; the client discards saved sessions after 23 hours and starts a fresh transfer for the same staged file. Authorization is refreshed before each TUS request. The upload path remains user-scoped for public videos and private snaps, and conversation/member-scoped for private chat attachments, so the Storage RLS rules still apply. Migration 0010 stores new snap media as an object path rather than a signed URL. Snap Storage reads are allowed to the owner or to a follower only while the corresponding snap row is visible and unexpired under PostgreSQL RLS; owners can also verify their own upload before row finalization. The app pauses an active transfer when it backgrounds and resumes it when foregrounded. Open Profile > Pending media uploads to recover interrupted jobs; database finalization is idempotent so a completed object is not uploaded a second time if the app closes before its row is created.

This is **resumable foreground transfer with lifecycle pause/resume**, not a guaranteed native background upload service. The JavaScript TUS client cannot continue executing while iOS/Android suspend or terminate the app. True OS-managed background transfer needs a native background upload implementation and an Expo development/release build; it is not claimed here. Snap uploads now use the same resumable queue. The queue still pauses while the OS suspends the app; it is not a native background transfer service.

Pagination fetches the newest 30 messages first, then older pages using a timestamp + message UUID cursor. The screen subscribes to message inserts and receipt inserts while it is open.

## Push notifications
Migration 0009 creates:
- push_devices, whose tokens can only be registered/unregistered through authenticated RPCs and read by their owner
- notification_preferences, with separate message, follow, like and comment switches protected by per-user RLS
- push_outbox, which has no client policies or client grants and is accessible only to the server-side service role

PostgreSQL creates in-app notification rows for new direct/group messages, follows, video likes and video comments. An insert trigger adds eligible events to the private outbox unless that category is disabled. The Edge Function claims an outbox row atomically, sends Expo Push Service messages in batches, disables tokens reported as DeviceNotRegistered, and records Expo ticket acceptance/failure. An accepted Expo ticket is not proof of final device delivery; push receipt polling is not implemented yet. A webhook secret protects the Edge Function endpoint; the service-role key remains server-side.

### Push deployment (required; not completed by this repository commit)
1. Run migrations 0001 through 0013 in order, following the Snap cleanup prerequisites below before applying 0012.
2. Link the Supabase project from mobile/ with the Supabase CLI and deploy supabase/functions/send-push-notification. Only this function has JWT verification disabled; it requires the x-proxy-webhook-secret header.
3. Set the Edge Function secret PROXY_PUSH_WEBHOOK_SECRET to a long random value. Supabase supplies SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Edge Functions; do not copy either into the app.
4. In Supabase Dashboard, create a Database Webhook for INSERT on public.push_outbox, targeting the deployed send-push-notification function URL. Add a custom header named x-proxy-webhook-secret with the same secret. Do not expose that secret in the mobile app or repository.
5. Run eas init in mobile/, then add the generated EAS project ID to expo.extra.eas.projectId in app.json. Configure APNs and FCM credentials in EAS and create a development/release build. Use a development or release build on a physical device for reliable push testing; Android Expo Go does not support remote push for SDK 54.
6. Enable notifications from Profile on the device. Users can disable this device or switch message/follow/like/comment categories independently.

If a push delivery attempt fails, the outbox records the failure and attempt count. A server operator can reset a failed row to pending and re-invoke the webhook/function after correcting the cause. No service credentials or webhook secret are committed.

## Video feed behavior and limits
The feed calls the authenticated `get_personalized_video_feed` RPC (migration 0013), which ranks a bounded set of recent videos using follow affinity, likes, the viewer's accumulated watch time/completions on each video and creator, freshness, and a modest unseen-video bonus. A per-creator diversity penalty prevents one creator from filling the entire batch. The RPC returns only public videos or follower-only videos the viewer follows; execution is restricted to authenticated users and it does not expose raw watch-history aggregates. If migration 0013 is not yet applied, the client falls back only when the RPC is missing to the prior RLS-filtered followed-creators/recent feed. This is a starter ranking, not ML or moderation. Watch metrics are sampled while actively playing and completion comes from expo-video's `playToEnd` event; short sessions may not reach a sample but are flushed when a card loses focus. Feed video publishing uses resumable TUS chunks rather than loading the entire clip into a Blob. For production, add native OS-managed background transfer, moderation, transcoding, thumbnails and CDN delivery.

## Snap story viewing and receipts
The Snaps tab loads only unexpired rows visible through the authenticated user's `snaps` RLS policy (their own stories and stories from followed creators). Stories are grouped by creator and ordered oldest-to-newest within each creator. The viewer advances through photos after five seconds, plays videos until the player reaches the end, and skips a story when its `expires_at` is reached. New object-path rows receive a five-minute signed URL from the private `snaps` bucket; signing is authorized by Storage RLS. Legacy rows that still contain signed URLs are accepted only when the URL belongs to this Supabase project and its signed `snaps` object endpoint, but the old token cannot be refreshed after it expires.

A viewer receipt is inserted once per `(snap_id, viewer_id)` pair. Migration `0011_snap_story_views.sql` tightens the insert policy so an authenticated user can only record a view for an active Snap they can currently see. The Snap owner can count receipts for their own story; viewers cannot enumerate other viewers. No client service-role access is used.

## Automated expired-Snap cleanup

Migration `0012_snap_expiry_cleanup.sql` installs `pg_cron` and `pg_net`, adds a private audit table for malformed legacy references, and schedules `proxy-expired-snap-cleanup` every 15 minutes. The job invokes the `cleanup-expired-snaps` Edge Function.

The function:
- Scans up to 500 expired Snap rows per run.
- Accepts only owner-folder paths in the private `snaps` bucket, including legacy signed URLs from the same Supabase project.
- Deletes media through the Supabase Storage API in batches of at most 500 objects; it never deletes directly from `storage.objects`.
- Deletes each matching Snap row only after its Storage removal succeeds. Failed Storage batches retain their rows for a later retry; if row deletion fails after object removal, the next run safely retries.
- Records malformed or external legacy references in the service-role-only `snap_cleanup_issues` table, then removes their expired story rows without touching an untrusted object. These exceptional cases may require a manual orphan audit.

### Cleanup deployment (required; not completed by this repository commit)

Deploy the function and configure its secrets before applying migration 0012:

1. From `mobile/`, link the Supabase project and deploy the function:
   ```bash
   supabase link --project-ref <project-ref>
   supabase functions deploy cleanup-expired-snaps
   ```
2. Generate a random secret of at least 32 characters and set it as an Edge Function secret:
   ```bash
   supabase secrets set PROXY_SNAP_CLEANUP_SECRET="<random-secret>"
   ```
   The function has JWT verification disabled only because the scheduled caller uses a dedicated `x-proxy-snap-cleanup-secret` header. The handler compares that header in constant time. It uses `SUPABASE_SERVICE_ROLE_KEY` only inside the Edge Function; the mobile app never receives it.
3. In Supabase SQL Editor, store the project URL, publishable (or legacy anon) key, and the same cleanup secret in Vault:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'proxy_project_url');
   select vault.create_secret('<publishable-or-legacy-anon-key>', 'proxy_publishable_key');
   select vault.create_secret('<same-random-secret>', 'proxy_snap_cleanup_secret');
   ```
   The publishable/anon key is used only for the API gateway `apikey` header; the separate random header is the actual cleanup authorization. Do not query or print decrypted Vault values.
4. Apply `0012_snap_expiry_cleanup.sql` after the function and Vault values are ready. The migration enables `pg_cron` and `pg_net` and schedules the 15-minute job. If the project does not expose Vault or these extensions, enable them in the Supabase Dashboard first; do not replace this with direct SQL deletion from Storage tables.
5. Verify the schedule and recent runs:
   ```sql
   select jobid, jobname, schedule, active
   from cron.job
   where jobname = 'proxy-expired-snap-cleanup';

   select jobid, status, return_message, start_time
   from cron.job_run_details
   where jobid in (
     select jobid from cron.job where jobname = 'proxy-expired-snap-cleanup'
   )
   order by start_time desc
   limit 10;
   ```

The cron request keeps the project URL and keys in Vault rather than in the stored job command. As with other `pg_net` requests, outbound headers are queued briefly while a request is pending; keep database access restricted and rotate the cleanup secret if it is exposed. The job is bounded to 500 rows per invocation so repeated runs can drain larger backlogs without one long Edge Function execution.

## Important production work still required
1. Deploy and monitor the scheduled Snap cleanup job; the code and migration are committed, but the live Supabase function, Vault secrets and cron execution still require project-owner setup.
2. Add native OS-managed background transfer; the current queue resumes in the foreground after app restarts but does not run while the OS suspends the app.
3. Extend the feed ranking with skip signals, server-side pagination, moderation eligibility and stronger safety/diversity controls.
4. Implement WebRTC calling with a native WebRTC module, signaling, STUN/TURN credentials, call lifecycle, permissions, reconnect handling and abuse controls. Native WebRTC is not supported in Expo Go; use an Expo development build / EAS Build.
5. Add broader automated integration tests, error reporting, rate limits, moderation/report flows, account deletion/export, privacy policy, terms and load/security testing.

## Media and privacy notes
- Video bucket is public for playback. Do not place private media there.
- Chat attachments use a private bucket. Do not persist signed URLs; they grant bearer access until expiration. Storage RLS is required for minting signed URLs.
- Snap bucket is private. New snap rows store the object path, not a signed URL. Storage RLS allows the owner or a follower with access to an unexpired snap row to mint a short-lived signed URL. Legacy rows may still contain signed URLs; their original tokens cannot be refreshed after they expire.
- Set explicit Supabase bucket size/MIME limits appropriate to your launch. Configure storage lifecycle cleanup.
- Supabase Realtime message subscriptions require the messages and message_reads tables to be in the Realtime publication; migrations add them if absent.

## Suggested next milestones
1. Add native OS-managed background uploads and abandoned TUS/local-file cleanup.
2. Add video transcoding, thumbnails and CDN delivery.
3. Implement WebRTC calls with an Expo development build.

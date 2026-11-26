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

In Supabase SQL Editor, run migrations 0001 through 0018 in filename order. Before applying migration 0012, deploy the Snap cleanup Edge Function and configure its Vault secrets as described below. Apply migration 0013 after 0012, then migrations 0014, 0015, 0016, 0017 and 0018 in filename order. In Authentication settings, configure email confirmation and password policies. Never put a Supabase service-role key in the mobile app; only the anon/publishable key belongs in EXPO_PUBLIC variables. RLS is the security boundary.

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
- Video picker and publishing flow: stages the selected file locally, uploads to the private videos bucket in resumable TUS chunks, inserts the matching videos row, and cleans up the object if database finalization fails; creators can choose Public or Followers-only visibility
- Periodic watch-time and completion signals written to video_views
- Persistent upload queue for feed videos, chat attachments and 24-hour snaps, with progress, retry, local file staging, and resume after app restarts
- Resumable Snap photo/video uploads to the private `snaps` bucket, with 24-hour expiry metadata and owner/follower-scoped media access
- Active Snap story tray grouped by creator, with sequential photo/video playback, expiry-aware advancement and short-lived signed URLs
- Per-viewer Snap receipts recorded once per story; owners can see the view count for their own Snaps
- Device push registration, per-category notification preferences, Expo delivery-receipt polling and push tap navigation
- Video reporting and mutual creator blocking, with server-side feed/profile/Story filtering and a blocked-account management list

## Messaging behavior and security
Read receipts are stored in message_reads rather than the legacy messages.read_at field, so group chats can record each reader separately. The authenticated RPC derives the reader from auth.uid(), checks conversation membership, and inserts receipts idempotently. RLS lets a user see their own receipts and lets a sender see receipts for their own messages. Apply migration 0004 before expecting Seen indicators to work.

Group membership changes use SECURITY DEFINER RPCs with a fixed search path. Migration 0005 allows members to leave and lets creators remove other members; the creator may delete a group only when they are its sole member. Migration 0006 allows only the current creator to transfer ownership to an existing member. The previous creator remains a member and can then leave. The client has no direct membership-delete or ownership-update policy.

Migration 0007 scopes private Supabase Presence channels to current conversation members. The client joins a proxy-chat:<conversation UUID> channel with private: true; RLS checks the authenticated user against conversation_members and permits only Presence events on that topic. Online state is ephemeral, is cleared when a client disconnects, and is marked offline while the app is backgrounded; it is restored when the app returns to the foreground. Typing state automatically returns to idle after 1.6 seconds without input and is cleared when the app backgrounds or the user sends a message.

Migration 0008 creates the private chat-attachments bucket and adds messages.media_type. Object paths are stored in message rows, not signed URLs. Storage RLS checks current conversation membership for reads and uploads, verifies the uploader folder matches auth.uid(), and limits deletion to the uploader while they remain a member. The client mints one-hour signed URLs only when rendering messages. Supported media are JPEG, PNG, WebP, MP4, QuickTime and WebM. The client enforces 15 MB per image and 50 MB per video; the bucket has a 100 MB hard limit.

Feed videos, chat attachments and Snap media use Supabase Storage's TUS resumable endpoint with 6 MiB chunks and retry delays. Expo FileSystem copies the picker URI into the app's persistent document directory so a transfer can be resumed after the app process is restarted. The TUS upload URL and queue metadata are persisted in AsyncStorage; access tokens are not persisted with the upload. Supabase TUS session URLs expire after 24 hours; the client discards saved sessions after 23 hours and starts a fresh transfer for the same staged file. Authorization is refreshed before each TUS request. The upload path remains user-scoped for private feed videos and private snaps, and conversation/member-scoped for private chat attachments, so the Storage RLS rules still apply. Migration 0010 stores new snap media as an object path rather than a signed URL. Snap Storage reads are allowed to the owner or to a follower only while the corresponding snap row is visible and unexpired under PostgreSQL RLS; owners can also verify their own upload before row finalization. The app pauses an active transfer when it backgrounds and resumes it when foregrounded. Open Profile > Pending media uploads to recover interrupted jobs; database finalization is idempotent so a completed object is not uploaded a second time if the app closes before its row is created.

This is **resumable foreground transfer with lifecycle pause/resume**, not a guaranteed native background upload service. The JavaScript TUS client cannot continue executing while iOS/Android suspend or terminate the app. True OS-managed background transfer needs a native background upload implementation and an Expo development/release build; it is not claimed here. Snap uploads now use the same resumable queue. The queue still pauses while the OS suspends the app; it is not a native background transfer service.

Pagination fetches the newest 30 messages first, then older pages using a timestamp + message UUID cursor. The screen subscribes to message inserts and receipt inserts while it is open.

## Push notifications
Migration 0009 creates:
- push_devices, whose tokens can only be registered/unregistered through authenticated RPCs and read by their owner
- notification_preferences, with separate message, follow, like and comment switches protected by per-user RLS
- push_outbox, which has no client policies or client grants and is accessible only to the server-side service role

PostgreSQL creates in-app notification rows for new direct/group messages, follows, video likes and video comments. An insert trigger adds eligible events to the private outbox unless that category is disabled. The send Edge Function claims an outbox row atomically, sends Expo Push Service messages in batches, persists successful ticket IDs with an internal push-device UUID (never the raw token), and disables tokens rejected as DeviceNotRegistered. A separate receipt worker polls Expo's receipt endpoint after the 15-minute availability window, records final success/error status, and disables only the device associated with a DeviceNotRegistered receipt. Missing receipts are retried on the next schedule; after 20 unsuccessful polls they are marked unavailable without disabling the device. Both endpoints require separate server-only secrets; the service-role key remains server-side.

### Push deployment (required; not completed by this repository commit)
1. Complete the Snap cleanup prerequisites for migration 0012. Link the Supabase project from mobile/ and deploy both Edge Functions:
   ```bash
   supabase functions deploy send-push-notification
   supabase functions deploy process-push-receipts
   ```
   Both endpoints have JWT verification disabled only because they are called by server webhooks/cron; each requires its own dedicated secret header.
2. Set two independent random Edge Function secrets (at least 32 characters each):
   ```bash
   supabase secrets set PROXY_PUSH_WEBHOOK_SECRET="<webhook-secret>" PROXY_PUSH_RECEIPT_SECRET="<receipt-secret>"
   ```
   Supabase supplies SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Edge Functions. Never copy either value into the app or repository.
3. In Supabase Vault, create `proxy_push_receipt_secret` with the same value as PROXY_PUSH_RECEIPT_SECRET. Migration 0012 already requires `proxy_project_url` and `proxy_publishable_key`; migration 0018 uses those existing secrets plus the receipt secret to schedule the poller. Do not query or print decrypted Vault values.
4. Apply migrations 0001 through 0017 in order, respecting the migration 0012 cleanup prerequisites, then apply `0018_push_receipt_tracking.sql`. It adds the private ticket table and service-role-only claim/finalize RPCs. If the Vault receipt secret was added after migration 0018 was first applied, re-run migration 0018 to install/update the 15-minute cron job.
5. In Supabase Dashboard, create a Database Webhook for INSERT on `public.push_outbox`, targeting the deployed `send-push-notification` function URL. Add `x-proxy-webhook-secret` with PROXY_PUSH_WEBHOOK_SECRET. Do not expose this secret in the mobile app or repository.
6. Verify the scheduled receipt poller:
   ```sql
   select jobid, jobname, schedule, active
   from cron.job
   where jobname = 'proxy-push-receipt-poll';
   ```
   Inspect recent `cron.job_run_details` and service-role-only `push_receipt_tickets` rows through an authorized operator connection. The worker claims at most 300 tickets per run and polls receipts no earlier than 15 minutes after ticket creation.
7. Run `eas init` in mobile/, add the generated EAS project ID to `expo.extra.eas.projectId` in app.json, configure APNs/FCM credentials in EAS, and create a development/release build. Use a physical device for push verification; Android Expo Go does not support remote push for SDK 54.
8. Enable notifications from Profile on the device. Users can disable this device or switch message/follow/like/comment categories independently.

An Expo ticket with status `ok` means the push service accepted the message, not that the operating system delivered it. Receipt polling records the later Expo receipt result; it still cannot prove that a person saw the notification. Missing receipts are retried on later runs and capped at 20 attempts. No service credentials or webhook secrets are committed.

## Video feed behavior and limits
The publish screen defaults to Public and also supports Followers-only. The selected audience is persisted in the local resumable upload job and applied only when the matching `videos` row is finalized; older queued jobs without an audience retain their previous Public behavior. Unknown persisted audience values fail closed instead of silently widening access. Migration 0015's private Storage RLS and the personalized feed RPC enforce the same audience after publication.

The feed calls the authenticated `get_personalized_video_feed` RPC (migration 0013), which ranks a bounded set of recent videos using follow affinity, likes, the viewer's accumulated watch time/completions on each video and creator, freshness, and a modest unseen-video bonus. A per-creator diversity penalty prevents one creator from filling the entire batch. The RPC returns only public videos or follower-only videos the viewer follows, and migration 0014 additionally filters creators blocked in either direction; execution is restricted to authenticated users and it does not expose raw watch-history aggregates. Migration 0015 stores owner-scoped object paths instead of public URLs and signs each video only when its card becomes active, with a five-minute URL lifetime. If migration 0013 is not yet applied, the client falls back only when the RPC is missing to the prior RLS-filtered followed-creators/recent feed. This is a starter ranking, not ML or moderation. Watch metrics are sampled while actively playing and completion comes from expo-video's `playToEnd` event; short sessions may not reach a sample but are flushed when a card loses focus. Feed video publishing uses resumable TUS chunks rather than loading the entire clip into a Blob. For production, add native OS-managed background transfer, moderation, transcoding, thumbnails and CDN delivery. Discover loads 20-video pages through the two-argument personalized feed RPC. The RPC clamps offsets to 200, grows its bounded recent candidate pool with the requested page, preserves migration 0014's mutual block filtering, and uses video IDs as deterministic tie-breakers. The original one-argument RPC remains available during rollout; the client falls back to it for the first 50 results if the new overload is not yet visible in PostgREST. Client-side deduplication prevents repeated cards if watch signals change between page requests.

## Automated verification
- Mobile workflow [run #190](https://github.com/kabeerabdulrahmanburodo-bit/Proxy/actions/runs/44282115167) passed dependency install, TypeScript typecheck and both Edge Function checks (including Snap cleanup tests).
- PostgreSQL 16 workflow [run #2](https://github.com/kabeerabdulrahmanburodo-bit/Proxy/actions/runs/44282115015) applied migration 0013 in a clean test fixture and passed ranking, follower-only/private visibility, limit and execute-grant assertions.
- No live Supabase project or physical device was used for this run; production migration/RLS/Storage and playback/upload checks remain pending. Lint and mobile unit-test scripts are not configured.

## Video reporting and creator blocking

Migration 0014 adds private video reports and viewer-scoped block controls:
- The feed's video menu lets a viewer report spam, harassment, hate, nudity, violence, copyright infringement or another issue.
- Reports are inserted through the authenticated `report_video` RPC. A viewer can create one report per video; repeated submissions are idempotent, and new reports are capped at 20 per viewer per hour. The report table has no mobile-client read/write grants and is reserved for a trusted service-role moderation workflow.
- Blocking is mutual for content visibility: both accounts' videos, profiles, comments, likes and active Snaps are hidden from one another. RLS also rejects new likes, comments and watch-time rows for videos the viewer cannot access. Existing follow edges in both directions are removed; new follow attempts are rejected while either block remains active.
- Profile settings list the accounts the current user has blocked and allow them to be unblocked. Unblocking does not restore follows automatically.
- Blocking does not delete existing conversations. Migration 0016 disables new direct messages, message edits and chat-attachment uploads in both directions while a block is active. Existing history and previously shared attachments remain readable; group chats remain available.
- Migration 0015 makes the `videos` Storage bucket private. Feed cards obtain a five-minute signed URL only when they become active; Storage RLS permits the owner and eligible public/follower viewers, and rejects both directions of a block. Previously issued signed URLs remain bearer links until their five-minute expiry.
- This repository adds report capture, not a moderator dashboard or automated takedown pipeline. A trusted operator must review pending rows in `video_reports` and apply any moderation action.

Apply migration `0014_video_safety_controls.sql` after `0013_personalized_video_feed.sql`, then apply `0015_private_video_delivery.sql` to make the feed bucket private. The migration grants only the report/block RPCs to authenticated users, keeps report rows service-role-only, and does not add any service credential to the mobile app.

## Automated safety verification
- The PostgreSQL 16 [Video safety SQL workflow](https://github.com/kabeerabdulrahmanburodo-bit/Proxy/actions/workflows/video-safety-sql.yml) applies migrations 0013 and 0014 in an isolated fixture and checks both block directions, feed/RLS filtering, follow prevention, report idempotency/privacy and RPC privileges.
- Live Supabase deployment, real-account moderation testing and device UI testing remain separate production checks.

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

## Private video delivery

Migration `0015_private_video_delivery.sql` changes the `videos` bucket from public to private and removes the anonymous/public Storage read policy. New video rows store only the owner's Storage object path (for example `<user-uuid>/<file>`), never a public or signed URL. The database trigger rejects new or changed video references that do not use the row owner's folder.

The migration converts existing Supabase `.supabase.co` public video URLs with owner-scoped paths to object paths. Legacy external URLs and paths whose first folder does not match the row owner are retained in PostgreSQL but changed to `visibility='private'`; the owner must re-upload those clips to restore feed distribution. This avoids silently serving media that cannot be protected by this project's Storage RLS.

The Storage read policy allows an owner to inspect their own upload before its `videos` row is finalized, and otherwise requires a visible video row. Public videos are readable to signed-in users, follower-only videos to current followers, and both directions of an active block are denied. Anonymous reads are disabled. Upload and owner-delete policies remain user-folder scoped.

The feed signs a video only when its card becomes active, using a five-minute expiry. Returning to a card requests a fresh URL. A signed URL already issued is a bearer link and cannot be revoked immediately; it remains usable until expiry. Old public CDN cache entries may persist until their cache lifetime expires. No public bucket URL is returned by the feed RPC.

## Block-aware direct messaging (migration 0016)

Blocking now disables new direct messages in both directions, including when the direct conversation already existed before the block. The server checks the relationship when a direct conversation is created/reopened and through the message insert/update RLS policies, so bypassing the mobile UI does not bypass the restriction.

Chat-attachment uploads to a blocked direct conversation are also denied by Storage RLS before a new object can be created. Existing message history and previously shared attachments remain readable; conversations are not deleted. Group chats remain usable even when two members have blocked each other. Unblocking restores access to the prior direct conversation; follow relationships are not automatically restored.

The chat screen checks the server permission before enabling the composer and attachment picker. If the check fails, sending is disabled and the user can retry the permission check. The database policies remain authoritative if a block changes while a screen is open.

Apply `0016_blocked_direct_messaging.sql` after `0015_private_video_delivery.sql`. The PostgreSQL 16 fixture `supabase/tests/0016_blocked_direct_messaging.sql` reuses the video-safety fixture and verifies both block directions, existing-chat restrictions, group-chat behavior, attachment upload denial, retained history, unblock recovery and RPC grants.

## Important production work still required
1. Deploy and monitor the scheduled Snap cleanup and push-receipt jobs; their functions, Vault secrets and cron schedules still require project-owner setup.
2. Add native OS-managed background transfer; the current queue resumes in the foreground after app restarts but does not run while the OS suspends the app.
3. Add a trusted moderation console and enforcement workflow for pending video reports; keep signed playback URLs short-lived; an already issued URL remains usable until its five-minute expiry.
4. Implement WebRTC calling with a native WebRTC module, signaling, STUN/TURN credentials, call lifecycle, permissions, reconnect handling and abuse controls. Native WebRTC is not supported in Expo Go; use an Expo development build / EAS Build.
5. Add broader automated integration tests, error reporting, rate limits, moderation/report flows, account deletion/export, privacy policy, terms and load/security testing.

## Media and privacy notes
- Video bucket is private. Feed playback uses short-lived signed URLs minted only after Storage RLS authorizes the current viewer.
- Chat attachments use a private bucket. Do not persist signed URLs; they grant bearer access until expiration. Storage RLS is required for minting signed URLs.
- Snap bucket is private. New snap rows store the object path, not a signed URL. Storage RLS allows the owner or a follower with access to an unexpired snap row to mint a short-lived signed URL. Legacy rows may still contain signed URLs; their original tokens cannot be refreshed after they expire.
- Set explicit Supabase bucket size/MIME limits appropriate to your launch. Configure storage lifecycle cleanup.
- Supabase Realtime message subscriptions require the messages and message_reads tables to be in the Realtime publication; migrations add them if absent.

## Suggested next milestones
1. Add native OS-managed background uploads and abandoned TUS/local-file cleanup.
2. Add video transcoding, thumbnails and CDN delivery.
3. Implement WebRTC calls with an Expo development build.

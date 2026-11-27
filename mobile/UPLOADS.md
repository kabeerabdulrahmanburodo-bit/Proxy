# PROXY media upload queue

## Current behavior

Video posts persist their selected Public or Followers-only audience in the same queue record as the staged media. The audience is applied only when the matching PostgreSQL `videos` row is finalized, so retries cannot accidentally publish a followers-only clip as public. Legacy queue records without an audience retain the prior Public default; unknown values fail closed.

Feed videos, private chat attachments and 24-hour Snaps are staged in the app's persistent document directory and uploaded to Supabase Storage with resumable TUS sessions using 6 MiB chunks. Queue metadata and TUS session URLs are stored in AsyncStorage; authentication tokens are refreshed at request time and are not persisted in the queue.

Hosted Supabase project URLs are routed to the dedicated `<project-ref>.storage.supabase.co` resumable-upload hostname. Local and self-hosted Supabase URLs retain their configured origin and port. This endpoint resolution is covered by Deno tests for hosted, local, custom-host and invalid URL cases.

The app pauses the JavaScript TUS loop when it backgrounds and resumes it when it returns. After an app restart, the pending-upload screen can resume from the saved TUS session. Supabase TUS sessions are discarded locally after 23 hours so the client starts a fresh session before the server's 24-hour session expiry.

## Queue recovery and cleanup

- The app scans its dedicated `proxy-upload-queue` directory when pending uploads are loaded.
- A staged file is removed only when no persisted upload job references its URI and its filesystem modification/creation time is at least one hour old. Unknown timestamps and recent files are preserved.
- The one-hour grace period protects a file that has been copied but whose queue record has not yet finished being written.
- If Storage already contains the expected object, recovery can finalize the matching video/Snap/message row even if the local staged copy has since disappeared.
- The staged file is retained if local queue-record removal fails after successful publication, so a later retry can detect the remote object and finish cleanup.
- Users can discard a paused/failed upload. The app checks for its final PostgreSQL row first; media already linked to a video, Snap or message is preserved. If no row exists, an uploaded object is removed through the authenticated Storage API before the local queue entry is deleted. RLS remains the authorization boundary.
- An incomplete TUS session is not deleted by direct database access. Its local reference is cleared on discard; the server expires abandoned sessions according to Supabase's TUS lifecycle.

## Native background-transfer limitation

This branch does **not** claim guaranteed OS-managed background uploads. The current TUS client is orchestrated by JavaScript and schedules sequential PATCH chunks. Expo's native upload task can continue an individual request while iOS is suspended, but its JavaScript task handle and callbacks are not restored after process termination. A background-task scheduler is deferrable work, not a reliable replacement for a long-running media transfer. Android/iOS behavior must be verified in development/release builds before enabling such a mode.

A production-grade native implementation needs a native task coordinator that persists each upload's TUS URL, byte offset, staged-file reference and task identifier, resumes the TUS HEAD/PATCH protocol after OS callbacks or relaunch, refreshes short-lived auth safely, and finalizes the database row idempotently. It must be tested on physical iOS and Android devices, including app suspension, process termination, reboot, connectivity loss and expired sessions. Until then, PROXY keeps the existing resumable foreground flow rather than switching to a non-resumable whole-file upload.

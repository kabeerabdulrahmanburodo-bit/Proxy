# Security and production checklist

- Do not ship a Supabase service-role key in the app. Use only the anon/publishable key client-side.
- Current example policies are a starting point. Review them before launch: profiles are readable by all authenticated users; post visibility currently only enforces public vs owner; stories policy currently exposes non-expired stories to all signed-in users. Implement follower/friend privacy checks before supporting private audiences.
- Add database RPCs or carefully designed policies for conversation membership, blocking and reporting.
- For disappearing snaps, enforce expiry on the server and storage layer; deleting a database row alone does not delete the media object.
- Validate media size/type and use server-side transcoding, thumbnails and moderation.
- Add rate limits, abuse reporting, account deletion, age-appropriate safeguards, and push notification controls.
- Enable MFA / account recovery as appropriate. Never trust client-supplied user IDs; use auth.uid().

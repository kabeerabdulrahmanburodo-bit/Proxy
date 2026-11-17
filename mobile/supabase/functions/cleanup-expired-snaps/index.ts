import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { getSnapStoragePath } from "./domain.ts";

type ExpiredSnap = {
  id: string;
  user_id: string;
  media_url: string;
  expires_at: string;
};

const MAX_ROWS_PER_RUN = 500;
const REMOVE_BATCH_SIZE = 500;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function constantTimeEqual(left: string, right: string) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

Deno.serve(async request => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("PROXY_SNAP_CLEANUP_SECRET") ?? "";
  const suppliedSecret = request.headers.get("x-proxy-snap-cleanup-secret") ?? "";
  if (
    expectedSecret.length < 32 ||
    !constantTimeEqual(suppliedSecret, expectedSecret)
  ) {
    return json({ error: "Unauthorized cleanup request" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server-side Supabase credentials are not configured" }, 500);
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const cutoff = new Date().toISOString();

    const { data, error: queryError } = await admin
      .from("snaps")
      .select("id,user_id,media_url,expires_at")
      .lte("expires_at", cutoff)
      .order("expires_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(MAX_ROWS_PER_RUN);

    if (queryError) throw queryError;

    const expiredSnaps = (data ?? []) as ExpiredSnap[];
    if (expiredSnaps.length === 0) {
      return json({ ok: true, scanned: 0, objectsRemoved: 0, rowsDeleted: 0 });
    }

    const idsByPath = new Map<string, string[]>();
    const invalidSnaps: ExpiredSnap[] = [];

    for (const snap of expiredSnaps) {
      const objectPath = getSnapStoragePath(snap.media_url, snap.user_id, supabaseUrl);
      if (!objectPath) {
        invalidSnaps.push(snap);
        continue;
      }
      const ids = idsByPath.get(objectPath) ?? [];
      ids.push(snap.id);
      idsByPath.set(objectPath, ids);
    }

    let invalidPathRowsDeleted = 0;
    if (invalidSnaps.length > 0) {
      const issueRows = invalidSnaps.map(snap => ({
        snap_id: snap.id,
        user_id: snap.user_id,
        reason: "invalid_or_external_object_path",
      }));
      const { error: issueError } = await admin
        .from("snap_cleanup_issues")
        .upsert(issueRows, { onConflict: "snap_id" });
      if (issueError) throw issueError;

      const { data: deletedInvalid, error: deleteInvalidError } = await admin
        .from("snaps")
        .delete()
        .in("id", invalidSnaps.map(snap => snap.id))
        .lte("expires_at", cutoff)
        .select("id");
      if (deleteInvalidError) throw deleteInvalidError;
      invalidPathRowsDeleted = deletedInvalid?.length ?? 0;
      console.warn(
        "Removed expired Snap rows with invalid or external Storage paths; manual orphan audit may be required",
        { count: invalidPathRowsDeleted },
      );
    }

    let objectsRemoved = 0;
    let rowsDeleted = invalidPathRowsDeleted;
    let storageFailedBatches = 0;
    let databaseFailedBatches = 0;
    let activeReferencesProtected = 0;
    const objectPaths = Array.from(idsByPath.keys());

    // Do not remove a file if a still-active Snap also references it. This also
    // handles legacy signed URLs whose token differs but whose object path is the same.
    const ownerIds = Array.from(new Set(expiredSnaps.map(snap => snap.user_id)));
    const activePaths = new Set<string>();
    if (objectPaths.length > 0 && ownerIds.length > 0) {
      const { data: activeSnaps, error: activeError } = await admin
        .from("snaps")
        .select("user_id,media_url")
        .in("user_id", ownerIds)
        .gt("expires_at", cutoff)
        .limit(1000);
      if (activeError) throw activeError;
      if ((activeSnaps ?? []).length === 1000) {
        // Fail closed rather than risk truncating the active-reference check.
        return json({ error: "Too many active Snap references for a safe cleanup pass" }, 503);
      }
      for (const activeSnap of activeSnaps ?? []) {
        const activePath = getSnapStoragePath(activeSnap.media_url, activeSnap.user_id, supabaseUrl);
        if (activePath) activePaths.add(activePath);
      }
    }

    const protectedPaths = objectPaths.filter(path => activePaths.has(path));
    activeReferencesProtected = protectedPaths.length;
    for (const path of protectedPaths) {
      const snapIds = idsByPath.get(path) ?? [];
      const { data: deleted, error: deleteError } = await admin
        .from("snaps")
        .delete()
        .in("id", snapIds)
        .lte("expires_at", cutoff)
        .select("id");
      if (deleteError) {
        databaseFailedBatches += 1;
        console.error("Expired Snap rows sharing an active object could not be deleted", {
          rowCount: snapIds.length,
          message: deleteError.message.slice(0, 240),
        });
        continue;
      }
      rowsDeleted += deleted?.length ?? 0;
    }

    const deletablePaths = objectPaths.filter(path => !activePaths.has(path));
    for (let offset = 0; offset < deletablePaths.length; offset += REMOVE_BATCH_SIZE) {
      const batchPaths = deletablePaths.slice(offset, offset + REMOVE_BATCH_SIZE);
      const snapIds = batchPaths.flatMap(path => idsByPath.get(path) ?? []);

      const { error: storageError } = await admin.storage.from("snaps").remove(batchPaths);
      if (storageError) {
        storageFailedBatches += 1;
        console.error("Snap Storage removal failed; rows were retained for retry", {
          objectCount: batchPaths.length,
          message: storageError.message.slice(0, 240),
        });
        continue;
      }
      objectsRemoved += batchPaths.length;

      const { data: deleted, error: deleteError } = await admin
        .from("snaps")
        .delete()
        .in("id", snapIds)
        .lte("expires_at", cutoff)
        .select("id");
      if (deleteError) {
        databaseFailedBatches += 1;
        console.error("Snap rows could not be deleted after Storage removal; next run will retry", {
          rowCount: snapIds.length,
          message: deleteError.message.slice(0, 240),
        });
        continue;
      }
      rowsDeleted += deleted?.length ?? 0;
    }

    const ok = storageFailedBatches === 0 && databaseFailedBatches === 0;
    return json({
      ok,
      scanned: expiredSnaps.length,
      objectsRemoved,
      rowsDeleted,
      invalidPathRowsDeleted,
      activeReferencesProtected,
      storageFailedBatches,
      databaseFailedBatches,
      batchLimitReached: expiredSnaps.length === MAX_ROWS_PER_RUN,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Snap cleanup failed.";
    console.error("Expired Snap cleanup failed", { message: message.slice(0, 300) });
    return json({ error: "Expired Snap cleanup failed" }, 500);
  }
});

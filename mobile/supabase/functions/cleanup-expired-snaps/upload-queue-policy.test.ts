import {
  ORPHAN_STAGED_FILE_GRACE_MS,
  shouldDeleteOrphanedStagedFile,
  shouldRequireStagedFile,
} from "../../../lib/upload-queue-policy.ts";

Deno.test("queued staged files are never treated as orphans", () => {
  const now = 10 * ORPHAN_STAGED_FILE_GRACE_MS;
  const referenced = new Set(["file:///proxy-upload-queue/active.mp4"]);
  if (shouldDeleteOrphanedStagedFile(
    "file:///proxy-upload-queue/active.mp4",
    referenced,
    now - 10 * ORPHAN_STAGED_FILE_GRACE_MS,
    now,
  )) throw new Error("A file referenced by a pending job must be preserved");
});

Deno.test("recent orphan files receive a grace period", () => {
  const now = 10 * ORPHAN_STAGED_FILE_GRACE_MS;
  if (shouldDeleteOrphanedStagedFile(
    "file:///proxy-upload-queue/new-orphan.mp4",
    new Set(),
    now - ORPHAN_STAGED_FILE_GRACE_MS / 2,
    now,
  )) throw new Error("A recently created file must not be removed");
});

Deno.test("old unreferenced staged files can be cleaned", () => {
  const now = 10 * ORPHAN_STAGED_FILE_GRACE_MS;
  if (!shouldDeleteOrphanedStagedFile(
    "file:///proxy-upload-queue/abandoned.mp4",
    new Set(),
    now - ORPHAN_STAGED_FILE_GRACE_MS - 1,
    now,
  )) throw new Error("An old unreferenced file should be eligible for cleanup");
});

Deno.test("unknown or future file timestamps fail closed", () => {
  const now = 10 * ORPHAN_STAGED_FILE_GRACE_MS;
  if (shouldDeleteOrphanedStagedFile("unknown", new Set(), null, now)) {
    throw new Error("A file with unknown age must be preserved");
  }
  if (shouldDeleteOrphanedStagedFile("future", new Set(), now + 1000, now)) {
    throw new Error("A future timestamp must be preserved");
  }
});

Deno.test("a completed remote object can be finalized without the local staged copy", () => {
  if (shouldRequireStagedFile(true)) {
    throw new Error("An existing remote object does not need a local staged copy");
  }
  if (!shouldRequireStagedFile(false)) {
    throw new Error("A missing remote object still requires the staged file");
  }
});

import {
  ORPHAN_STAGED_FILE_GRACE_MS,
  resolveVideoVisibility,
  shouldDeleteOrphanedStagedFile,
  shouldRequireStagedFile,
} from "../../../lib/upload-queue-policy.ts";
import { resolveTusEndpoint } from "../../../lib/tus-endpoint.ts";

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


Deno.test("legacy video upload jobs without an audience remain public", () => {
  if (resolveVideoVisibility(undefined) !== "public") {
    throw new Error("Legacy upload jobs must preserve their previous public behavior");
  }
});

Deno.test("followers-only audience survives upload queue recovery", () => {
  if (resolveVideoVisibility("followers") !== "followers") {
    throw new Error("Followers-only visibility must be preserved during finalization");
  }
});

Deno.test("private audience remains private for persisted jobs", () => {
  if (resolveVideoVisibility("private") !== "private") {
    throw new Error("Private visibility must not be widened during upload recovery");
  }
});

Deno.test("invalid persisted video visibility fails closed", () => {
  let rejected = false;
  try {
    resolveVideoVisibility("friends");
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Unknown visibility values must not silently become public");
});


Deno.test("hosted Supabase projects use the dedicated Storage upload hostname", () => {
  const endpoint = resolveTusEndpoint("https://proxy-project.supabase.co");
  if (endpoint !== "https://proxy-project.storage.supabase.co/storage/v1/upload/resumable") {
    throw new Error("Hosted Supabase uploads must use the Storage hostname; received " + endpoint);
  }
});

Deno.test("hosted Supabase project URLs with paths still resolve from the project origin", () => {
  const endpoint = resolveTusEndpoint("https://proxy-project.supabase.co/rest/v1");
  if (endpoint !== "https://proxy-project.storage.supabase.co/storage/v1/upload/resumable") {
    throw new Error("The configured path must not leak into the Storage endpoint; received " + endpoint);
  }
});

Deno.test("local Supabase URLs preserve host and port", () => {
  const endpoint = resolveTusEndpoint("http://127.0.0.1:54321");
  if (endpoint !== "http://127.0.0.1:54321/storage/v1/upload/resumable") {
    throw new Error("Local Supabase must keep its origin and port; received " + endpoint);
  }
});

Deno.test("self-hosted Supabase URLs preserve their configured origin", () => {
  const endpoint = resolveTusEndpoint("https://supabase.example.internal:8443/base");
  if (endpoint !== "https://supabase.example.internal:8443/storage/v1/upload/resumable") {
    throw new Error("Self-hosted Supabase must keep its origin and port; received " + endpoint);
  }
});

Deno.test("invalid and non-HTTP Supabase URLs are rejected", () => {
  for (const value of ["not-a-url", "ftp://proxy-project.supabase.co"]) {
    let rejected = false;
    try {
      resolveTusEndpoint(value);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Expected invalid URL to be rejected: " + value);
  }
});

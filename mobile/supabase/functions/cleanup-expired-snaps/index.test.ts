import { getSnapStoragePath } from "./domain.ts";

const projectUrl = "https://proxy-example.supabase.co";
const ownerId = "5f0b9d4e-5b57-4c75-a3a5-5f45a9c8d123";

Deno.test("accepts a new owner-scoped Storage object path", () => {
  const result = getSnapStoragePath(ownerId + "/clip.mp4", ownerId, projectUrl);
  if (result !== ownerId + "/clip.mp4") throw new Error("Expected owner-scoped path");
});

Deno.test("extracts an owner-scoped path from a legacy signed Snap URL", () => {
  const url = projectUrl + "/storage/v1/object/sign/snaps/" + ownerId +
    "/photo.jpg?token=legacy-bearer-token";
  const result = getSnapStoragePath(url, ownerId, projectUrl);
  if (result !== ownerId + "/photo.jpg") throw new Error("Expected signed URL path");
});

Deno.test("rejects a signed URL from another Supabase project", () => {
  const url = "https://attacker.supabase.co/storage/v1/object/sign/snaps/" +
    ownerId + "/photo.jpg?token=secret";
  if (getSnapStoragePath(url, ownerId, projectUrl) !== null) {
    throw new Error("External project URL must be rejected");
  }
});

Deno.test("rejects other buckets and public object URLs", () => {
  const chatUrl = projectUrl + "/storage/v1/object/sign/chat-attachments/" +
    ownerId + "/photo.jpg?token=secret";
  const publicUrl = projectUrl + "/storage/v1/object/public/snaps/" +
    ownerId + "/photo.jpg";
  if (getSnapStoragePath(chatUrl, ownerId, projectUrl) !== null) {
    throw new Error("Chat attachment URL must be rejected");
  }
  if (getSnapStoragePath(publicUrl, ownerId, projectUrl) !== null) {
    throw new Error("Public URL must be rejected");
  }
});

Deno.test("rejects another user's folder and nested paths", () => {
  if (getSnapStoragePath("someone-else/photo.jpg", ownerId, projectUrl) !== null) {
    throw new Error("Another user's folder must be rejected");
  }
  if (getSnapStoragePath(ownerId + "/nested/photo.jpg", ownerId, projectUrl) !== null) {
    throw new Error("Nested paths must be rejected");
  }
});

Deno.test("rejects traversal, query strings and malformed URLs", () => {
  const invalidPaths = [
    ownerId + "/../private.jpg",
    ownerId + "/%2e%2e.jpg",
    ownerId + "/photo.jpg?token=forged",
    "https://[invalid-url",
    "",
  ];
  for (const path of invalidPaths) {
    if (getSnapStoragePath(path, ownerId, projectUrl) !== null) {
      throw new Error("Invalid path was accepted: " + path);
    }
  }
});

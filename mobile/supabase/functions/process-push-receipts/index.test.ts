import { resolveExpoReceipt, splitIntoBatches } from "./domain.ts";

Deno.test("splits receipt IDs into bounded batches", () => {
  const values = Array.from({ length: 601 }, (_, index) => index);
  const batches = splitIntoBatches(values, 300);
  if (batches.length !== 3 || batches[0].length !== 300 ||
      batches[1].length !== 300 || batches[2].length !== 1) {
    throw new Error("Expected 300/300/1 receipt batches");
  }
});

Deno.test("returns no batches for an empty receipt list", () => {
  if (splitIntoBatches([]).length !== 0) throw new Error("Expected no batches");
});

Deno.test("rejects unsafe batch sizes", () => {
  for (const size of [0, -1, 301, 1.5]) {
    let rejected = false;
    try {
      splitIntoBatches([1], size);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Expected batch size " + size + " to be rejected");
  }
});

Deno.test("recognizes successful Expo receipts", () => {
  const result = resolveExpoReceipt({ status: "ok" });
  if (result.status !== "ok" || result.code !== null) {
    throw new Error("Expected successful receipt");
  }
});

Deno.test("recognizes DeviceNotRegistered without exposing token data", () => {
  const result = resolveExpoReceipt({
    status: "error",
    message: "The recipient is no longer registered.",
    details: { error: "DeviceNotRegistered" },
  });
  if (result.status !== "error" || result.code !== "DeviceNotRegistered") {
    throw new Error("Expected DeviceNotRegistered classification");
  }
  if (!result.message?.includes("no longer registered")) throw new Error("Expected receipt message to be preserved");
});

Deno.test("does not disable devices for other receipt errors", () => {
  const result = resolveExpoReceipt({
    status: "error",
    message: "Message rate exceeded",
    details: { error: "MessageRateExceeded" },
  });
  if (result.status !== "error" || result.code !== "MessageRateExceeded") {
    throw new Error("Expected non-device receipt error");
  }
});

Deno.test("keeps missing and malformed receipts pending", () => {
  for (const value of [null, undefined, {}, { status: "unknown" }, "invalid"]) {
    if (resolveExpoReceipt(value).status !== "pending") {
      throw new Error("Missing or malformed receipts must remain pending");
    }
  }
});

Deno.test("bounds external receipt text before persistence", () => {
  const result = resolveExpoReceipt({
    status: "error",
    message: "x".repeat(900),
    details: { error: "y".repeat(200) },
  });
  if (result.message?.length !== 500 || result.code?.length !== 120) {
    throw new Error("Receipt error fields must be bounded");
  }
});

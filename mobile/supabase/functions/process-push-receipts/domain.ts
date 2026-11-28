export type ReceiptResolution = {
  status: "ok" | "error" | "pending";
  code: string | null;
  message: string | null;
};

export type ExpoReceipt = {
  status?: unknown;
  message?: unknown;
  details?: { error?: unknown } | null;
};

export function splitIntoBatches<T>(items: T[], maximumSize = 300): T[][] {
  if (!Number.isInteger(maximumSize) || maximumSize < 1 || maximumSize > 300) {
    throw new Error("Receipt batch size must be between 1 and 300.");
  }
  const batches: T[][] = [];
  for (let offset = 0; offset < items.length; offset += maximumSize) {
    batches.push(items.slice(offset, offset + maximumSize));
  }
  return batches;
}

export function resolveExpoReceipt(value: unknown): ReceiptResolution {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "pending", code: null, message: "Expo receipt is not available yet." };
  }

  const receipt = value as ExpoReceipt;
  if (receipt.status === "ok") {
    return { status: "ok", code: null, message: null };
  }

  if (receipt.status === "error") {
    const code = typeof receipt.details?.error === "string"
      ? receipt.details.error.slice(0, 120)
      : null;
    const message = typeof receipt.message === "string"
      ? receipt.message.slice(0, 500)
      : "Expo reported a push delivery error.";
    return { status: "error", code, message };
  }

  return { status: "pending", code: null, message: "Expo receipt is not available yet." };
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { resolveExpoReceipt, splitIntoBatches } from "./domain.ts";

type ClaimedReceipt = {
  id: string;
  ticket_id: string;
  push_device_id: string | null;
};

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

  const expectedSecret = Deno.env.get("PROXY_PUSH_RECEIPT_SECRET");
  const suppliedSecret = request.headers.get("x-proxy-push-receipt-secret") ?? "";
  if (!expectedSecret || !constantTimeEqual(suppliedSecret, expectedSecret)) {
    return json({ error: "Unauthorized receipt worker" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server-side Supabase credentials are not configured" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let claimedTickets: ClaimedReceipt[] = [];
  try {
    const payload = await request.json().catch(() => ({}));
    const requestedLimit = Number.isInteger(payload?.limit) ? payload.limit as number : 300;
    const limit = Math.max(1, Math.min(300, requestedLimit));

    const { data, error } = await admin.rpc("claim_push_receipt_tickets", {
      maximum_count: limit,
    });
    if (error) throw error;
    claimedTickets = Array.isArray(data) ? data as ClaimedReceipt[] : [];

    if (claimedTickets.length === 0) {
      return json({ ok: true, claimed: 0, checked: 0, pending: 0, failed: 0 });
    }

    let checked = 0;
    let pending = 0;
    let failed = 0;

    for (const batch of splitIntoBatches(claimedTickets, 300)) {
      const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify({ ids: batch.map(ticket => ticket.ticket_id) }),
      });

      if (!response.ok) {
        throw new Error("Expo Push Service receipt lookup was unsuccessful.");
      }

      const result = await response.json();
      const receipts = result?.data;
      if (!receipts || typeof receipts !== "object" || Array.isArray(receipts)) {
        throw new Error("Expo Push Service returned an invalid receipt response.");
      }

      for (const ticket of batch) {
        const resolution = resolveExpoReceipt(receipts[ticket.ticket_id]);
        const { error: finishError } = await admin.rpc("finish_push_receipt_ticket", {
          target_ticket_id: ticket.id,
          receipt_status: resolution.status,
          receipt_error_code: resolution.code,
          receipt_error_message: resolution.message,
        });
        if (finishError) throw finishError;

        if (resolution.status === "pending") pending += 1;
        else if (resolution.status === "error") failed += 1;
        else checked += 1;
      }
    }

    return json({
      ok: true,
      claimed: claimedTickets.length,
      checked,
      pending,
      failed,
    });
  } catch {
    // Release every still-processing claim for the next scheduled run. Rows already
    // finalized return false and are left unchanged; no receipt is marked delivered
    // merely because the Expo HTTP request itself succeeded.
    await Promise.allSettled(claimedTickets.map(ticket =>
      admin.rpc("finish_push_receipt_ticket", {
        target_ticket_id: ticket.id,
        receipt_status: "pending",
        receipt_error_code: null,
        receipt_error_message: "Receipt lookup failed; it will be retried.",
      })
    ));
    return json({ error: "Push receipt processing failed; pending tickets will be retried." }, 502);
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

type PushJob = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  attempts: number;
};

type ExpoTicket = {
  id?: string;
  status?: "ok" | "error";
  message?: string;
  details?: { error?: string };
};

type PushDevice = {
  id: string;
  expo_push_token: string;
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

  const webhookSecret = Deno.env.get("PROXY_PUSH_WEBHOOK_SECRET");
  const suppliedSecret = request.headers.get("x-proxy-webhook-secret") ?? "";
  if (!webhookSecret || !constantTimeEqual(suppliedSecret, webhookSecret)) {
    return json({ error: "Unauthorized webhook" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server-side Supabase credentials are not configured" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let job: PushJob | null = null;
  try {
    const payload = await request.json();
    const outboxId = payload?.record?.id;
    if (typeof outboxId !== "string") return json({ error: "Missing outbox record id" }, 400);

    const { data: claimed, error: claimError } = await admin.rpc("claim_push_outbox", {
      target_id: outboxId,
    });
    if (claimError) throw claimError;
    job = (Array.isArray(claimed) ? claimed[0] : null) as PushJob | null;
    if (!job) return json({ ok: true, skipped: "Already claimed, processed, or retry limit reached" });

    const { data: devices, error: devicesError } = await admin
      .from("push_devices")
      .select("id,expo_push_token")
      .eq("user_id", job.user_id)
      .eq("enabled", true);
    if (devicesError) throw devicesError;

    const eligibleDevices = (devices ?? []) as PushDevice[];

    if (eligibleDevices.length === 0) {
      await admin.from("push_outbox").update({
        status: "skipped",
        last_error: "No enabled devices are registered for this user.",
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      return json({ ok: true, skipped: "No registered devices" });
    }

    let successCount = 0;
    const errors: string[] = [];
    const invalidDeviceIds: string[] = [];

    for (let offset = 0; offset < eligibleDevices.length; offset += 100) {
      const chunk = eligibleDevices.slice(offset, offset + 100);
      const messages = chunk.map(device => ({
        to: device.expo_push_token,
        title: job!.title,
        body: job!.body,
        sound: "default",
        channelId: "default",
        priority: "high",
        ttl: 86400,
        data: job!.data ?? {},
      }));

      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(messages),
      });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result?.data)) {
        throw new Error("Expo Push Service returned an unsuccessful response.");
      }

      const tickets = result.data as ExpoTicket[];
      if (tickets.length !== chunk.length) {
        errors.push("Expo returned a different number of tickets than submitted messages.");
      }

      const receiptRows: Array<{
        outbox_id: string;
        ticket_id: string;
        push_device_id: string;
      }> = [];

      tickets.forEach((ticket, index) => {
        const device = chunk[index];
        if (ticket.status === "ok") {
          successCount += 1;
          if (device && typeof ticket.id === "string" && ticket.id.length > 0) {
            receiptRows.push({
              outbox_id: job!.id,
              ticket_id: ticket.id,
              push_device_id: device.id,
            });
          } else {
            errors.push("Expo accepted a push without a usable receipt ID.");
          }
        } else {
          errors.push((ticket.message || "Expo rejected a push message.").slice(0, 180));
          if (ticket.details?.error === "DeviceNotRegistered" && device) {
            invalidDeviceIds.push(device.id);
          }
        }
      });

      if (receiptRows.length > 0) {
        const { error: receiptInsertError } = await admin
          .from("push_receipt_tickets")
          .upsert(receiptRows, { onConflict: "ticket_id", ignoreDuplicates: true });
        if (receiptInsertError) {
          errors.push("Could not persist delivery receipt tracking for one or more devices.");
        }
      }
    }

    if (invalidDeviceIds.length > 0) {
      const { error } = await admin.from("push_devices")
        .update({ enabled: false })
        .in("id", invalidDeviceIds);
      if (error) errors.push("Could not disable invalid device tokens.");
    }

    const sent = successCount > 0;
    const { error: updateError } = await admin.from("push_outbox").update({
      status: sent ? "sent" : "failed",
      sent_at: sent ? new Date().toISOString() : null,
      last_error: errors.length ? errors.slice(0, 10).join("; ").slice(0, 1000) : null,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    if (updateError) throw updateError;

    if (!sent) return json({ ok: false, delivered: 0, errors: errors.length }, 502);
    return json({ ok: true, delivered: successCount, errors: errors.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Push delivery failed.";
    if (job) {
      await admin.from("push_outbox").update({
        status: "failed",
        last_error: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    }
    return json({ error: "Push delivery failed", detail: message.slice(0, 240) }, 502);
  }
});

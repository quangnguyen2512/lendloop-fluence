import { httpRouter } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
  todayUtcIso,
  verifyHmacRequest,
} from "./security";

const http = httpRouter();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * GET /api/automation/overdue-loans
 * Authenticated via HMAC-SHA256 over `${timestamp}.GET:/api/automation/overdue-loans`.
 */
http.route({
  path: "/api/automation/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = await verifyHmacRequest({
      secret: process.env.LENDLOOP_HMAC_SECRET,
      rawBody: "GET:/api/automation/overdue-loans",
      signatureHeader: request.headers.get(HMAC_SIGNATURE_HEADER),
      timestampHeader: request.headers.get(HMAC_TIMESTAMP_HEADER),
    });

    if (!auth.ok) {
      return jsonResponse({ error: auth.error }, auth.status);
    }

    const todayIso = todayUtcIso();
    const loans = await ctx.runQuery(internal.loans.getOverdueLoansInternal, {
      todayIso,
    });

    return jsonResponse({
      generatedAt: new Date().toISOString(),
      todayUtc: todayIso,
      count: loans.length,
      loans,
    });
  }),
});

/**
 * POST /api/automation/reminder-logged
 * Authenticated via HMAC-SHA256 over `${timestamp}.${rawBody}`.
 * Enforces deterministic idempotency (`overdue:{loanId}:{YYYY-MM-DD}`).
 */
http.route({
  path: "/api/automation/reminder-logged",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const auth = await verifyHmacRequest({
      secret: process.env.LENDLOOP_HMAC_SECRET,
      rawBody,
      signatureHeader: request.headers.get(HMAC_SIGNATURE_HEADER),
      timestampHeader: request.headers.get(HMAC_TIMESTAMP_HEADER),
    });

    if (!auth.ok) {
      return jsonResponse({ error: auth.error }, auth.status);
    }

    let payload: {
      loanId?: string;
      idempotencyKey?: string;
      channel?: string;
      messageSummary?: string;
    };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "Invalid JSON payload." }, 400);
    }

    if (
      !payload.loanId ||
      !payload.idempotencyKey ||
      !payload.idempotencyKey.startsWith(`overdue:${payload.loanId}:`) ||
      !/^overdue:[A-Za-z0-9_-]+:\d{4}-\d{2}-\d{2}$/.test(payload.idempotencyKey)
    ) {
      return jsonResponse(
        {
          error:
            "loanId and matching deterministic idempotencyKey (overdue:{loanId}:{YYYY-MM-DD}) are required.",
        },
        400
      );
    }

    const result = await ctx.runMutation(
      internal.loans.recordReminderLoggedInternal,
      {
        loanId: payload.loanId as Id<"loans">,
        idempotencyKey: payload.idempotencyKey,
        channel: payload.channel ?? "n8n_overdue_workflow",
        summary: payload.messageSummary ?? "Reminder sent via n8n",
      }
    );

    return jsonResponse(result, result.duplicate ? 200 : 201);
  }),
});

/**
 * POST /api/automation/notification-logged
 * Authenticated via HMAC-SHA256 over `${timestamp}.${rawBody}`.
 * Idempotent write-back for request-notification workflow delivery confirmation.
 */
http.route({
  path: "/api/automation/notification-logged",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const auth = await verifyHmacRequest({
      secret: process.env.LENDLOOP_HMAC_SECRET,
      rawBody,
      signatureHeader: request.headers.get(HMAC_SIGNATURE_HEADER),
      timestampHeader: request.headers.get(HMAC_TIMESTAMP_HEADER),
    });

    if (!auth.ok) {
      return jsonResponse({ error: auth.error }, auth.status);
    }

    let payload: {
      loanId?: string;
      idempotencyKey?: string;
      channel?: string;
      messageSummary?: string;
    };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ error: "Invalid JSON payload." }, 400);
    }

    if (
      !payload.loanId ||
      !payload.idempotencyKey ||
      !payload.idempotencyKey.startsWith(`notify:${payload.loanId}:`) ||
      !/^notify:[A-Za-z0-9_-]+:(requested|approved|declined|returned|cancelled)$/.test(
        payload.idempotencyKey
      )
    ) {
      return jsonResponse(
        {
          error:
            "loanId and matching deterministic idempotencyKey (notify:{loanId}:{event}) are required.",
        },
        400
      );
    }

    const result = await ctx.runMutation(
      internal.loans.recordNotificationLoggedInternal,
      {
        loanId: payload.loanId as Id<"loans">,
        idempotencyKey: payload.idempotencyKey,
        channel: payload.channel ?? "n8n_request_workflow",
        summary: payload.messageSummary ?? "Notification delivered",
      }
    );

    return jsonResponse(result, result.duplicate ? 200 : 201);
  }),
});

export default http;

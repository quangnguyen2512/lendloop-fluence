import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/demoAuth";
import { getDemoStore } from "@/lib/demoStore";
import {
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
  verifyWebhookSignature,
} from "@/lib/hmac";
import { getAutomationHmacSecret } from "@/lib/runtimeConfig";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = getAutomationHmacSecret();

  const verification = await verifyWebhookSignature({
    secret,
    rawBody,
    signatureHeader: request.headers.get(HMAC_SIGNATURE_HEADER),
    timestampHeader: request.headers.get(HMAC_TIMESTAMP_HEADER),
  });

  if (!verification.valid) {
    const status = verification.reason === "missing_secret" ? 503 : 401;
    return NextResponse.json(
      { error: "Unauthorized automation request", reason: verification.reason },
      { status }
    );
  }

  let body: {
    loanId?: string;
    idempotencyKey?: string;
    channel?: string;
    messageSummary?: string;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  if (
    !body.loanId ||
    !body.idempotencyKey ||
    !body.idempotencyKey.startsWith(`overdue:${body.loanId}:`) ||
    !/^overdue:[A-Za-z0-9_-]+:\d{4}-\d{2}-\d{2}$/.test(body.idempotencyKey)
  ) {
    return NextResponse.json(
      {
        error:
          "loanId and matching deterministic idempotencyKey (overdue:{loanId}:{YYYY-MM-DD}) are required.",
      },
      { status: 400 }
    );
  }

  try {
    const result = getDemoStore().recordReminderLogged({
      loanId: body.loanId,
      idempotencyKey: body.idempotencyKey,
      channel: body.channel ?? "n8n_overdue_workflow",
      summary: body.messageSummary ?? "Reminder sent via n8n",
    });

    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

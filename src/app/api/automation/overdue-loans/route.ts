import { NextResponse } from "next/server";
import { getDemoStore } from "@/lib/demoStore";
import { todayIsoUtc } from "@/lib/domain";
import {
  HMAC_SIGNATURE_HEADER,
  HMAC_TIMESTAMP_HEADER,
  verifyWebhookSignature,
} from "@/lib/hmac";
import { getAutomationHmacSecret } from "@/lib/runtimeConfig";

export async function GET(request: Request) {
  const secret = getAutomationHmacSecret();
  const verification = await verifyWebhookSignature({
    secret,
    rawBody: "GET:/api/automation/overdue-loans",
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

  const todayUtc = todayIsoUtc();
  const loans = getDemoStore().getOverdueLoansForAutomation(todayUtc);

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      todayUtc,
      count: loans.length,
      loans,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

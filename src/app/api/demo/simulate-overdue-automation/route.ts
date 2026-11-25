import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/authz";
import { handleApiError, resolveDemoActorFromRequest } from "@/lib/demoAuth";
import { getDemoStore } from "@/lib/demoStore";
import { todayIsoUtc } from "@/lib/domain";
import { signWebhookPayload, verifyWebhookSignature } from "@/lib/hmac";
import { getAutomationHmacSecret } from "@/lib/runtimeConfig";

/**
 * Admin-only demo simulator that executes the EXACT HMAC-SHA256 signing,
 * verification, and deterministic idempotency loop used by `n8n/workflows/overdue-reminders.json`.
 */
export async function POST(request: Request) {
  try {
    const actor = resolveDemoActorFromRequest(request);
    requireAdmin(actor);

    const secret = getAutomationHmacSecret();
    if (!secret) {
      return NextResponse.json(
        { error: "LENDLOOP_HMAC_SECRET is not configured." },
        { status: 503 }
      );
    }

    const store = getDemoStore();
    const todayUtc = todayIsoUtc();

    // Step 1: Sign and verify the GET /api/automation/overdue-loans request
    const getCanonical = "GET:/api/automation/overdue-loans";
    const signedGet = await signWebhookPayload({
      secret,
      rawBody: getCanonical,
    });
    const getVerified = await verifyWebhookSignature({
      secret,
      rawBody: getCanonical,
      signatureHeader: signedGet.signature,
      timestampHeader: signedGet.timestamp,
    });
    if (!getVerified.valid) {
      return NextResponse.json(
        { error: "HMAC verification failed on simulated query." },
        { status: 500 }
      );
    }

    const overdueLoans = store.getOverdueLoansForAutomation(todayUtc);
    let recorded = 0;
    let duplicatesSkipped = 0;
    const processedKeys: string[] = [];

    // Step 2: Sign, verify, and execute idempotent write-back for each overdue loan
    for (const loan of overdueLoans) {
      const writebackBody = JSON.stringify({
        loanId: loan.loanId,
        idempotencyKey: loan.idempotencyKey,
        channel: "n8n_overdue_workflow",
        messageSummary: `Reminder sent (${loan.daysOverdue}d overdue)`,
      });
      const signedPost = await signWebhookPayload({
        secret,
        rawBody: writebackBody,
      });
      const postVerified = await verifyWebhookSignature({
        secret,
        rawBody: writebackBody,
        signatureHeader: signedPost.signature,
        timestampHeader: signedPost.timestamp,
      });
      if (!postVerified.valid) {
        return NextResponse.json(
          { error: "HMAC verification failed on simulated write-back." },
          { status: 500 }
        );
      }

      const result = store.recordReminderLogged({
        loanId: loan.loanId,
        idempotencyKey: loan.idempotencyKey,
        channel: "n8n_overdue_workflow",
        summary: `Reminder sent (${loan.daysOverdue}d overdue)`,
      });

      processedKeys.push(loan.idempotencyKey);
      if (result.duplicate) {
        duplicatesSkipped += 1;
      } else {
        recorded += 1;
      }
    }

    return NextResponse.json({
      ok: true,
      todayUtc,
      overdueFound: overdueLoans.length,
      recorded,
      duplicatesSkipped,
      idempotencyKeys: processedKeys,
      hmacVerified: true,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

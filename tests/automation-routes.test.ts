import { beforeEach, describe, expect, it } from "vitest";
import { GET as getOverdueLoans } from "@/app/api/automation/overdue-loans/route";
import { POST as postNotificationLogged } from "@/app/api/automation/notification-logged/route";
import { POST as postReminderLogged } from "@/app/api/automation/reminder-logged/route";
import { GET as getPublicTools } from "@/app/api/demo/public-tools/route";
import { getDemoStore } from "@/lib/demoStore";
import { signWebhookPayload } from "@/lib/hmac";
import { getAutomationHmacSecret } from "@/lib/runtimeConfig";

describe("HTTP Route Handlers — Public Minimization & HMAC Automation Security", () => {
  beforeEach(() => {
    getDemoStore().seed();
  });

  it("GET /api/demo/public-tools returns strictly { id, name, category } for available tools only", async () => {
    const res = await getPublicTools();
    expect(res.status).toBe(200);
    const data = (await res.json()) as { tools: Record<string, unknown>[] };
    expect(data.tools.length).toBeGreaterThan(0);

    for (const tool of data.tools) {
      expect(Object.keys(tool).sort()).toEqual(["category", "id", "name"]);
    }
    expect(JSON.stringify(data)).not.toContain("Maya");
    expect(JSON.stringify(data)).not.toContain("example.test");
  });

  it("GET /api/automation/overdue-loans rejects unsigned requests and accepts valid HMAC signatures", async () => {
    const unsignedRes = await getOverdueLoans(
      new Request("http://localhost:3000/api/automation/overdue-loans")
    );
    expect(unsignedRes.status).toBe(401);

    const secret = getAutomationHmacSecret()!;
    const signed = await signWebhookPayload({
      secret,
      rawBody: "GET:/api/automation/overdue-loans",
    });

    const authedRes = await getOverdueLoans(
      new Request("http://localhost:3000/api/automation/overdue-loans", {
        headers: signed.headers,
      })
    );
    expect(authedRes.status).toBe(200);
    const body = (await authedRes.json()) as {
      count: number;
      todayUtc: string;
      loans: Array<{ loanId: string; idempotencyKey: string }>;
    };
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.loans[0].idempotencyKey).toBe(
      `overdue:${body.loans[0].loanId}:${body.todayUtc}`
    );
  });

  it("POST /api/automation/reminder-logged enforces HMAC, rejects cross-loan key spoofing, and deduplicates retries", async () => {
    const secret = getAutomationHmacSecret()!;
    const today = new Date().toISOString().slice(0, 10);

    // 1. Cross-loan key spoofing must be rejected with 400
    const spoofedBody = JSON.stringify({
      loanId: "loan_overdue_1",
      idempotencyKey: `overdue:loan_other_999:${today}`,
      channel: "n8n_overdue_workflow",
      messageSummary: "Spoofed key",
    });
    const signedSpoof = await signWebhookPayload({ secret, rawBody: spoofedBody });
    const spoofRes = await postReminderLogged(
      new Request("http://localhost:3000/api/automation/reminder-logged", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...signedSpoof.headers,
        },
        body: spoofedBody,
      })
    );
    expect(spoofRes.status).toBe(400);

    // 2. Valid signed request records with 201, identical retry returns 200 duplicate=true
    const validBody = JSON.stringify({
      loanId: "loan_overdue_1",
      idempotencyKey: `overdue:loan_overdue_1:${today}`,
      channel: "n8n_overdue_workflow",
      messageSummary: "Reminder sent (3d overdue)",
    });
    const signedValid = await signWebhookPayload({ secret, rawBody: validBody });

    const firstRes = await postReminderLogged(
      new Request("http://localhost:3000/api/automation/reminder-logged", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...signedValid.headers,
        },
        body: validBody,
      })
    );
    expect(firstRes.status).toBe(201);
    expect(await firstRes.json()).toMatchObject({
      status: "recorded",
      duplicate: false,
    });

    const retryRes = await postReminderLogged(
      new Request("http://localhost:3000/api/automation/reminder-logged", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...signedValid.headers,
        },
        body: validBody,
      })
    );
    expect(retryRes.status).toBe(200);
    expect(await retryRes.json()).toMatchObject({
      status: "already_recorded",
      duplicate: true,
    });
  });

  it("POST /api/automation/notification-logged validates status-change keys and deduplicates retries", async () => {
    const secret = getAutomationHmacSecret()!;

    // Invalid event suffix rejected with 400
    const badBody = JSON.stringify({
      loanId: "loan_pending_2",
      idempotencyKey: "notify:loan_pending_2:unknown_event",
    });
    const signedBad = await signWebhookPayload({ secret, rawBody: badBody });
    const badRes = await postNotificationLogged(
      new Request("http://localhost:3000/api/automation/notification-logged", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...signedBad.headers },
        body: badBody,
      })
    );
    expect(badRes.status).toBe(400);

    // Valid status-change notification records once and deduplicates on retry
    const okBody = JSON.stringify({
      loanId: "loan_pending_2",
      idempotencyKey: "notify:loan_pending_2:approved",
      channel: "n8n_request_workflow",
      messageSummary: "Approval notification delivered to Maya Chen",
    });
    const signedOk = await signWebhookPayload({ secret, rawBody: okBody });

    const r1 = await postNotificationLogged(
      new Request("http://localhost:3000/api/automation/notification-logged", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...signedOk.headers },
        body: okBody,
      })
    );
    expect(r1.status).toBe(201);

    const r2 = await postNotificationLogged(
      new Request("http://localhost:3000/api/automation/notification-logged", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...signedOk.headers },
        body: okBody,
      })
    );
    expect(r2.status).toBe(200);
    expect(await r2.json()).toMatchObject({
      status: "already_recorded",
      duplicate: true,
    });
  });
});

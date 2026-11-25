import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface N8nNode {
  id: string;
  name: string;
  type: string;
  retryOnFail?: boolean;
  parameters?: Record<string, unknown>;
}

interface N8nWorkflow {
  id: string;
  name: string;
  nodes: N8nNode[];
  connections: Record<string, unknown>;
  settings?: {
    errorWorkflow?: string;
    saveDataSuccessExecution?: string;
  };
}

const WORKFLOWS_DIR = path.resolve(process.cwd(), "n8n", "workflows");

function loadWorkflow(filename: string): { raw: string; parsed: N8nWorkflow } {
  const fullPath = path.join(WORKFLOWS_DIR, filename);
  const raw = fs.readFileSync(fullPath, "utf8");
  return { raw, parsed: JSON.parse(raw) as N8nWorkflow };
}

describe("n8n Exported Workflows — Security, Idempotency & Error-Handling Audit", () => {
  const files = [
    "request-notification.json",
    "overdue-reminders.json",
    "error-handler.json",
  ];

  it("contains zero hardcoded secrets, emails, or real API keys across all workflows", () => {
    for (const file of files) {
      const { raw } = loadWorkflow(file);
      expect(raw).not.toMatch(/sk_(live|test)_[A-Za-z0-9]+/);
      expect(raw).not.toMatch(/pk_(live|test)_[A-Za-z0-9]+/);
      expect(raw).not.toMatch(/xox[baprs]-[A-Za-z0-9-]+/);
      expect(raw).not.toMatch(/[A-Z0-9._%+-]+@(gmail|yahoo|outlook|fluencetraining)\.[A-Z]{2,}/i);
      // No hardcoded 64-char hex HMAC secrets
      expect(raw).not.toMatch(/["'][0-9a-f]{64}["']/i);
    }
  });

  it("validates request-notification.json HMAC verification, status-change coverage, data minimization, retries, and error workflow", () => {
    const { raw, parsed } = loadWorkflow("request-notification.json");

    expect(parsed.settings?.errorWorkflow).toBe("lendloop-error-handler");
    expect(parsed.settings?.saveDataSuccessExecution).toBe("none");

    // Must verify HMAC using $env.LENDLOOP_HMAC_SECRET + timingSafeEqual + 300s replay window
    expect(raw).toContain("$env.LENDLOOP_HMAC_SECRET");
    expect(raw).toContain("timingSafeEqual");
    expect(raw).toContain("300");
    expect(raw).toContain("lendloop-loan-events");

    // Must handle borrow request creation AND all status changes, notifying the relevant recipient
    for (const eventName of [
      "loan.requested",
      "loan.approved",
      "loan.declined",
      "loan.returned",
      "loan.cancelled",
    ]) {
      expect(raw).toContain(eventName);
    }
    expect(raw).toContain("recipientRole");
    expect(raw).toContain("recipientFirstName");
    expect(raw).toContain("/api/automation/notification-logged");

    // Must explicitly whitelist minimal fields (`includeOtherFields: false`)
    const setNode = parsed.nodes.find((n) => n.type === "n8n-nodes-base.set");
    expect(setNode).toBeDefined();
    expect(setNode?.parameters?.includeOtherFields).toBe(false);

    // Every HTTP Request node must have retryOnFail enabled
    const httpNodes = parsed.nodes.filter(
      (n) => n.type === "n8n-nodes-base.httpRequest"
    );
    expect(httpNodes.length).toBeGreaterThanOrEqual(2);
    for (const node of httpNodes) {
      expect(node.retryOnFail).toBe(true);
    }
  });

  it("validates overdue-reminders.json cron schedule, HMAC signing, deterministic idempotency, retries, and error workflow", () => {
    const { raw, parsed } = loadWorkflow("overdue-reminders.json");

    expect(parsed.settings?.errorWorkflow).toBe("lendloop-error-handler");
    expect(parsed.settings?.saveDataSuccessExecution).toBe("none");

    const cronNode = parsed.nodes.find(
      (n) => n.type === "n8n-nodes-base.scheduleTrigger"
    );
    expect(cronNode).toBeDefined();

    // Bidirectional Convex endpoints + env secret
    expect(raw).toContain("$env.LENDLOOP_HMAC_SECRET");
    expect(raw).toContain("$env.CONVEX_SITE_URL");
    expect(raw).toContain("/api/automation/overdue-loans");
    expect(raw).toContain("/api/automation/reminder-logged");

    // Deterministic daily idempotency key format
    expect(raw).toContain("overdue:${loan.loanId}:${todayUtc}");

    // Retry enabled on all HTTP nodes
    const httpNodes = parsed.nodes.filter(
      (n) => n.type === "n8n-nodes-base.httpRequest"
    );
    expect(httpNodes.length).toBe(3);
    for (const node of httpNodes) {
      expect(node.retryOnFail).toBe(true);
    }
  });

  it("validates error-handler.json captures failures via errorTrigger and sanitizes PII/secrets", () => {
    const { raw, parsed } = loadWorkflow("error-handler.json");

    expect(parsed.id).toBe("lendloop-error-handler");
    const errTrigger = parsed.nodes.find(
      (n) => n.type === "n8n-nodes-base.errorTrigger"
    );
    expect(errTrigger).toBeDefined();

    // Redacts emails, bearer tokens, signatures before dispatching to ALERT_WEBHOOK_URL
    expect(raw).toContain("[redacted-email]");
    expect(raw).toContain("[redacted-sig]");
    expect(raw).toContain("$env.ALERT_WEBHOOK_URL");
  });
});

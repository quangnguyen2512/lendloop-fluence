import { describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import { LendLoopStore } from "@/lib/demoStore";

function expectForbidden(fn: () => unknown) {
  try {
    fn();
    throw new Error("Expected FORBIDDEN error but operation succeeded.");
  } catch (err) {
    expect(err).toBeInstanceOf(AuthorizationError);
    expect((err as AuthorizationError).code).toBe("FORBIDDEN");
  }
}

describe("LendLoopStore — End-to-End Domain, RBAC, Overlap & Idempotency", () => {
  it("enforces data minimization on public available tools (name & category only, excludes loaned items)", () => {
    const store = new LendLoopStore(true);
    const publicTools = store.listPublicAvailableTools();

    // Seeded pressure washer is currently on an approved loan -> must NOT appear in available list
    expect(publicTools.find((t) => t.id === "tool_pressure_washer")).toBeUndefined();
    expect(publicTools.length).toBeGreaterThan(0);

    for (const tool of publicTools) {
      expect(Object.keys(tool).sort()).toEqual(["category", "id", "name"]);
      expect(JSON.stringify(tool)).not.toContain("example.test");
      expect(JSON.stringify(tool)).not.toContain("user_");
    }
  });

  it("enforces full RBAC boundaries across users and admins", () => {
    const store = new LendLoopStore(true);
    const maya = store.getActorById("user_maya")!;
    const marcus = store.getActorById("user_marcus")!;
    const admin = store.getActorById("user_elena")!;

    // Marcus cannot edit or delete Maya's drill
    expectForbidden(() =>
      store.updateTool(marcus, "tool_drill", {
        name: "Hijacked Drill",
        category: "power_tools",
        condition: "fair",
        shortDescription: "Attempting unauthorized edit.",
      })
    );
    expectForbidden(() => store.deleteTool(marcus, "tool_drill"));

    // Maya cannot borrow her own drill
    expectForbidden(() =>
      store.requestBorrow(maya, {
        toolId: "tool_drill",
        startDate: "2026-12-01",
        endDate: "2026-12-03",
      })
    );

    // Marcus cannot view admin loans or grant Trusted Lender
    expectForbidden(() => store.listAllLoansAdmin(marcus));
    expectForbidden(() => store.toggleTrustedLender(marcus, "user_marcus", true));

    // Admin CAN toggle Trusted Lender and view all loans
    const promoted = store.toggleTrustedLender(admin, "user_marcus", true);
    expect(promoted.isTrustedLender).toBe(true);
    expect(store.listAllLoansAdmin(admin).length).toBeGreaterThanOrEqual(3);

    // Admin CAN delete a non-loaned listing owned by another user
    const createdByMarcus = store.createTool(marcus, {
      name: "Socket Wrench Set",
      category: "automotive",
      condition: "good",
      shortDescription: "Metric and SAE sockets in blow-molded case.",
    });
    expect(store.deleteTool(admin, createdByMarcus.id)).toEqual({ deleted: true });
  });

  it("prevents overlapping approved loans at both request and approval time", () => {
    const store = new LendLoopStore(true);
    const maya = store.getActorById("user_maya")!;
    const marcus = store.getActorById("user_marcus")!;
    const admin = store.getActorById("user_elena")!;

    // Two different borrowers submit overlapping pending requests for Maya's drill
    const req1 = store.requestBorrow(marcus, {
      toolId: "tool_drill",
      startDate: "2026-12-10",
      endDate: "2026-12-14",
    });
    const req2 = store.requestBorrow(admin, {
      toolId: "tool_drill",
      startDate: "2026-12-12",
      endDate: "2026-12-16",
    });

    // Unauthorized user (Marcus) cannot approve Maya's incoming loan
    expectForbidden(() => store.approveLoan(marcus, req1.id));

    // Maya approves req1
    const approved = store.approveLoan(maya, req1.id);
    expect(approved.status).toBe("approved");

    // Approving overlapping req2 MUST throw CONFLICT
    expect(() => store.approveLoan(maya, req2.id)).toThrow(/CONFLICT/);

    // New request overlapping approved dates MUST also throw CONFLICT
    expect(() =>
      store.requestBorrow(admin, {
        toolId: "tool_drill",
        startDate: "2026-12-14",
        endDate: "2026-12-15",
      })
    ).toThrow(/CONFLICT/);

    // Marking returned frees up the tool
    const returned = store.markReturned(maya, req1.id);
    expect(returned.status).toBe("returned");
  });

  it("guarantees idempotent overdue reminder write-back (retries create zero duplicates)", () => {
    const store = new LendLoopStore(true);
    const admin = store.getActorById("user_elena")!;
    const today = "2026-11-25";

    const overdue = store.getOverdueLoansForAutomation(today);
    expect(overdue.length).toBeGreaterThanOrEqual(1);
    const target = overdue[0];
    expect(target.idempotencyKey).toBe(`overdue:${target.loanId}:${today}`);

    const beforeCount = target.reminderCount;

    const first = store.recordReminderLogged({
      loanId: target.loanId,
      idempotencyKey: target.idempotencyKey,
      channel: "n8n_overdue_workflow",
      summary: `Reminder sent (${target.daysOverdue}d overdue)`,
    });
    expect(first.duplicate).toBe(false);
    expect(first.status).toBe("recorded");

    // Simulate n8n retry or accidental double-run on the same UTC day
    const retry = store.recordReminderLogged({
      loanId: target.loanId,
      idempotencyKey: target.idempotencyKey,
      channel: "n8n_overdue_workflow",
      summary: `Reminder sent (${target.daysOverdue}d overdue)`,
    });
    expect(retry.duplicate).toBe(true);
    expect(retry.status).toBe("already_recorded");
    expect(retry.logId).toBe(first.logId);

    const allLoans = store.listAllLoansAdmin(admin, today);
    const updatedLoan = allLoans.find((l) => l.id === target.loanId)!;
    expect(updatedLoan.reminderCount).toBe(beforeCount + 1);

    const matchingLogs = updatedLoan.automationActivity.filter(
      (a) => a.idempotencyKey === target.idempotencyKey
    );
    expect(matchingLogs.length).toBe(1);
  });

  it("records idempotent notifications on borrow creation AND every status transition", () => {
    const store = new LendLoopStore(true);
    const maya = store.getActorById("user_maya")!;
    const marcus = store.getActorById("user_marcus")!;
    const admin = store.getActorById("user_elena")!;

    // Flow 1: requested -> approved -> returned
    const loan1 = store.requestBorrow(marcus, {
      toolId: "tool_drill",
      startDate: "2026-12-20",
      endDate: "2026-12-22",
    });
    store.approveLoan(maya, loan1.id);
    store.markReturned(maya, loan1.id);

    const view1 = store
      .listAllLoansAdmin(admin)
      .find((l) => l.id === loan1.id)!;
    const keys1 = view1.automationActivity.map((a) => a.idempotencyKey);
    expect(keys1).toContain(`notify:${loan1.id}:requested`);
    expect(keys1).toContain(`notify:${loan1.id}:approved`);
    expect(keys1).toContain(`notify:${loan1.id}:returned`);
    expect(
      view1.automationActivity.some((a) =>
        a.summary.includes("Approval notification delivered to Marcus Vance")
      )
    ).toBe(true);
    expect(
      view1.automationActivity.some((a) =>
        a.summary.includes("Return confirmation delivered to Marcus Vance")
      )
    ).toBe(true);

    // Flow 2: requested -> cancelled (notifies lender)
    const loan2 = store.requestBorrow(marcus, {
      toolId: "tool_drill",
      startDate: "2026-12-25",
      endDate: "2026-12-26",
    });
    store.cancelRequest(marcus, loan2.id);
    const view2 = store
      .listAllLoansAdmin(admin)
      .find((l) => l.id === loan2.id)!;
    expect(view2.automationActivity.map((a) => a.idempotencyKey)).toContain(
      `notify:${loan2.id}:cancelled`
    );

    // Flow 3: deleting a tool with a pending request auto-declines it and notifies borrower
    const tempTool = store.createTool(marcus, {
      name: "Camping Lantern",
      category: "camping",
      condition: "good",
      shortDescription: "USB-C rechargeable LED lantern with warm mode.",
    });
    const pendingOnTemp = store.requestBorrow(maya, {
      toolId: tempTool.id,
      startDate: "2026-12-28",
      endDate: "2026-12-29",
    });
    store.deleteTool(admin, tempTool.id);
    const declinedView = store
      .listAllLoansAdmin(admin)
      .find((l) => l.id === pendingOnTemp.id)!;
    expect(declinedView.status).toBe("declined");
    expect(
      declinedView.automationActivity.map((a) => a.idempotencyKey)
    ).toContain(`notify:${pendingOnTemp.id}:declined`);
  });
});

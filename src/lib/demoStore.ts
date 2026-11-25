import {
  assertCanCancelLoan,
  assertCanDeleteTool,
  assertCanEditTool,
  assertCanManageIncomingLoan,
  assertCanRequestBorrow,
  assertCanToggleTrustedLender,
  assertCanViewAllLoans,
  AuthorizationError,
  requireAdmin,
  requireAuthenticated,
} from "./authz";
import {
  buildNotificationIdempotencyKey,
  buildOverdueIdempotencyKey,
  computeOverdueDays,
  findOverlappingApprovedLoan,
  isToolCurrentlyAvailable,
  projectPublicTool,
  todayIsoUtc,
  validateDateRange,
  validateToolInput,
} from "./domain";
import type {
  Actor,
  AdminUserSummary,
  AuthenticatedToolView,
  AutomationActivity,
  LoanRecord,
  LoanView,
  OverdueLoanAutomationItem,
  PublicToolProjection,
  ToolCategory,
  ToolInput,
  ToolRecord,
  UserRecord,
} from "./types";

const DAY_MS = 86_400_000;

function isoDaysFromNow(offsetDays: number, now: Date = new Date()): string {
  return new Date(now.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

export class LendLoopStore {
  private users = new Map<string, UserRecord>();
  private tools = new Map<string, ToolRecord>();
  private loans = new Map<string, LoanRecord>();
  private automationLogs = new Map<string, AutomationActivity>();
  private idempotencyIndex = new Map<string, string>(); // key -> logId
  private seq = 100;

  constructor(seedData = true) {
    if (seedData) {
      this.seed();
    }
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  public seed(now: Date = new Date()): void {
    this.users.clear();
    this.tools.clear();
    this.loans.clear();
    this.automationLogs.clear();
    this.idempotencyIndex.clear();

    const nowMs = now.getTime();

    const seededUsers: UserRecord[] = [
      {
        id: "user_maya",
        clerkId: "clerk_demo_maya",
        displayName: "Maya Chen",
        role: "user",
        isTrustedLender: true,
        internalEmail: "maya.private@example.test",
        createdAt: nowMs - 45 * DAY_MS,
      },
      {
        id: "user_marcus",
        clerkId: "clerk_demo_marcus",
        displayName: "Marcus Vance",
        role: "user",
        isTrustedLender: false,
        internalEmail: "marcus.private@example.test",
        createdAt: nowMs - 30 * DAY_MS,
      },
      {
        id: "user_elena",
        clerkId: "clerk_demo_elena",
        displayName: "Dr. Elena Rostova",
        role: "admin",
        isTrustedLender: true,
        internalEmail: "elena.admin@example.test",
        createdAt: nowMs - 90 * DAY_MS,
      },
    ];

    for (const u of seededUsers) {
      this.users.set(u.id, u);
    }

    const seededTools: ToolRecord[] = [
      {
        id: "tool_drill",
        name: "DeWalt 20V Brushless Hammer Drill",
        category: "power_tools",
        condition: "like_new",
        shortDescription:
          "Includes two 5Ah batteries, rapid charger, and masonry bit kit. Ideal for shelving or deck work.",
        ownerId: "user_maya",
        createdAt: nowMs - 20 * DAY_MS,
        updatedAt: nowMs - 20 * DAY_MS,
      },
      {
        id: "tool_pressure_washer",
        name: "Sun Joe 2030 PSI Electric Pressure Washer",
        category: "garden",
        condition: "good",
        shortDescription:
          "Comes with 20ft high-pressure hose and five quick-connect spray nozzles for patios and siding.",
        ownerId: "user_maya",
        createdAt: nowMs - 18 * DAY_MS,
        updatedAt: nowMs - 18 * DAY_MS,
      },
      {
        id: "tool_stand_mixer",
        name: "KitchenAid Artisan 5-Qt Stand Mixer",
        category: "kitchen",
        condition: "like_new",
        shortDescription:
          "Includes dough hook, flat beater, wire whip, and stainless pouring shield. Clean and calibrated.",
        ownerId: "user_elena",
        createdAt: nowMs - 14 * DAY_MS,
        updatedAt: nowMs - 14 * DAY_MS,
      },
      {
        id: "tool_tent",
        name: "REI Half Dome 2-Person Backpacking Tent",
        category: "camping",
        condition: "good",
        shortDescription:
          "Lightweight aluminum poles, full rainfly, footprint included. Packed dry after every trip.",
        ownerId: "user_marcus",
        createdAt: nowMs - 12 * DAY_MS,
        updatedAt: nowMs - 12 * DAY_MS,
      },
      {
        id: "tool_obd_scanner",
        name: "BlueDriver Bluetooth OBD2 Diagnostic Scanner",
        category: "automotive",
        condition: "like_new",
        shortDescription:
          "Reads and clears check-engine, ABS, and SRS codes via iOS/Android app.",
        ownerId: "user_marcus",
        createdAt: nowMs - 10 * DAY_MS,
        updatedAt: nowMs - 10 * DAY_MS,
      },
      {
        id: "tool_carpet_cleaner",
        name: "Bissell Little Green Spot & Upholstery Cleaner",
        category: "other",
        condition: "fair",
        shortDescription:
          "Compact portable extractor for rugs, stairs, and car seats. Please rinse tank before return.",
        ownerId: "user_elena",
        createdAt: nowMs - 8 * DAY_MS,
        updatedAt: nowMs - 8 * DAY_MS,
      },
    ];

    for (const t of seededTools) {
      this.tools.set(t.id, t);
    }

    // Seed 1 overdue active loan + 1 pending request + 1 returned historical loan
    const seededLoans: LoanRecord[] = [
      {
        id: "loan_overdue_1",
        toolId: "tool_pressure_washer",
        ownerId: "user_maya",
        borrowerId: "user_marcus",
        startDate: isoDaysFromNow(-8, now),
        endDate: isoDaysFromNow(-3, now),
        status: "approved",
        note: "Cleaning back patio stones over the weekend.",
        createdAt: nowMs - 9 * DAY_MS,
        updatedAt: nowMs - 2 * DAY_MS,
        lastReminderAt: nowMs - 2 * DAY_MS,
        reminderCount: 1,
      },
      {
        id: "loan_pending_2",
        toolId: "tool_tent",
        ownerId: "user_marcus",
        borrowerId: "user_maya",
        startDate: isoDaysFromNow(4, now),
        endDate: isoDaysFromNow(7, now),
        status: "pending",
        note: "Quick coastal trail trip next weekend!",
        createdAt: nowMs - 5 * 3_600_000,
        updatedAt: nowMs - 5 * 3_600_000,
        reminderCount: 0,
      },
      {
        id: "loan_returned_3",
        toolId: "tool_drill",
        ownerId: "user_maya",
        borrowerId: "user_elena",
        startDate: isoDaysFromNow(-16, now),
        endDate: isoDaysFromNow(-14, now),
        status: "returned",
        note: "Mounting bookshelves in study.",
        createdAt: nowMs - 17 * DAY_MS,
        updatedAt: nowMs - 14 * DAY_MS,
        reminderCount: 0,
      },
    ];

    for (const l of seededLoans) {
      this.loans.set(l.id, l);
    }

    const seededLogs: AutomationActivity[] = [
      {
        id: "log_1",
        loanId: "loan_overdue_1",
        eventType: "request_notification_sent",
        summary: "Notification delivered to Maya Chen",
        idempotencyKey: "notify:loan_overdue_1:requested",
        channel: "n8n_request_workflow",
        createdAt: nowMs - 9 * DAY_MS + 12_000,
      },
      {
        id: "log_2",
        loanId: "loan_overdue_1",
        eventType: "overdue_reminder_sent",
        summary: "Reminder sent (1d overdue)",
        idempotencyKey: `overdue:loan_overdue_1:${isoDaysFromNow(-2, now)}`,
        channel: "n8n_overdue_workflow",
        createdAt: nowMs - 2 * DAY_MS,
      },
      {
        id: "log_3",
        loanId: "loan_pending_2",
        eventType: "request_notification_sent",
        summary: "Notification delivered to Marcus Vance",
        idempotencyKey: "notify:loan_pending_2:requested",
        channel: "n8n_request_workflow",
        createdAt: nowMs - 5 * 3_600_000 + 8_000,
      },
    ];

    for (const log of seededLogs) {
      this.automationLogs.set(log.id, log);
      this.idempotencyIndex.set(log.idempotencyKey, log.id);
    }
  }

  public getActorById(userId: string | null | undefined): Actor | null {
    if (!userId) return null;
    const u = this.users.get(userId);
    if (!u) return null;
    return {
      id: u.id,
      clerkId: u.clerkId,
      displayName: u.displayName,
      role: u.role,
      isTrustedLender: u.isTrustedLender,
    };
  }

  public listDemoPersonas(): Actor[] {
    return [...this.users.values()].map((u) => ({
      id: u.id,
      clerkId: u.clerkId,
      displayName: u.displayName,
      role: u.role,
      isTrustedLender: u.isTrustedLender,
    }));
  }

  /**
   * PUBLIC QUERY — DATA MINIMIZATION ENFORCED AT DATA LAYER.
   * Only available tools, strictly `{ id, name, category }`.
   */
  public listPublicAvailableTools(): PublicToolProjection[] {
    const allLoans = [...this.loans.values()];
    return [...this.tools.values()]
      .filter((tool) => isToolCurrentlyAvailable(allLoans, tool.id).available)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((tool) => projectPublicTool(tool));
  }

  public listAuthenticatedTools(
    actor: Actor | null,
    category?: ToolCategory
  ): AuthenticatedToolView[] {
    requireAuthenticated(actor);
    const allLoans = [...this.loans.values()];

    return [...this.tools.values()]
      .filter((t) => (!category ? true : t.category === category))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((tool) => {
        const owner = this.users.get(tool.ownerId);
        const availability = isToolCurrentlyAvailable(allLoans, tool.id);
        return {
          ...tool,
          ownerDisplayName: owner?.displayName ?? "Neighbor",
          ownerIsTrustedLender: owner?.isTrustedLender ?? false,
          availabilityStatus: availability.available ? "available" : "on_loan",
          activeLoanEndDate: availability.activeLoanEndDate,
        };
      });
  }

  public listMyListings(actor: Actor | null): AuthenticatedToolView[] {
    const authed = requireAuthenticated(actor);
    return this.listAuthenticatedTools(authed).filter(
      (tool) => tool.ownerId === authed.id
    );
  }

  public createTool(actor: Actor | null, input: ToolInput): ToolRecord {
    const authed = requireAuthenticated(actor);
    const clean = validateToolInput(input);
    const now = Date.now();
    const record: ToolRecord = {
      id: this.nextId("tool"),
      ...clean,
      ownerId: authed.id,
      createdAt: now,
      updatedAt: now,
    };
    this.tools.set(record.id, record);
    return record;
  }

  public updateTool(
    actor: Actor | null,
    toolId: string,
    input: ToolInput
  ): ToolRecord {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new AuthorizationError("NOT_FOUND", "Tool listing not found.");
    }
    assertCanEditTool(actor, tool);
    const clean = validateToolInput(input);
    const updated: ToolRecord = {
      ...tool,
      ...clean,
      updatedAt: Date.now(),
    };
    this.tools.set(toolId, updated);
    return updated;
  }

  public deleteTool(actor: Actor | null, toolId: string): { deleted: true } {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new AuthorizationError("NOT_FOUND", "Tool listing not found.");
    }
    assertCanDeleteTool(actor, tool);

    const activeLoan = [...this.loans.values()].find(
      (l) => l.toolId === toolId && l.status === "approved"
    );
    if (activeLoan) {
      throw new AuthorizationError(
        "CONFLICT",
        "Cannot delete a tool while an approved loan is active. Mark it returned first."
      );
    }

    // Auto-decline open pending borrow requests on removed tool and notify borrowers
    const now = Date.now();
    for (const loan of this.loans.values()) {
      if (loan.toolId === toolId && loan.status === "pending") {
        loan.status = "declined";
        loan.updatedAt = now;
        this.recordLoanEventNotification(loan, "declined");
      }
    }

    this.tools.delete(toolId);
    return { deleted: true };
  }

  private recordLoanEventNotification(
    loan: LoanRecord,
    event: "requested" | "approved" | "declined" | "returned" | "cancelled"
  ): void {
    const lender = this.users.get(loan.ownerId);
    const borrower = this.users.get(loan.borrowerId);
    const lenderName = lender?.displayName ?? "lender";
    const borrowerName = borrower?.displayName ?? "borrower";

    const summaryByEvent: Record<typeof event, string> = {
      requested: `Request notification delivered to ${lenderName}`,
      approved: `Approval notification delivered to ${borrowerName}`,
      declined: `Decline notification delivered to ${borrowerName}`,
      returned: `Return confirmation delivered to ${borrowerName}`,
      cancelled: `Cancellation notice delivered to ${lenderName}`,
    };

    this.recordNotificationLogged({
      loanId: loan.id,
      idempotencyKey: buildNotificationIdempotencyKey(loan.id, event),
      channel: "n8n_request_workflow",
      summary: summaryByEvent[event],
    });
  }

  private enrichLoan(loan: LoanRecord, todayIso: string): LoanView {
    const tool = this.tools.get(loan.toolId);
    const owner = this.users.get(loan.ownerId);
    const borrower = this.users.get(loan.borrowerId);
    const activity = [...this.automationLogs.values()]
      .filter((log) => log.loanId === loan.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);
    const daysOverdue =
      loan.status === "approved" ? computeOverdueDays(loan.endDate, todayIso) : 0;

    return {
      ...loan,
      toolName: tool?.name ?? "Removed Tool",
      toolCategory: tool?.category ?? "other",
      ownerDisplayName: owner?.displayName ?? "Neighbor",
      ownerIsTrustedLender: owner?.isTrustedLender ?? false,
      borrowerDisplayName: borrower?.displayName ?? "Neighbor",
      isOverdue: daysOverdue > 0,
      daysOverdue,
      automationActivity: activity,
    };
  }

  public listMyRequests(
    actor: Actor | null,
    todayIso: string = todayIsoUtc()
  ): LoanView[] {
    const authed = requireAuthenticated(actor);
    return [...this.loans.values()]
      .filter((loan) => loan.borrowerId === authed.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((loan) => this.enrichLoan(loan, todayIso));
  }

  public listIncomingRequests(
    actor: Actor | null,
    todayIso: string = todayIsoUtc()
  ): LoanView[] {
    const authed = requireAuthenticated(actor);
    return [...this.loans.values()]
      .filter((loan) => loan.ownerId === authed.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((loan) => this.enrichLoan(loan, todayIso));
  }

  public listAllLoansAdmin(
    actor: Actor | null,
    todayIso: string = todayIsoUtc()
  ): LoanView[] {
    assertCanViewAllLoans(actor);
    return [...this.loans.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((loan) => this.enrichLoan(loan, todayIso));
  }

  public listUsersForAdmin(actor: Actor | null): AdminUserSummary[] {
    requireAdmin(actor);
    const toolCountByOwner = new Map<string, number>();
    for (const tool of this.tools.values()) {
      toolCountByOwner.set(
        tool.ownerId,
        (toolCountByOwner.get(tool.ownerId) ?? 0) + 1
      );
    }
    return [...this.users.values()].map((u) => ({
      id: u.id,
      displayName: u.displayName,
      role: u.role,
      isTrustedLender: u.isTrustedLender,
      toolCount: toolCountByOwner.get(u.id) ?? 0,
      createdAt: u.createdAt,
    }));
  }

  public toggleTrustedLender(
    actor: Actor | null,
    targetUserId: string,
    isTrustedLender: boolean
  ): AdminUserSummary {
    assertCanToggleTrustedLender(actor);
    const target = this.users.get(targetUserId);
    if (!target) {
      throw new AuthorizationError("NOT_FOUND", "Target user not found.");
    }
    target.isTrustedLender = isTrustedLender;
    const toolCount = [...this.tools.values()].filter(
      (t) => t.ownerId === target.id
    ).length;
    return {
      id: target.id,
      displayName: target.displayName,
      role: target.role,
      isTrustedLender: target.isTrustedLender,
      toolCount,
      createdAt: target.createdAt,
    };
  }

  public requestBorrow(
    actor: Actor | null,
    params: {
      toolId: string;
      startDate: string;
      endDate: string;
      note?: string;
    }
  ): LoanRecord {
    const tool = this.tools.get(params.toolId);
    if (!tool) {
      throw new AuthorizationError("NOT_FOUND", "Tool listing not found.");
    }
    const borrower = assertCanRequestBorrow(actor, tool);
    validateDateRange(params.startDate, params.endDate);

    const overlap = findOverlappingApprovedLoan(
      [...this.loans.values()],
      tool.id,
      params.startDate,
      params.endDate
    );
    if (overlap) {
      throw new AuthorizationError(
        "CONFLICT",
        `Tool is already booked from ${overlap.startDate} to ${overlap.endDate}.`
      );
    }

    const now = Date.now();
    const loan: LoanRecord = {
      id: this.nextId("loan"),
      toolId: tool.id,
      ownerId: tool.ownerId,
      borrowerId: borrower.id,
      startDate: params.startDate,
      endDate: params.endDate,
      status: "pending",
      note: params.note?.trim().slice(0, 280),
      createdAt: now,
      updatedAt: now,
      reminderCount: 0,
    };
    this.loans.set(loan.id, loan);
    this.recordLoanEventNotification(loan, "requested");

    return loan;
  }

  public approveLoan(actor: Actor | null, loanId: string): LoanRecord {
    const loan = this.loans.get(loanId);
    if (!loan) {
      throw new AuthorizationError("NOT_FOUND", "Borrow request not found.");
    }
    assertCanManageIncomingLoan(actor, loan);
    if (loan.status !== "pending") {
      throw new AuthorizationError(
        "CONFLICT",
        "Only pending requests can be approved."
      );
    }
    if (!this.tools.has(loan.toolId)) {
      throw new AuthorizationError(
        "NOT_FOUND",
        "Tool listing no longer exists and cannot be approved."
      );
    }

    const overlap = findOverlappingApprovedLoan(
      [...this.loans.values()],
      loan.toolId,
      loan.startDate,
      loan.endDate,
      loan.id
    );
    if (overlap) {
      throw new AuthorizationError(
        "CONFLICT",
        `Cannot approve: overlaps existing loan (${overlap.startDate} to ${overlap.endDate}).`
      );
    }

    loan.status = "approved";
    loan.updatedAt = Date.now();
    this.recordLoanEventNotification(loan, "approved");
    return loan;
  }

  public declineLoan(actor: Actor | null, loanId: string): LoanRecord {
    const loan = this.loans.get(loanId);
    if (!loan) {
      throw new AuthorizationError("NOT_FOUND", "Borrow request not found.");
    }
    assertCanManageIncomingLoan(actor, loan);
    if (loan.status !== "pending") {
      throw new AuthorizationError(
        "CONFLICT",
        "Only pending requests can be declined."
      );
    }
    loan.status = "declined";
    loan.updatedAt = Date.now();
    this.recordLoanEventNotification(loan, "declined");
    return loan;
  }

  public markReturned(actor: Actor | null, loanId: string): LoanRecord {
    const loan = this.loans.get(loanId);
    if (!loan) {
      throw new AuthorizationError("NOT_FOUND", "Loan not found.");
    }
    assertCanManageIncomingLoan(actor, loan);
    if (loan.status !== "approved") {
      throw new AuthorizationError(
        "CONFLICT",
        "Only active approved loans can be marked returned."
      );
    }
    loan.status = "returned";
    loan.updatedAt = Date.now();
    this.recordLoanEventNotification(loan, "returned");
    return loan;
  }

  public cancelRequest(actor: Actor | null, loanId: string): LoanRecord {
    const loan = this.loans.get(loanId);
    if (!loan) {
      throw new AuthorizationError("NOT_FOUND", "Borrow request not found.");
    }
    assertCanCancelLoan(actor, loan);
    if (loan.status !== "pending") {
      throw new AuthorizationError(
        "CONFLICT",
        "Only pending requests can be cancelled."
      );
    }
    loan.status = "cancelled";
    loan.updatedAt = Date.now();
    this.recordLoanEventNotification(loan, "cancelled");
    return loan;
  }

  public getOverdueLoansForAutomation(
    todayIso: string = todayIsoUtc()
  ): OverdueLoanAutomationItem[] {
    return [...this.loans.values()]
      .filter(
        (loan) =>
          loan.status === "approved" &&
          computeOverdueDays(loan.endDate, todayIso) > 0
      )
      .map((loan) => {
        const tool = this.tools.get(loan.toolId);
        const borrower = this.users.get(loan.borrowerId);
        const lender = this.users.get(loan.ownerId);
        const daysOverdue = computeOverdueDays(loan.endDate, todayIso);
        return {
          loanId: loan.id,
          toolName: tool?.name ?? "Tool",
          toolCategory: tool?.category ?? "other",
          startDate: loan.startDate,
          endDate: loan.endDate,
          daysOverdue,
          borrowerDisplayName: borrower?.displayName ?? "Neighbor",
          lenderDisplayName: lender?.displayName ?? "Neighbor",
          reminderCount: loan.reminderCount,
          lastReminderAt: loan.lastReminderAt ?? null,
          idempotencyKey: buildOverdueIdempotencyKey(loan.id, todayIso),
        };
      });
  }

  public recordReminderLogged(params: {
    loanId: string;
    idempotencyKey: string;
    channel: string;
    summary: string;
  }): { status: "recorded" | "already_recorded"; duplicate: boolean; logId: string } {
    const existingLogId = this.idempotencyIndex.get(params.idempotencyKey);
    if (existingLogId) {
      return {
        status: "already_recorded",
        duplicate: true,
        logId: existingLogId,
      };
    }

    const loan = this.loans.get(params.loanId);
    if (!loan) {
      throw new AuthorizationError("NOT_FOUND", "Target loan not found.");
    }

    const now = Date.now();
    const logId = this.nextId("log");
    const log: AutomationActivity = {
      id: logId,
      loanId: params.loanId,
      eventType: "overdue_reminder_sent",
      summary: params.summary.slice(0, 200),
      idempotencyKey: params.idempotencyKey,
      channel: params.channel.slice(0, 60),
      createdAt: now,
    };

    this.automationLogs.set(logId, log);
    this.idempotencyIndex.set(params.idempotencyKey, logId);
    loan.lastReminderAt = now;
    loan.reminderCount += 1;
    loan.updatedAt = now;

    return {
      status: "recorded",
      duplicate: false,
      logId,
    };
  }

  public recordNotificationLogged(params: {
    loanId: string;
    idempotencyKey: string;
    channel: string;
    summary: string;
  }): { status: "recorded" | "already_recorded"; duplicate: boolean; logId: string } {
    const existingLogId = this.idempotencyIndex.get(params.idempotencyKey);
    if (existingLogId) {
      return {
        status: "already_recorded",
        duplicate: true,
        logId: existingLogId,
      };
    }

    const loan = this.loans.get(params.loanId);
    if (!loan) {
      throw new AuthorizationError("NOT_FOUND", "Target loan not found.");
    }

    const logId = this.nextId("log");
    const log: AutomationActivity = {
      id: logId,
      loanId: params.loanId,
      eventType: "request_notification_sent",
      summary: params.summary.slice(0, 200),
      idempotencyKey: params.idempotencyKey,
      channel: params.channel.slice(0, 60),
      createdAt: Date.now(),
    };

    this.automationLogs.set(logId, log);
    this.idempotencyIndex.set(params.idempotencyKey, logId);

    return {
      status: "recorded",
      duplicate: false,
      logId,
    };
  }
}

declare global {
  var __lendloopDemoStore: LendLoopStore | undefined;
}

export function getDemoStore(): LendLoopStore {
  if (!globalThis.__lendloopDemoStore) {
    globalThis.__lendloopDemoStore = new LendLoopStore(true);
  }
  return globalThis.__lendloopDemoStore;
}

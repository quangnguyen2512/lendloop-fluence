import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  assertValidDateRange,
  computeDaysOverdue,
  dateRangesOverlap,
  requireAdmin,
  requireUser,
  throwDomainError,
  todayUtcIso,
} from "./security";

type LoanNotificationEvent =
  | "requested"
  | "approved"
  | "declined"
  | "returned"
  | "cancelled";

async function scheduleLoanNotification(
  ctx: MutationCtx,
  params: {
    loanId: Id<"loans">;
    toolId: Id<"tools">;
    ownerId: Id<"users">;
    borrowerId: Id<"users">;
    startDate: string;
    endDate: string;
    event: LoanNotificationEvent;
    status: "pending" | "approved" | "declined" | "returned" | "cancelled";
  }
) {
  const [tool, lender, borrower] = await Promise.all([
    ctx.db.get(params.toolId),
    ctx.db.get(params.ownerId),
    ctx.db.get(params.borrowerId),
  ]);

  const notifyLender =
    params.event === "requested" || params.event === "cancelled";
  const recipientRole = notifyLender ? ("lender" as const) : ("borrower" as const);
  const recipientFirstName = notifyLender
    ? (lender?.displayName ?? "Neighbor")
    : (borrower?.displayName ?? "Neighbor");
  const actorFirstName = notifyLender
    ? (borrower?.displayName ?? "Neighbor")
    : (lender?.displayName ?? "Neighbor");

  await ctx.scheduler.runAfter(
    0,
    internal.automation.dispatchRequestNotification,
    {
      loanId: params.loanId,
      event: params.event,
      status: params.status,
      toolName: tool?.name ?? "Tool",
      toolCategory: tool?.category ?? "other",
      startDate: params.startDate,
      endDate: params.endDate,
      recipientRole,
      recipientFirstName,
      actorFirstName,
    }
  );
}

async function enrichLoans(ctx: QueryCtx, loans: Doc<"loans">[]) {
  const todayIso = todayUtcIso();

  return await Promise.all(
    loans
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(async (loan) => {
        const [tool, owner, borrower, logs] = await Promise.all([
          ctx.db.get(loan.toolId),
          ctx.db.get(loan.ownerId),
          ctx.db.get(loan.borrowerId),
          ctx.db
            .query("automationLogs")
            .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
            .collect(),
        ]);

        const daysOverdue =
          loan.status === "approved"
            ? computeDaysOverdue(loan.endDate, todayIso)
            : 0;

        return {
          ...loan,
          toolName: tool?.name ?? "Removed Tool",
          toolCategory: tool?.category ?? ("other" as const),
          ownerDisplayName: owner?.displayName ?? "Neighbor",
          ownerIsTrustedLender: owner?.isTrustedLender ?? false,
          borrowerDisplayName: borrower?.displayName ?? "Neighbor",
          isOverdue: daysOverdue > 0,
          daysOverdue,
          automationActivity: logs
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 5),
        };
      })
  );
}

export const listMyRequests = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", user._id))
      .collect();
    return await enrichLoans(ctx, loans);
  },
});

export const listIncomingRequests = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    return await enrichLoans(ctx, loans);
  },
});

export const listAllLoansAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").collect();
    return await enrichLoans(ctx, loans);
  },
});

export const requestBorrow = mutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const borrower = await requireUser(ctx);
    assertValidDateRange(args.startDate, args.endDate);

    const tool = await ctx.db.get(args.toolId);
    if (!tool) {
      throwDomainError("NOT_FOUND", "Tool listing not found.");
    }
    if (tool.ownerId === borrower._id) {
      throwDomainError(
        "FORBIDDEN",
        "You cannot request to borrow your own tool."
      );
    }

    const approvedLoans = await ctx.db
      .query("loans")
      .withIndex("by_tool_and_status", (q) =>
        q.eq("toolId", args.toolId).eq("status", "approved")
      )
      .collect();

    const overlap = approvedLoans.find((existing) =>
      dateRangesOverlap(
        existing.startDate,
        existing.endDate,
        args.startDate,
        args.endDate
      )
    );

    if (overlap) {
      throwDomainError(
        "CONFLICT",
        `Tool is already booked from ${overlap.startDate} to ${overlap.endDate}.`
      );
    }

    const now = Date.now();
    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: borrower._id,
      startDate: args.startDate,
      endDate: args.endDate,
      status: "pending",
      note: args.note?.trim().slice(0, 280),
      createdAt: now,
      updatedAt: now,
      reminderCount: 0,
    });

    // Schedule outbound HMAC-signed n8n notification with minimal non-PII fields
    await scheduleLoanNotification(ctx, {
      loanId,
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: borrower._id,
      startDate: args.startDate,
      endDate: args.endDate,
      event: "requested",
      status: "pending",
    });

    return loanId;
  },
});

export const approveLoan = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, args) => {
    const actor = await requireUser(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) {
      throwDomainError("NOT_FOUND", "Borrow request not found.");
    }
    if (loan.ownerId !== actor._id) {
      throwDomainError(
        "FORBIDDEN",
        "Only the tool owner can approve borrow requests."
      );
    }
    if (loan.status !== "pending") {
      throwDomainError("CONFLICT", "Only pending requests can be approved.");
    }

    const tool = await ctx.db.get(loan.toolId);
    if (!tool) {
      throwDomainError(
        "NOT_FOUND",
        "Tool listing no longer exists and cannot be approved."
      );
    }

    // Re-check overlap atomically at approval time
    const approvedLoans = await ctx.db
      .query("loans")
      .withIndex("by_tool_and_status", (q) =>
        q.eq("toolId", loan.toolId).eq("status", "approved")
      )
      .collect();

    const overlap = approvedLoans.find(
      (existing) =>
        existing._id !== loan._id &&
        dateRangesOverlap(
          existing.startDate,
          existing.endDate,
          loan.startDate,
          loan.endDate
        )
    );
    if (overlap) {
      throwDomainError(
        "CONFLICT",
        `Cannot approve: overlaps existing loan (${overlap.startDate} to ${overlap.endDate}).`
      );
    }

    await ctx.db.patch(args.loanId, {
      status: "approved",
      updatedAt: Date.now(),
    });

    await scheduleLoanNotification(ctx, {
      loanId: loan._id,
      toolId: loan.toolId,
      ownerId: loan.ownerId,
      borrowerId: loan.borrowerId,
      startDate: loan.startDate,
      endDate: loan.endDate,
      event: "approved",
      status: "approved",
    });

    return { loanId: args.loanId, status: "approved" as const };
  },
});

export const declineLoan = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, args) => {
    const actor = await requireUser(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) {
      throwDomainError("NOT_FOUND", "Borrow request not found.");
    }
    if (loan.ownerId !== actor._id) {
      throwDomainError(
        "FORBIDDEN",
        "Only the tool owner can decline borrow requests."
      );
    }
    if (loan.status !== "pending") {
      throwDomainError("CONFLICT", "Only pending requests can be declined.");
    }

    await ctx.db.patch(args.loanId, {
      status: "declined",
      updatedAt: Date.now(),
    });

    await scheduleLoanNotification(ctx, {
      loanId: loan._id,
      toolId: loan.toolId,
      ownerId: loan.ownerId,
      borrowerId: loan.borrowerId,
      startDate: loan.startDate,
      endDate: loan.endDate,
      event: "declined",
      status: "declined",
    });

    return { loanId: args.loanId, status: "declined" as const };
  },
});

export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, args) => {
    const actor = await requireUser(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) {
      throwDomainError("NOT_FOUND", "Loan not found.");
    }
    if (loan.ownerId !== actor._id) {
      throwDomainError(
        "FORBIDDEN",
        "Only the tool owner can mark a loan as returned."
      );
    }
    if (loan.status !== "approved") {
      throwDomainError(
        "CONFLICT",
        "Only active approved loans can be marked returned."
      );
    }

    await ctx.db.patch(args.loanId, {
      status: "returned",
      updatedAt: Date.now(),
    });

    await scheduleLoanNotification(ctx, {
      loanId: loan._id,
      toolId: loan.toolId,
      ownerId: loan.ownerId,
      borrowerId: loan.borrowerId,
      startDate: loan.startDate,
      endDate: loan.endDate,
      event: "returned",
      status: "returned",
    });

    return { loanId: args.loanId, status: "returned" as const };
  },
});

export const cancelRequest = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, args) => {
    const actor = await requireUser(ctx);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) {
      throwDomainError("NOT_FOUND", "Borrow request not found.");
    }
    if (loan.borrowerId !== actor._id) {
      throwDomainError(
        "FORBIDDEN",
        "Only the borrower can cancel their own borrow request."
      );
    }
    if (loan.status !== "pending") {
      throwDomainError(
        "CONFLICT",
        "Only pending requests can be cancelled by the borrower."
      );
    }

    await ctx.db.patch(args.loanId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });

    await scheduleLoanNotification(ctx, {
      loanId: loan._id,
      toolId: loan.toolId,
      ownerId: loan.ownerId,
      borrowerId: loan.borrowerId,
      startDate: loan.startDate,
      endDate: loan.endDate,
      event: "cancelled",
      status: "cancelled",
    });

    return { loanId: args.loanId, status: "cancelled" as const };
  },
});

/**
 * INTERNAL: Called exclusively by HMAC-verified Convex HTTP Action
 * `GET /api/automation/overdue-loans`. Returns minimal non-PII fields only.
 */
export const getOverdueLoansInternal = internalQuery({
  args: {
    todayIso: v.string(),
  },
  handler: async (ctx, args) => {
    const approvedLoans = await ctx.db
      .query("loans")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();

    const overdue = approvedLoans.filter(
      (loan) => computeDaysOverdue(loan.endDate, args.todayIso) > 0
    );

    return await Promise.all(
      overdue.map(async (loan) => {
        const [tool, borrower, lender] = await Promise.all([
          ctx.db.get(loan.toolId),
          ctx.db.get(loan.borrowerId),
          ctx.db.get(loan.ownerId),
        ]);
        const daysOverdue = computeDaysOverdue(loan.endDate, args.todayIso);
        return {
          loanId: loan._id,
          toolName: tool?.name ?? "Tool",
          toolCategory: tool?.category ?? ("other" as const),
          startDate: loan.startDate,
          endDate: loan.endDate,
          daysOverdue,
          borrowerDisplayName: borrower?.displayName ?? "Neighbor",
          lenderDisplayName: lender?.displayName ?? "Neighbor",
          reminderCount: loan.reminderCount,
          lastReminderAt: loan.lastReminderAt ?? null,
          idempotencyKey: `overdue:${loan._id}:${args.todayIso}`,
        };
      })
    );
  },
});

/**
 * INTERNAL: Idempotent write-back invoked by HMAC-verified
 * `POST /api/automation/reminder-logged`.
 */
export const recordReminderLoggedInternal = internalMutation({
  args: {
    loanId: v.id("loans"),
    idempotencyKey: v.string(),
    channel: v.string(),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationLogs")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey)
      )
      .unique();

    if (existing) {
      return {
        status: "already_recorded" as const,
        duplicate: true,
        logId: existing._id,
      };
    }

    const loan = await ctx.db.get(args.loanId);
    if (!loan) {
      throwDomainError("NOT_FOUND", "Target loan not found.");
    }

    const now = Date.now();
    const logId = await ctx.db.insert("automationLogs", {
      loanId: args.loanId,
      eventType: "overdue_reminder_sent",
      summary: args.summary.slice(0, 200),
      idempotencyKey: args.idempotencyKey,
      channel: args.channel.slice(0, 60),
      createdAt: now,
    });

    await ctx.db.patch(args.loanId, {
      lastReminderAt: now,
      reminderCount: loan.reminderCount + 1,
      updatedAt: now,
    });

    return {
      status: "recorded" as const,
      duplicate: false,
      logId,
    };
  },
});

export const recordNotificationLoggedInternal = internalMutation({
  args: {
    loanId: v.id("loans"),
    idempotencyKey: v.string(),
    channel: v.string(),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationLogs")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey)
      )
      .unique();

    if (existing) {
      return {
        status: "already_recorded" as const,
        duplicate: true,
        logId: existing._id,
      };
    }

    const loan = await ctx.db.get(args.loanId);
    if (!loan) {
      throwDomainError("NOT_FOUND", "Target loan not found.");
    }

    const logId = await ctx.db.insert("automationLogs", {
      loanId: args.loanId,
      eventType: "request_notification_sent",
      summary: args.summary.slice(0, 200),
      idempotencyKey: args.idempotencyKey,
      channel: args.channel.slice(0, 60),
      createdAt: Date.now(),
    });

    return {
      status: "recorded" as const,
      duplicate: false,
      logId,
    };
  },
});

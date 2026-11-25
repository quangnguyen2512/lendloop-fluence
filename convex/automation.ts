import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { loanStatusValidator } from "./schema";
import { signHmacHeaders } from "./security";

const loanEventValidator = v.union(
  v.literal("requested"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("returned"),
  v.literal("cancelled")
);

const recipientRoleValidator = v.union(v.literal("lender"), v.literal("borrower"));

function buildActivitySummary(
  event: "requested" | "approved" | "declined" | "returned" | "cancelled",
  recipientFirstName: string
): string {
  switch (event) {
    case "requested":
      return `Request notification delivered to ${recipientFirstName}`;
    case "approved":
      return `Approval notification delivered to ${recipientFirstName}`;
    case "declined":
      return `Decline notification delivered to ${recipientFirstName}`;
    case "returned":
      return `Return confirmation delivered to ${recipientFirstName}`;
    case "cancelled":
      return `Cancellation notice delivered to ${recipientFirstName}`;
  }
}

/**
 * Outbound HMAC-SHA256 webhook dispatcher from Convex -> n8n.
 * Fires whenever a borrow request is created OR changes status, sending
 * strictly minimal non-PII fields for the relevant recipient (lender or borrower).
 */
export const dispatchRequestNotification = internalAction({
  args: {
    loanId: v.id("loans"),
    event: loanEventValidator,
    status: loanStatusValidator,
    toolName: v.string(),
    toolCategory: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    recipientRole: recipientRoleValidator,
    recipientFirstName: v.string(),
    actorFirstName: v.string(),
  },
  handler: async (ctx, args) => {
    const webhookUrl = process.env.N8N_REQUEST_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_HMAC_SECRET;

    if (!webhookUrl || !secret) {
      // Gracefully skip external dispatch when webhook integration isn't wired yet
      return { delivered: false, reason: "automation_env_not_configured" };
    }

    const eventId = `notify:${args.loanId}:${args.event}`;
    const payload = {
      event: `loan.${args.event}`,
      eventId,
      status: args.status,
      loanId: args.loanId,
      toolName: args.toolName,
      toolCategory: args.toolCategory,
      startDate: args.startDate,
      endDate: args.endDate,
      recipientRole: args.recipientRole,
      recipientFirstName: args.recipientFirstName,
      actorFirstName: args.actorFirstName,
    };

    const rawBody = JSON.stringify(payload);
    const hmacHeaders = await signHmacHeaders(secret, rawBody);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...hmacHeaders,
      },
      body: rawBody,
    });

    if (!response.ok) {
      throw new Error(
        `n8n request-notification webhook returned HTTP ${response.status}`
      );
    }

    // Idempotent fallback write-back (if n8n already wrote back with the same eventId, this is a no-op)
    await ctx.runMutation(internal.loans.recordNotificationLoggedInternal, {
      loanId: args.loanId,
      idempotencyKey: eventId,
      channel: "n8n_request_workflow",
      summary: buildActivitySummary(args.event, args.recipientFirstName),
    });

    return { delivered: true, eventId };
  },
});

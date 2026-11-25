import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const toolCategoryValidator = v.union(
  v.literal("power_tools"),
  v.literal("garden"),
  v.literal("kitchen"),
  v.literal("camping"),
  v.literal("automotive"),
  v.literal("other")
);

export const toolConditionValidator = v.union(
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair")
);

export const loanStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("returned"),
  v.literal("cancelled")
);

export const userRoleValidator = v.union(v.literal("user"), v.literal("admin"));

export const automationEventTypeValidator = v.union(
  v.literal("request_notification_sent"),
  v.literal("overdue_reminder_sent"),
  v.literal("automation_error")
);

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    displayName: v.string(),
    role: userRoleValidator,
    isTrustedLender: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_role", ["role"]),

  tools: defineTable({
    name: v.string(),
    category: toolCategoryValidator,
    condition: toolConditionValidator,
    shortDescription: v.string(),
    ownerId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(), // YYYY-MM-DD
    status: loanStatusValidator,
    note: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastReminderAt: v.optional(v.number()),
    reminderCount: v.number(),
  })
    .index("by_tool", ["toolId"])
    .index("by_owner", ["ownerId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status", ["status"])
    .index("by_tool_and_status", ["toolId", "status"]),

  automationLogs: defineTable({
    loanId: v.id("loans"),
    eventType: automationEventTypeValidator,
    summary: v.string(),
    idempotencyKey: v.string(),
    channel: v.string(),
    createdAt: v.number(),
  })
    .index("by_loan", ["loanId"])
    .index("by_idempotency_key", ["idempotencyKey"]),
});

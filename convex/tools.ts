import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { toolCategoryValidator, toolConditionValidator } from "./schema";
import { requireUser, throwDomainError } from "./security";

/**
 * PUBLIC READ-ONLY CATALOG (DATA MINIMIZATION ENFORCED AT QUERY LAYER).
 * Returns ONLY currently available tools and ONLY `{ _id, name, category }`.
 * Strictly ZERO owner details, emails, descriptions, or PII leave the backend.
 */
export const listPublicAvailable = query({
  args: {},
  handler: async (ctx) => {
    const [tools, activeLoans] = await Promise.all([
      ctx.db.query("tools").collect(),
      ctx.db
        .query("loans")
        .withIndex("by_status", (q) => q.eq("status", "approved"))
        .collect(),
    ]);

    const loanedToolIds = new Set(activeLoans.map((loan) => loan.toolId));

    return tools
      .filter((tool) => !loanedToolIds.has(tool._id))
      .map((tool) => ({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
      }));
  },
});

export const listAuthenticated = query({
  args: {
    category: v.optional(toolCategoryValidator),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);

    const tools = args.category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", args.category!))
          .collect()
      : await ctx.db.query("tools").collect();

    const activeLoans = await ctx.db
      .query("loans")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();

    const activeLoanByTool = new Map(
      activeLoans.map((loan) => [loan.toolId, loan])
    );

    const ownerIds = [...new Set(tools.map((t) => t.ownerId))];
    const owners = await Promise.all(ownerIds.map((id) => ctx.db.get(id)));
    const ownerMap = new Map(
      owners
        .filter((u): u is NonNullable<typeof u> => u !== null)
        .map((u) => [u._id, u])
    );

    return tools
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((tool) => {
        const owner = ownerMap.get(tool.ownerId);
        const activeLoan = activeLoanByTool.get(tool._id);
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          shortDescription: tool.shortDescription,
          ownerId: tool.ownerId,
          ownerDisplayName: owner?.displayName ?? "Neighbor",
          ownerIsTrustedLender: owner?.isTrustedLender ?? false,
          availabilityStatus: activeLoan ? ("on_loan" as const) : ("available" as const),
          activeLoanEndDate: activeLoan?.endDate ?? null,
          createdAt: tool.createdAt,
          updatedAt: tool.updatedAt,
        };
      });
  },
});

export const listMyListings = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const [tools, activeLoans] = await Promise.all([
      ctx.db
        .query("tools")
        .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
        .collect(),
      ctx.db
        .query("loans")
        .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
        .collect(),
    ]);

    const approvedByTool = new Map(
      activeLoans
        .filter((l) => l.status === "approved")
        .map((l) => [l.toolId, l])
    );

    return tools
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((tool) => {
        const active = approvedByTool.get(tool._id);
        return {
          ...tool,
          availabilityStatus: active ? ("on_loan" as const) : ("available" as const),
          activeLoanEndDate: active?.endDate ?? null,
        };
      });
  },
});

export const createTool = mutation({
  args: {
    name: v.string(),
    category: toolCategoryValidator,
    condition: toolConditionValidator,
    shortDescription: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const name = args.name.trim();
    const shortDescription = args.shortDescription.trim();

    if (name.length < 2 || name.length > 100) {
      throwDomainError(
        "BAD_REQUEST",
        "Tool name must be between 2 and 100 characters."
      );
    }
    if (shortDescription.length < 5 || shortDescription.length > 400) {
      throwDomainError(
        "BAD_REQUEST",
        "Short description must be between 5 and 400 characters."
      );
    }

    const now = Date.now();
    return await ctx.db.insert("tools", {
      name,
      category: args.category,
      condition: args.condition,
      shortDescription,
      ownerId: user._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateTool = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: toolCategoryValidator,
    condition: toolConditionValidator,
    shortDescription: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) {
      throwDomainError("NOT_FOUND", "Tool listing not found.");
    }
    if (tool.ownerId !== user._id) {
      throwDomainError("FORBIDDEN", "You can only edit your own listings.");
    }

    const name = args.name.trim();
    const shortDescription = args.shortDescription.trim();
    if (name.length < 2 || name.length > 100) {
      throwDomainError(
        "BAD_REQUEST",
        "Tool name must be between 2 and 100 characters."
      );
    }
    if (shortDescription.length < 5 || shortDescription.length > 400) {
      throwDomainError(
        "BAD_REQUEST",
        "Short description must be between 5 and 400 characters."
      );
    }

    await ctx.db.patch(args.toolId, {
      name,
      category: args.category,
      condition: args.condition,
      shortDescription,
      updatedAt: Date.now(),
    });
    return args.toolId;
  },
});

export const removeTool = mutation({
  args: {
    toolId: v.id("tools"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool) {
      throwDomainError("NOT_FOUND", "Tool listing not found.");
    }
    // Server-side RBAC: only tool owner or admin may remove a listing
    if (user.role !== "admin" && tool.ownerId !== user._id) {
      throwDomainError(
        "FORBIDDEN",
        "Only the tool owner or an admin can remove this listing."
      );
    }

    const activeLoan = await ctx.db
      .query("loans")
      .withIndex("by_tool_and_status", (q) =>
        q.eq("toolId", args.toolId).eq("status", "approved")
      )
      .first();

    if (activeLoan) {
      throwDomainError(
        "CONFLICT",
        "Cannot delete a tool while an approved loan is active. Mark it returned first."
      );
    }

    // Auto-decline any open pending requests on the removed listing and notify borrowers
    const pendingLoans = await ctx.db
      .query("loans")
      .withIndex("by_tool_and_status", (q) =>
        q.eq("toolId", args.toolId).eq("status", "pending")
      )
      .collect();

    const now = Date.now();
    const lender = await ctx.db.get(tool.ownerId);
    for (const pending of pendingLoans) {
      await ctx.db.patch(pending._id, {
        status: "declined",
        updatedAt: now,
      });
      const borrower = await ctx.db.get(pending.borrowerId);
      await ctx.scheduler.runAfter(
        0,
        internal.automation.dispatchRequestNotification,
        {
          loanId: pending._id,
          event: "declined",
          status: "declined",
          toolName: tool.name,
          toolCategory: tool.category,
          startDate: pending.startDate,
          endDate: pending.endDate,
          recipientRole: "borrower",
          recipientFirstName: borrower?.displayName ?? "Neighbor",
          actorFirstName: lender?.displayName ?? "Neighbor",
        }
      );
    }

    await ctx.db.delete(args.toolId);
    return { deleted: true, toolId: args.toolId };
  },
});

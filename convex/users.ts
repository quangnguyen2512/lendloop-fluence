import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, throwDomainError } from "./security";

/**
 * Syncs the verified Clerk JWT identity into Convex `users`.
 * Role assignment NEVER trusts client arguments — admin role is granted only
 * via verified Clerk JWT custom claim (`role === "admin"`).
 */
export const syncCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throwDomainError("UNAUTHORIZED", "Sign in before syncing profile.");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    const jwtRole =
      (identity as Record<string, unknown>).role === "admin" ? "admin" : "user";
    const displayName =
      identity.givenName ||
      identity.nickname ||
      identity.name?.split(" ")[0] ||
      "Neighbor";

    if (existing) {
      if (existing.displayName !== displayName || existing.role !== jwtRole) {
        await ctx.db.patch(existing._id, {
          displayName,
          role: jwtRole,
        });
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      clerkId: identity.subject,
      displayName,
      role: jwtRole,
      isTrustedLender: false,
      createdAt: Date.now(),
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) {
      return null;
    }
    return {
      _id: user._id,
      displayName: user.displayName,
      role: user.role,
      isTrustedLender: user.isTrustedLender,
      createdAt: user.createdAt,
    };
  },
});

export const listUsersForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [users, tools] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("tools").collect(),
    ]);

    const toolCounts = new Map<string, number>();
    for (const tool of tools) {
      toolCounts.set(tool.ownerId, (toolCounts.get(tool.ownerId) ?? 0) + 1);
    }

    return users.map((u) => ({
      _id: u._id,
      displayName: u.displayName,
      role: u.role,
      isTrustedLender: u.isTrustedLender,
      toolCount: toolCounts.get(u._id) ?? 0,
      createdAt: u.createdAt,
    }));
  },
});

export const toggleTrustedLender = mutation({
  args: {
    userId: v.id("users"),
    isTrustedLender: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(args.userId);
    if (!target) {
      throwDomainError("NOT_FOUND", "Target user not found.");
    }
    await ctx.db.patch(args.userId, {
      isTrustedLender: args.isTrustedLender,
    });
    return {
      userId: args.userId,
      isTrustedLender: args.isTrustedLender,
    };
  },
});

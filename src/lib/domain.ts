import type {
  LoanRecord,
  LoanStatus,
  PublicToolProjection,
  ToolCategory,
  ToolCondition,
  ToolInput,
  ToolRecord,
} from "./types";
import { AuthorizationError } from "./authz";

export const TOOL_CATEGORIES: readonly ToolCategory[] = [
  "power_tools",
  "garden",
  "kitchen",
  "camping",
  "automotive",
  "other",
] as const;

export const TOOL_CONDITIONS: readonly ToolCondition[] = [
  "like_new",
  "good",
  "fair",
] as const;

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  power_tools: "Power Tools",
  garden: "Garden & Yard",
  kitchen: "Kitchen",
  camping: "Camping & Outdoors",
  automotive: "Automotive",
  other: "Other",
};

export const CONDITION_LABELS: Record<ToolCondition, string> = {
  like_new: "Like New",
  good: "Good",
  fair: "Fair",
};

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  pending: "Pending Approval",
  approved: "Active Loan",
  declined: "Declined",
  returned: "Returned",
  cancelled: "Cancelled",
};

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Enforces data minimization at the query/domain layer.
 * Returns strictly `{ id, name, category }` — zero owner details, zero PII.
 */
export function projectPublicTool(
  tool: Pick<ToolRecord, "id" | "name" | "category">
): PublicToolProjection {
  return {
    id: tool.id,
    name: tool.name,
    category: tool.category,
  };
}

export function isValidIsoDate(dateStr: string): boolean {
  if (!ISO_DATE_REGEX.test(dateStr)) {
    return false;
  }
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function todayIsoUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function validateDateRange(startDate: string, endDate: string): void {
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
    throw new AuthorizationError(
      "BAD_REQUEST",
      "startDate and endDate must be valid calendar dates in YYYY-MM-DD format."
    );
  }
  if (startDate > endDate) {
    throw new AuthorizationError(
      "BAD_REQUEST",
      "endDate must be on or after startDate."
    );
  }
}

export function datesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function findOverlappingApprovedLoan(
  loans: readonly LoanRecord[],
  toolId: string,
  startDate: string,
  endDate: string,
  excludeLoanId?: string
): LoanRecord | undefined {
  return loans.find(
    (loan) =>
      loan.toolId === toolId &&
      loan.status === "approved" &&
      loan.id !== excludeLoanId &&
      datesOverlap(loan.startDate, loan.endDate, startDate, endDate)
  );
}

export function isToolCurrentlyAvailable(
  loans: readonly LoanRecord[],
  toolId: string
): { available: boolean; activeLoanEndDate: string | null } {
  const active = loans.find(
    (loan) => loan.toolId === toolId && loan.status === "approved"
  );
  if (!active) {
    return { available: true, activeLoanEndDate: null };
  }
  return { available: false, activeLoanEndDate: active.endDate };
}

export function computeOverdueDays(
  endDate: string,
  todayIso: string = todayIsoUtc()
): number {
  if (!isValidIsoDate(endDate) || !isValidIsoDate(todayIso)) {
    return 0;
  }
  if (todayIso <= endDate) {
    return 0;
  }
  const endMs = Date.parse(`${endDate}T00:00:00.000Z`);
  const todayMs = Date.parse(`${todayIso}T00:00:00.000Z`);
  return Math.max(0, Math.floor((todayMs - endMs) / 86_400_000));
}

/**
 * Deterministic daily idempotency key for overdue loan reminders.
 * Format: `overdue:{loanId}:{YYYY-MM-DD}`
 */
export function buildOverdueIdempotencyKey(
  loanId: string,
  dateIso: string = todayIsoUtc()
): string {
  const cleanLoanId = loanId.trim();
  if (!cleanLoanId) {
    throw new AuthorizationError("BAD_REQUEST", "loanId is required.");
  }
  if (!isValidIsoDate(dateIso)) {
    throw new AuthorizationError(
      "BAD_REQUEST",
      "dateIso must be a valid YYYY-MM-DD UTC date."
    );
  }
  return `overdue:${cleanLoanId}:${dateIso}`;
}

export function buildNotificationIdempotencyKey(
  loanId: string,
  eventName: string
): string {
  return `notify:${loanId.trim()}:${eventName.trim()}`;
}

export function validateToolInput(input: ToolInput): ToolInput {
  const name = input.name.trim();
  const shortDescription = input.shortDescription.trim();

  if (name.length < 2 || name.length > 100) {
    throw new AuthorizationError(
      "BAD_REQUEST",
      "Tool name must be between 2 and 100 characters."
    );
  }
  if (!TOOL_CATEGORIES.includes(input.category)) {
    throw new AuthorizationError(
      "BAD_REQUEST",
      `Unsupported tool category: ${String(input.category)}`
    );
  }
  if (!TOOL_CONDITIONS.includes(input.condition)) {
    throw new AuthorizationError(
      "BAD_REQUEST",
      `Unsupported tool condition: ${String(input.condition)}`
    );
  }
  if (shortDescription.length < 5 || shortDescription.length > 400) {
    throw new AuthorizationError(
      "BAD_REQUEST",
      "Short description must be between 5 and 400 characters."
    );
  }

  return {
    name,
    category: input.category,
    condition: input.condition,
    shortDescription,
  };
}

export function formatRelativeTime(
  timestampMs: number,
  nowMs: number = Date.now()
): string {
  const diffSeconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (diffSeconds < 60) {
    return "just now";
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} ${diffMinutes === 1 ? "minute" : "minutes"} ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} ${diffDays === 1 ? "day" : "days"} ago`;
}

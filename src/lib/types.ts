export type ToolCategory =
  | "power_tools"
  | "garden"
  | "kitchen"
  | "camping"
  | "automotive"
  | "other";

export type ToolCondition = "like_new" | "good" | "fair";

export type LoanStatus =
  | "pending"
  | "approved"
  | "declined"
  | "returned"
  | "cancelled";

export type UserRole = "user" | "admin";

export type AutomationEventType =
  | "request_notification_sent"
  | "overdue_reminder_sent"
  | "automation_error";

export interface Actor {
  id: string;
  clerkId: string;
  displayName: string;
  role: UserRole;
  isTrustedLender: boolean;
}

export interface UserRecord extends Actor {
  /** Internal only — never exposed in public queries or peer responses */
  internalEmail?: string;
  createdAt: number;
}

/**
 * STRICT DATA-MINIMIZATION PROJECTION FOR UNAUTHENTICATED PUBLIC VIEW.
 * Must NEVER include ownerId, ownerName, email, condition, description, or PII.
 */
export interface PublicToolProjection {
  id: string;
  name: string;
  category: ToolCategory;
}

export interface ToolRecord {
  id: string;
  name: string;
  category: ToolCategory;
  condition: ToolCondition;
  shortDescription: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

export interface AuthenticatedToolView extends ToolRecord {
  ownerDisplayName: string;
  ownerIsTrustedLender: boolean;
  availabilityStatus: "available" | "on_loan";
  activeLoanEndDate: string | null;
}

export interface AutomationActivity {
  id: string;
  loanId: string;
  eventType: AutomationEventType;
  summary: string;
  idempotencyKey: string;
  channel: string;
  createdAt: number;
}

export interface LoanRecord {
  id: string;
  toolId: string;
  ownerId: string;
  borrowerId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: LoanStatus;
  note?: string;
  createdAt: number;
  updatedAt: number;
  lastReminderAt?: number;
  reminderCount: number;
}

export interface LoanView extends LoanRecord {
  toolName: string;
  toolCategory: ToolCategory;
  ownerDisplayName: string;
  ownerIsTrustedLender: boolean;
  borrowerDisplayName: string;
  isOverdue: boolean;
  daysOverdue: number;
  automationActivity: AutomationActivity[];
}

export interface OverdueLoanAutomationItem {
  loanId: string;
  toolName: string;
  toolCategory: ToolCategory;
  startDate: string;
  endDate: string;
  daysOverdue: number;
  borrowerDisplayName: string;
  lenderDisplayName: string;
  reminderCount: number;
  lastReminderAt: number | null;
  idempotencyKey: string;
}

export interface ToolInput {
  name: string;
  category: ToolCategory;
  condition: ToolCondition;
  shortDescription: string;
}

export interface AdminUserSummary {
  id: string;
  displayName: string;
  role: UserRole;
  isTrustedLender: boolean;
  toolCount: number;
  createdAt: number;
}

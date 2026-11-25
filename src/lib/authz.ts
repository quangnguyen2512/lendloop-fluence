import type { Actor, LoanRecord, ToolRecord } from "./types";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "BAD_REQUEST"
  | "NOT_FOUND";

const CODE_TO_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFLICT: 409,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
};

export class AuthorizationError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;

  constructor(code: ErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "AuthorizationError";
    this.code = code;
    this.statusCode = CODE_TO_STATUS[code];
  }
}

export function requireAuthenticated(actor: Actor | null | undefined): Actor {
  if (!actor) {
    throw new AuthorizationError(
      "UNAUTHORIZED",
      "Authentication required to perform this action."
    );
  }
  return actor;
}

export function requireAdmin(actor: Actor | null | undefined): Actor {
  const authed = requireAuthenticated(actor);
  if (authed.role !== "admin") {
    throw new AuthorizationError(
      "FORBIDDEN",
      "Admin privileges are required for this operation."
    );
  }
  return authed;
}

export function assertCanEditTool(
  actor: Actor | null | undefined,
  tool: Pick<ToolRecord, "ownerId">
): Actor {
  const authed = requireAuthenticated(actor);
  if (tool.ownerId !== authed.id) {
    throw new AuthorizationError(
      "FORBIDDEN",
      "You can only edit your own tool listings."
    );
  }
  return authed;
}

export function assertCanDeleteTool(
  actor: Actor | null | undefined,
  tool: Pick<ToolRecord, "ownerId">
): Actor {
  const authed = requireAuthenticated(actor);
  if (authed.role === "admin" || tool.ownerId === authed.id) {
    return authed;
  }
  throw new AuthorizationError(
    "FORBIDDEN",
    "You can only delete your own tool listings unless you are an admin."
  );
}

export function assertCanRequestBorrow(
  actor: Actor | null | undefined,
  tool: Pick<ToolRecord, "ownerId">
): Actor {
  const authed = requireAuthenticated(actor);
  if (tool.ownerId === authed.id) {
    throw new AuthorizationError(
      "FORBIDDEN",
      "You cannot request to borrow your own tool."
    );
  }
  return authed;
}

export function assertCanManageIncomingLoan(
  actor: Actor | null | undefined,
  loan: Pick<LoanRecord, "ownerId">
): Actor {
  const authed = requireAuthenticated(actor);
  if (loan.ownerId !== authed.id) {
    throw new AuthorizationError(
      "FORBIDDEN",
      "Only the tool owner can approve, decline, or mark this loan returned."
    );
  }
  return authed;
}

export function assertCanCancelLoan(
  actor: Actor | null | undefined,
  loan: Pick<LoanRecord, "borrowerId">
): Actor {
  const authed = requireAuthenticated(actor);
  if (loan.borrowerId !== authed.id) {
    throw new AuthorizationError(
      "FORBIDDEN",
      "Only the borrower who submitted this request can cancel it."
    );
  }
  return authed;
}

export function assertCanViewLoan(
  actor: Actor | null | undefined,
  loan: Pick<LoanRecord, "ownerId" | "borrowerId">
): Actor {
  const authed = requireAuthenticated(actor);
  if (
    authed.role === "admin" ||
    loan.borrowerId === authed.id ||
    loan.ownerId === authed.id
  ) {
    return authed;
  }
  throw new AuthorizationError(
    "FORBIDDEN",
    "You do not have permission to view this loan."
  );
}

export function assertCanViewAllLoans(actor: Actor | null | undefined): Actor {
  return requireAdmin(actor);
}

export function assertCanToggleTrustedLender(
  actor: Actor | null | undefined
): Actor {
  return requireAdmin(actor);
}

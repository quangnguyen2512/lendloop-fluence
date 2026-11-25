import { describe, expect, it } from "vitest";
import {
  assertCanCancelLoan,
  assertCanDeleteTool,
  assertCanEditTool,
  assertCanManageIncomingLoan,
  assertCanRequestBorrow,
  assertCanToggleTrustedLender,
  assertCanViewAllLoans,
  assertCanViewLoan,
  AuthorizationError,
  requireAdmin,
  requireAuthenticated,
} from "@/lib/authz";
import type { Actor } from "@/lib/types";

const userMaya: Actor = {
  id: "user_maya",
  clerkId: "clerk_maya",
  displayName: "Maya Chen",
  role: "user",
  isTrustedLender: true,
};

const userMarcus: Actor = {
  id: "user_marcus",
  clerkId: "clerk_marcus",
  displayName: "Marcus Vance",
  role: "user",
  isTrustedLender: false,
};

const adminElena: Actor = {
  id: "user_elena",
  clerkId: "clerk_elena",
  displayName: "Dr. Elena Rostova",
  role: "admin",
  isTrustedLender: true,
};

function expectAuthError(fn: () => unknown, expectedCode: "UNAUTHORIZED" | "FORBIDDEN") {
  try {
    fn();
    throw new Error(`Expected AuthorizationError(${expectedCode}) but succeeded.`);
  } catch (err) {
    expect(err).toBeInstanceOf(AuthorizationError);
    expect((err as AuthorizationError).code).toBe(expectedCode);
  }
}

describe("Server-side RBAC & Ownership Authorization", () => {
  it("rejects unauthenticated callers with UNAUTHORIZED", () => {
    expectAuthError(() => requireAuthenticated(null), "UNAUTHORIZED");
    expectAuthError(() => requireAdmin(undefined), "UNAUTHORIZED");
    expectAuthError(
      () => assertCanEditTool(null, { ownerId: userMaya.id }),
      "UNAUTHORIZED"
    );
    expectAuthError(
      () => assertCanDeleteTool(null, { ownerId: userMaya.id }),
      "UNAUTHORIZED"
    );
    expectAuthError(
      () => assertCanRequestBorrow(null, { ownerId: userMaya.id }),
      "UNAUTHORIZED"
    );
  });

  it("enforces owner-only editing on listings (even across users)", () => {
    expect(assertCanEditTool(userMaya, { ownerId: userMaya.id })).toEqual(userMaya);
    expectAuthError(
      () => assertCanEditTool(userMarcus, { ownerId: userMaya.id }),
      "FORBIDDEN"
    );
    expectAuthError(
      () => assertCanEditTool(adminElena, { ownerId: userMaya.id }),
      "FORBIDDEN"
    );
  });

  it("allows owner OR admin to delete a listing, and forbids non-owner users", () => {
    expect(assertCanDeleteTool(userMaya, { ownerId: userMaya.id })).toEqual(userMaya);
    expect(assertCanDeleteTool(adminElena, { ownerId: userMaya.id })).toEqual(adminElena);
    expectAuthError(
      () => assertCanDeleteTool(userMarcus, { ownerId: userMaya.id }),
      "FORBIDDEN"
    );
  });

  it("forbids self-borrowing own tool", () => {
    expect(assertCanRequestBorrow(userMarcus, { ownerId: userMaya.id })).toEqual(userMarcus);
    expectAuthError(
      () => assertCanRequestBorrow(userMaya, { ownerId: userMaya.id }),
      "FORBIDDEN"
    );
  });

  it("restricts approve/decline/return actions strictly to the tool owner", () => {
    const loan = { ownerId: userMaya.id, borrowerId: userMarcus.id };
    expect(assertCanManageIncomingLoan(userMaya, loan)).toEqual(userMaya);
    expectAuthError(() => assertCanManageIncomingLoan(userMarcus, loan), "FORBIDDEN");
    expectAuthError(() => assertCanManageIncomingLoan(adminElena, loan), "FORBIDDEN");
  });

  it("restricts borrow request cancellation strictly to the borrower", () => {
    const loan = { ownerId: userMaya.id, borrowerId: userMarcus.id };
    expect(assertCanCancelLoan(userMarcus, loan)).toEqual(userMarcus);
    expectAuthError(() => assertCanCancelLoan(userMaya, loan), "FORBIDDEN");
    expectAuthError(() => assertCanCancelLoan(adminElena, loan), "FORBIDDEN");
  });

  it("restricts loan viewing to owner, borrower, or admin", () => {
    const loan = { ownerId: userMaya.id, borrowerId: userMarcus.id };
    const thirdParty: Actor = {
      id: "user_third",
      clerkId: "clerk_third",
      displayName: "Sam",
      role: "user",
      isTrustedLender: false,
    };
    expect(assertCanViewLoan(userMaya, loan)).toEqual(userMaya);
    expect(assertCanViewLoan(userMarcus, loan)).toEqual(userMarcus);
    expect(assertCanViewLoan(adminElena, loan)).toEqual(adminElena);
    expectAuthError(() => assertCanViewLoan(thirdParty, loan), "FORBIDDEN");
  });

  it("restricts viewing all loans and toggling Trusted Lender strictly to admins", () => {
    expect(assertCanViewAllLoans(adminElena)).toEqual(adminElena);
    expect(assertCanToggleTrustedLender(adminElena)).toEqual(adminElena);

    expectAuthError(() => assertCanViewAllLoans(userMaya), "FORBIDDEN");
    expectAuthError(() => assertCanViewAllLoans(userMarcus), "FORBIDDEN");
    expectAuthError(() => assertCanToggleTrustedLender(userMaya), "FORBIDDEN");
    expectAuthError(() => assertCanToggleTrustedLender(userMarcus), "FORBIDDEN");
  });
});

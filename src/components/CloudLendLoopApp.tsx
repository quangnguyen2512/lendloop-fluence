"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { LogIn, Wrench } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type {
  Actor,
  AdminUserSummary,
  AuthenticatedToolView,
  LoanView,
  PublicToolProjection,
  ToolInput,
} from "@/lib/types";
import {
  AuthenticatedWorkspace,
  type WorkspaceActions,
} from "./AuthenticatedWorkspace";
import { PublicCatalog } from "./PublicCatalog";

/**
 * Live Clerk + Convex Workspace.
 * Mounted automatically whenever `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
 * and `NEXT_PUBLIC_CONVEX_URL` are configured.
 */
export function CloudLendLoopApp() {
  const { isLoaded, isSignedIn } = useAuth();
  const [synced, setSynced] = useState(false);

  const syncUser = useMutation(api.users.syncCurrentUser);
  const publicToolsRaw = useQuery(api.tools.listPublicAvailable);
  const currentUser = useQuery(api.users.me, isSignedIn ? {} : "skip");

  const authedToolsRaw = useQuery(
    api.tools.listAuthenticated,
    isSignedIn && currentUser ? {} : "skip"
  );
  const myListingsRaw = useQuery(
    api.tools.listMyListings,
    isSignedIn && currentUser ? {} : "skip"
  );
  const myRequestsRaw = useQuery(
    api.loans.listMyRequests,
    isSignedIn && currentUser ? {} : "skip"
  );
  const incomingRaw = useQuery(
    api.loans.listIncomingRequests,
    isSignedIn && currentUser ? {} : "skip"
  );
  const adminLoansRaw = useQuery(
    api.loans.listAllLoansAdmin,
    isSignedIn && currentUser?.role === "admin" ? {} : "skip"
  );
  const adminUsersRaw = useQuery(
    api.users.listUsersForAdmin,
    isSignedIn && currentUser?.role === "admin" ? {} : "skip"
  );

  const createTool = useMutation(api.tools.createTool);
  const updateTool = useMutation(api.tools.updateTool);
  const removeTool = useMutation(api.tools.removeTool);
  const requestBorrow = useMutation(api.loans.requestBorrow);
  const approveLoan = useMutation(api.loans.approveLoan);
  const declineLoan = useMutation(api.loans.declineLoan);
  const markReturned = useMutation(api.loans.markReturned);
  const cancelRequest = useMutation(api.loans.cancelRequest);
  const toggleTrusted = useMutation(api.users.toggleTrustedLender);

  useEffect(() => {
    if (isLoaded && isSignedIn && !synced) {
      void syncUser({}).then(() => setSynced(true));
    }
    if (!isSignedIn && synced) {
      setSynced(false);
    }
  }, [isLoaded, isSignedIn, synced, syncUser]);

  const publicTools: PublicToolProjection[] = (publicToolsRaw ?? []).map(
    (t) => ({
      id: t._id,
      name: t.name,
      category: t.category,
    })
  );

  const actor: Actor | null = currentUser
    ? {
        id: currentUser._id,
        clerkId: "",
        displayName: currentUser.displayName,
        role: currentUser.role,
        isTrustedLender: currentUser.isTrustedLender,
      }
    : null;

  const tools: AuthenticatedToolView[] = (authedToolsRaw ?? []).map((t) => ({
    id: t._id,
    name: t.name,
    category: t.category,
    condition: t.condition,
    shortDescription: t.shortDescription,
    ownerId: t.ownerId,
    ownerDisplayName: t.ownerDisplayName,
    ownerIsTrustedLender: t.ownerIsTrustedLender,
    availabilityStatus: t.availabilityStatus,
    activeLoanEndDate: t.activeLoanEndDate,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));

  const myListings: AuthenticatedToolView[] = (myListingsRaw ?? []).map((t) => ({
    id: t._id,
    name: t.name,
    category: t.category,
    condition: t.condition,
    shortDescription: t.shortDescription,
    ownerId: t.ownerId,
    ownerDisplayName: actor?.displayName ?? "You",
    ownerIsTrustedLender: actor?.isTrustedLender ?? false,
    availabilityStatus: t.availabilityStatus,
    activeLoanEndDate: t.activeLoanEndDate,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));

  const mapLoans = (raw: typeof myRequestsRaw): LoanView[] =>
    (raw ?? []).map((l) => ({
      id: l._id,
      toolId: l.toolId,
      ownerId: l.ownerId,
      borrowerId: l.borrowerId,
      startDate: l.startDate,
      endDate: l.endDate,
      status: l.status,
      note: l.note,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      lastReminderAt: l.lastReminderAt,
      reminderCount: l.reminderCount,
      toolName: l.toolName,
      toolCategory: l.toolCategory,
      ownerDisplayName: l.ownerDisplayName,
      ownerIsTrustedLender: l.ownerIsTrustedLender,
      borrowerDisplayName: l.borrowerDisplayName,
      isOverdue: l.isOverdue,
      daysOverdue: l.daysOverdue,
      automationActivity: l.automationActivity.map((a) => ({
        id: a._id,
        loanId: a.loanId,
        eventType: a.eventType,
        summary: a.summary,
        idempotencyKey: a.idempotencyKey,
        channel: a.channel,
        createdAt: a.createdAt,
      })),
    }));

  const adminUsers: AdminUserSummary[] = (adminUsersRaw ?? []).map((u) => ({
    id: u._id,
    displayName: u.displayName,
    role: u.role,
    isTrustedLender: u.isTrustedLender,
    toolCount: u.toolCount,
    createdAt: u.createdAt,
  }));

  const actions: WorkspaceActions = {
    onCreateTool: async (input: ToolInput) => {
      await createTool(input);
    },
    onUpdateTool: async (toolId: string, input: ToolInput) => {
      await updateTool({ toolId: toolId as Id<"tools">, ...input });
    },
    onDeleteTool: async (toolId: string) => {
      await removeTool({ toolId: toolId as Id<"tools"> });
    },
    onRequestBorrow: async (params) => {
      await requestBorrow({
        toolId: params.toolId as Id<"tools">,
        startDate: params.startDate,
        endDate: params.endDate,
        note: params.note,
      });
    },
    onApproveLoan: async (loanId: string) => {
      await approveLoan({ loanId: loanId as Id<"loans"> });
    },
    onDeclineLoan: async (loanId: string) => {
      await declineLoan({ loanId: loanId as Id<"loans"> });
    },
    onMarkReturned: async (loanId: string) => {
      await markReturned({ loanId: loanId as Id<"loans"> });
    },
    onCancelLoan: async (loanId: string) => {
      await cancelRequest({ loanId: loanId as Id<"loans"> });
    },
    onToggleTrustedLender: async (userId: string, isTrustedLender: boolean) => {
      await toggleTrusted({
        userId: userId as Id<"users">,
        isTrustedLender,
      });
    },
  };

  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <Wrench size={18} />
            </span>
            <div>
              <div className="brand-title">LendLoop</div>
              <div className="brand-tagline">
                Borrow what you need. Lend what you don&apos;t.
              </div>
            </div>
          </div>

          <div className="header-actions">
            <span className="mode-pill">
              <span className="mode-dot live" />
              Clerk + Convex Live
            </span>
            {isSignedIn ? (
              <UserButton />
            ) : (
              <SignInButton mode="modal">
                <button type="button" className="btn btn-primary">
                  <LogIn size={15} aria-hidden="true" />
                  Sign in to lend or borrow
                </button>
              </SignInButton>
            )}
          </div>
        </div>
      </header>

      {isSignedIn && actor ? (
        <AuthenticatedWorkspace
          key={actor.id}
          actor={actor}
          tools={tools}
          myListings={myListings}
          myRequests={mapLoans(myRequestsRaw)}
          incomingRequests={mapLoans(incomingRaw)}
          adminLoans={mapLoans(adminLoansRaw)}
          adminUsers={adminUsers}
          actions={actions}
        />
      ) : (
        <PublicCatalog
          tools={publicTools}
          loading={publicToolsRaw === undefined}
          signInCta={
            <SignInButton mode="modal">
              <button type="button" className="btn btn-primary">
                <LogIn size={16} aria-hidden="true" />
                Sign in to lend or borrow
              </button>
            </SignInButton>
          }
        />
      )}
    </>
  );
}

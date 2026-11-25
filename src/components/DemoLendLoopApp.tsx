"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, LogIn, LogOut, Shield, Users, Wrench, X } from "lucide-react";
import { DEMO_ACTOR_HEADER } from "@/lib/demoAuth";
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

interface DemoStateResponse {
  authenticated: boolean;
  actor: Actor | null;
  personas: Actor[];
  publicTools: PublicToolProjection[];
  tools?: AuthenticatedToolView[];
  myListings?: AuthenticatedToolView[];
  myRequests?: LoanView[];
  incomingRequests?: LoanView[];
  adminLoans?: LoanView[];
  adminUsers?: AdminUserSummary[];
}

const STORAGE_KEY = "lendloop_demo_actor_id";

export function DemoLendLoopApp() {
  const [actorId, setActorId] = useState<string | null>(null);
  const [state, setState] = useState<DemoStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [signInOpen, setSignInOpen] = useState(false);

  const loadState = useCallback(async (selectedActorId: string | null) => {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (selectedActorId) {
        headers[DEMO_ACTOR_HEADER] = selectedActorId;
      }
      const res = await fetch("/api/demo/state", {
        headers,
        cache: "no-store",
      });
      const data = (await res.json()) as DemoStateResponse;
      setState(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem(STORAGE_KEY)
        : null;
    setActorId(saved);
    void loadState(saved);
  }, [loadState]);

  const selectPersona = (id: string | null) => {
    setActorId(id);
    if (typeof window !== "undefined") {
      if (id) {
        window.sessionStorage.setItem(STORAGE_KEY, id);
      } else {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    }
    setSignInOpen(false);
    void loadState(id);
  };

  async function apiRequest<T>(
    url: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (actorId) {
      headers[DEMO_ACTOR_HEADER] = actorId;
    }
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) {
      throw new Error(json.error || `Request failed with HTTP ${res.status}`);
    }
    await loadState(actorId);
    return json;
  }

  const actions: WorkspaceActions = {
    onCreateTool: async (input: ToolInput) => {
      await apiRequest("/api/demo/tools", "POST", input);
    },
    onUpdateTool: async (toolId: string, input: ToolInput) => {
      await apiRequest(`/api/demo/tools/${toolId}`, "PATCH", input);
    },
    onDeleteTool: async (toolId: string) => {
      await apiRequest(`/api/demo/tools/${toolId}`, "DELETE");
    },
    onRequestBorrow: async (params) => {
      await apiRequest("/api/demo/loans", "POST", params);
    },
    onApproveLoan: async (loanId: string) => {
      await apiRequest(`/api/demo/loans/${loanId}`, "PATCH", {
        action: "approve",
      });
    },
    onDeclineLoan: async (loanId: string) => {
      await apiRequest(`/api/demo/loans/${loanId}`, "PATCH", {
        action: "decline",
      });
    },
    onMarkReturned: async (loanId: string) => {
      await apiRequest(`/api/demo/loans/${loanId}`, "PATCH", {
        action: "return",
      });
    },
    onCancelLoan: async (loanId: string) => {
      await apiRequest(`/api/demo/loans/${loanId}`, "PATCH", {
        action: "cancel",
      });
    },
    onToggleTrustedLender: async (userId: string, isTrustedLender: boolean) => {
      await apiRequest("/api/demo/admin/trusted-lender", "POST", {
        userId,
        isTrustedLender,
      });
    },
    onSimulateOverdueAutomation: async () => {
      return await apiRequest<{
        overdueFound: number;
        recorded: number;
        duplicatesSkipped: number;
        idempotencyKeys: string[];
      }>("/api/demo/simulate-overdue-automation", "POST");
    },
  };

  const actor = state?.actor ?? null;

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
            <span
              className="mode-pill"
              title="Running with local demo API & HMAC routes. Configure Clerk + Convex env vars in .env.local to switch to live cloud mode."
            >
              <span className="mode-dot" />
              Local Demo Mode
            </span>

            {actor ? (
              <>
                <span className="badge badge-neutral">
                  {actor.displayName}
                  {actor.role === "admin" && " (Admin)"}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSignInOpen(true)}
                >
                  <Users size={14} aria-hidden="true" />
                  Switch Persona
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => selectPersona(null)}
                >
                  <LogOut size={14} aria-hidden="true" />
                  Sign Out
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setSignInOpen(true)}
              >
                <LogIn size={15} aria-hidden="true" />
                Sign in to lend or borrow
              </button>
            )}
          </div>
        </div>
      </header>

      {actor && state?.authenticated ? (
        <AuthenticatedWorkspace
          key={actor.id}
          actor={actor}
          tools={state.tools ?? []}
          myListings={state.myListings ?? []}
          myRequests={state.myRequests ?? []}
          incomingRequests={state.incomingRequests ?? []}
          adminLoans={state.adminLoans}
          adminUsers={state.adminUsers}
          actions={actions}
        />
      ) : (
        <PublicCatalog
          tools={state?.publicTools ?? []}
          loading={loading}
          signInCta={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setSignInOpen(true)}
            >
              <LogIn size={16} aria-hidden="true" />
              Sign in to lend or borrow
            </button>
          }
        />
      )}

      {signInOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="demo-signin-title"
        >
          <div className="modal-panel">
            <div className="modal-header">
              <h3 id="demo-signin-title">Sign in to LendLoop (Demo Mode)</h3>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSignInOpen(false)}
                aria-label="Close sign-in dialog"
              >
                <X size={15} />
              </button>
            </div>
            <p className="card-desc">
              Choose a local demo account to test regular member RBAC, Trusted
              Lender workflows, or Admin moderation. Set Clerk + Convex env vars
              in <code>.env.local</code> for live Clerk authentication.
            </p>
            <div className="stack">
              {(state?.personas ?? []).map((persona) => (
                <button
                  key={persona.id}
                  type="button"
                  className="persona-option"
                  onClick={() => selectPersona(persona.id)}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{persona.displayName}</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--ink-muted)" }}>
                      {persona.role === "admin"
                        ? "Community Admin — moderation, all loans, Trusted Lender toggles"
                        : persona.isTrustedLender
                          ? "Member — Trusted Lender with active & incoming loans"
                          : "Member — Neighbor with tools and an overdue active loan"}
                    </div>
                  </div>
                  <div className="card-meta">
                    {persona.role === "admin" && (
                      <span className="badge badge-admin">
                        <Shield size={11} />
                        Admin
                      </span>
                    )}
                    {persona.isTrustedLender && (
                      <span className="badge badge-trusted">
                        <BadgeCheck size={11} />
                        Trusted
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import {
  BadgeCheck,
  Calendar,
  Check,
  Clock,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  LOAN_STATUS_LABELS,
  TOOL_CATEGORIES,
  TOOL_CONDITIONS,
  todayIsoUtc,
} from "@/lib/domain";
import type {
  Actor,
  AdminUserSummary,
  AuthenticatedToolView,
  LoanView,
  ToolCategory,
  ToolCondition,
  ToolInput,
} from "@/lib/types";
import { ActivityFeed } from "./ActivityFeed";

export interface WorkspaceActions {
  onCreateTool: (input: ToolInput) => Promise<void>;
  onUpdateTool: (toolId: string, input: ToolInput) => Promise<void>;
  onDeleteTool: (toolId: string) => Promise<void>;
  onRequestBorrow: (params: {
    toolId: string;
    startDate: string;
    endDate: string;
    note?: string;
  }) => Promise<void>;
  onApproveLoan: (loanId: string) => Promise<void>;
  onDeclineLoan: (loanId: string) => Promise<void>;
  onMarkReturned: (loanId: string) => Promise<void>;
  onCancelLoan: (loanId: string) => Promise<void>;
  onToggleTrustedLender?: (
    userId: string,
    isTrustedLender: boolean
  ) => Promise<void>;
  onSimulateOverdueAutomation?: () => Promise<{
    overdueFound: number;
    recorded: number;
    duplicatesSkipped: number;
    idempotencyKeys: string[];
  }>;
}

interface AuthenticatedWorkspaceProps {
  actor: Actor;
  tools: AuthenticatedToolView[];
  myListings: AuthenticatedToolView[];
  myRequests: LoanView[];
  incomingRequests: LoanView[];
  adminLoans?: LoanView[];
  adminUsers?: AdminUserSummary[];
  actions: WorkspaceActions;
}

type TabKey = "browse" | "listings" | "requests" | "incoming" | "admin";

function defaultDates(): { startDate: string; endDate: string } {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 3);
  return {
    startDate: todayIsoUtc(start),
    endDate: todayIsoUtc(end),
  };
}

export function AuthenticatedWorkspace({
  actor,
  tools,
  myListings,
  myRequests,
  incomingRequests,
  adminLoans = [],
  adminUsers = [],
  actions,
}: AuthenticatedWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("browse");
  const [categoryFilter, setCategoryFilter] = useState<ToolCategory | "all">(
    "all"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Borrow modal state
  const [borrowingTool, setBorrowingTool] =
    useState<AuthenticatedToolView | null>(null);
  const initialDates = useMemo(() => defaultDates(), []);
  const [borrowStart, setBorrowStart] = useState(initialDates.startDate);
  const [borrowEnd, setBorrowEnd] = useState(initialDates.endDate);
  const [borrowNote, setBorrowNote] = useState("");

  // Create / Edit tool form state
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [toolName, setToolName] = useState("");
  const [toolCategory, setToolCategory] = useState<ToolCategory>("power_tools");
  const [toolCondition, setToolCondition] = useState<ToolCondition>("good");
  const [toolDescription, setToolDescription] = useState("");

  const filteredTools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tools.filter((tool) => {
      if (categoryFilter !== "all" && tool.category !== categoryFilter) {
        return false;
      }
      if (
        q &&
        !tool.name.toLowerCase().includes(q) &&
        !tool.shortDescription.toLowerCase().includes(q) &&
        !tool.ownerDisplayName.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [tools, categoryFilter, searchQuery]);

  const pendingIncomingCount = useMemo(
    () => incomingRequests.filter((l) => l.status === "pending").length,
    [incomingRequests]
  );

  async function runAction(
    key: string,
    fn: () => Promise<void>,
    successText: string
  ) {
    setBusyKey(key);
    setStatusMessage(null);
    try {
      await fn();
      setStatusMessage({ type: "success", text: successText });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Operation could not be completed.";
      setStatusMessage({ type: "error", text: msg });
    } finally {
      setBusyKey(null);
    }
  }

  function resetToolForm() {
    setEditingToolId(null);
    setToolName("");
    setToolCategory("power_tools");
    setToolCondition("good");
    setToolDescription("");
  }

  function startEditTool(tool: AuthenticatedToolView) {
    setEditingToolId(tool.id);
    setToolName(tool.name);
    setToolCategory(tool.category);
    setToolCondition(tool.condition);
    setToolDescription(tool.shortDescription);
    setActiveTab("listings");
  }

  async function handleToolSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: ToolInput = {
      name: toolName,
      category: toolCategory,
      condition: toolCondition,
      shortDescription: toolDescription,
    };

    if (editingToolId) {
      await runAction(
        "save-tool",
        async () => {
          await actions.onUpdateTool(editingToolId, payload);
          resetToolForm();
        },
        "Tool listing updated."
      );
    } else {
      await runAction(
        "save-tool",
        async () => {
          await actions.onCreateTool(payload);
          resetToolForm();
        },
        "Tool listed in neighborhood catalog."
      );
    }
  }

  async function handleBorrowSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!borrowingTool) return;
    await runAction(
      "borrow-submit",
      async () => {
        await actions.onRequestBorrow({
          toolId: borrowingTool.id,
          startDate: borrowStart,
          endDate: borrowEnd,
          note: borrowNote || undefined,
        });
        setBorrowingTool(null);
        setBorrowNote("");
        setActiveTab("requests");
      },
      `Borrow request sent for "${borrowingTool.name}".`
    );
  }

  function renderLoanStatusBadge(loan: LoanView) {
    if (loan.isOverdue) {
      return (
        <span className="badge badge-danger">
          Overdue ({loan.daysOverdue}d)
        </span>
      );
    }
    const cls =
      loan.status === "approved"
        ? "badge-available"
        : loan.status === "pending"
          ? "badge-onloan"
          : loan.status === "returned"
            ? "badge-info"
            : "badge-neutral";
    return <span className={`badge ${cls}`}>{LOAN_STATUS_LABELS[loan.status]}</span>;
  }

  return (
    <main className="container section">
      <nav className="tabs" aria-label="Workspace views">
        <button
          type="button"
          className={`tab-btn ${activeTab === "browse" ? "active" : ""}`}
          onClick={() => setActiveTab("browse")}
        >
          All Tools <span className="tab-count">{tools.length}</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "listings" ? "active" : ""}`}
          onClick={() => setActiveTab("listings")}
        >
          My Listings <span className="tab-count">{myListings.length}</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "requests" ? "active" : ""}`}
          onClick={() => setActiveTab("requests")}
        >
          My Requests <span className="tab-count">{myRequests.length}</span>
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === "incoming" ? "active" : ""}`}
          onClick={() => setActiveTab("incoming")}
        >
          Incoming Requests
          <span className="tab-count">
            {pendingIncomingCount > 0
              ? `${pendingIncomingCount} pending`
              : incomingRequests.length}
          </span>
        </button>
        {actor.role === "admin" && (
          <button
            type="button"
            className={`tab-btn ${activeTab === "admin" ? "active" : ""}`}
            onClick={() => setActiveTab("admin")}
          >
            <Shield size={14} aria-hidden="true" />
            Admin Panel
          </button>
        )}
      </nav>

      {statusMessage && (
        <div
          className={`banner ${
            statusMessage.type === "error"
              ? "banner-error"
              : statusMessage.type === "info"
                ? "banner-info"
                : "banner-success"
          }`}
          role="status"
        >
          <span>{statusMessage.text}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setStatusMessage(null)}
            aria-label="Dismiss notice"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* TAB 1: ALL TOOLS */}
      {activeTab === "browse" && (
        <section>
          <div className="filter-bar">
            <div className="chip-row" role="group" aria-label="Filter by category">
              <button
                type="button"
                className={`chip ${categoryFilter === "all" ? "active" : ""}`}
                onClick={() => setCategoryFilter("all")}
              >
                All Categories
              </button>
              {TOOL_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`chip ${categoryFilter === cat ? "active" : ""}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>

            <div style={{ minWidth: "240px" }}>
              <input
                type="search"
                className="input"
                placeholder="Search tools or lender…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search tools"
              />
            </div>
          </div>

          {filteredTools.length === 0 ? (
            <div className="empty-state">
              No tools match your current filter.
            </div>
          ) : (
            <div className="grid-cards">
              {filteredTools.map((tool) => {
                const isOwn = tool.ownerId === actor.id;
                return (
                  <article key={tool.id} className="card">
                    <div className="card-meta">
                      <span
                        className={`badge ${
                          tool.availabilityStatus === "available"
                            ? "badge-available"
                            : "badge-onloan"
                        }`}
                      >
                        {tool.availabilityStatus === "available"
                          ? "Available"
                          : `On Loan until ${tool.activeLoanEndDate}`}
                      </span>
                      <span className="badge badge-neutral">
                        {CATEGORY_LABELS[tool.category]}
                      </span>
                      <span className="badge badge-neutral">
                        {CONDITION_LABELS[tool.condition]}
                      </span>
                    </div>

                    <h3 className="card-title">{tool.name}</h3>
                    <p className="card-desc">{tool.shortDescription}</p>

                    <div className="card-footer">
                      <div className="card-meta">
                        <span style={{ fontSize: "0.82rem", fontWeight: 600 }}>
                          {isOwn ? "Listed by you" : `Lender: ${tool.ownerDisplayName}`}
                        </span>
                        {tool.ownerIsTrustedLender && (
                          <span className="badge badge-trusted">
                            <BadgeCheck size={13} aria-hidden="true" />
                            Trusted Lender
                          </span>
                        )}
                      </div>

                      {!isOwn && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => setBorrowingTool(tool)}
                        >
                          <Calendar size={14} aria-hidden="true" />
                          Request Borrow
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: MY LISTINGS */}
      {activeTab === "listings" && (
        <section className="stack">
          <div className="card">
            <div className="section-header" style={{ marginBottom: 4 }}>
              <div>
                <h2>{editingToolId ? "Edit Tool Listing" : "List a New Tool"}</h2>
                <p className="section-sub">
                  Share an idle tool with your neighborhood. Only name and
                  category appear publicly before sign-in.
                </p>
              </div>
              {editingToolId && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={resetToolForm}
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <form className="form-grid" onSubmit={handleToolSubmit}>
              <div className="field full">
                <label htmlFor="tool-name">Tool Name</label>
                <input
                  id="tool-name"
                  className="input"
                  required
                  minLength={2}
                  maxLength={100}
                  placeholder="e.g., Makita Circular Saw 7-1/4 inch"
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="tool-category">Category</label>
                <select
                  id="tool-category"
                  className="select"
                  value={toolCategory}
                  onChange={(e) =>
                    setToolCategory(e.target.value as ToolCategory)
                  }
                >
                  {TOOL_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="tool-condition">Condition</label>
                <select
                  id="tool-condition"
                  className="select"
                  value={toolCondition}
                  onChange={(e) =>
                    setToolCondition(e.target.value as ToolCondition)
                  }
                >
                  {TOOL_CONDITIONS.map((cond) => (
                    <option key={cond} value={cond}>
                      {CONDITION_LABELS[cond]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field full">
                <label htmlFor="tool-desc">Short Description</label>
                <textarea
                  id="tool-desc"
                  className="textarea"
                  rows={3}
                  required
                  minLength={5}
                  maxLength={400}
                  placeholder="Include included accessories, battery/fuel notes, or pickup tips."
                  value={toolDescription}
                  onChange={(e) => setToolDescription(e.target.value)}
                />
              </div>

              <div className="field full">
                <div>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={busyKey === "save-tool"}
                  >
                    <Plus size={15} aria-hidden="true" />
                    {editingToolId ? "Save Changes" : "Publish Tool Listing"}
                  </button>
                </div>
              </div>
            </form>
          </div>

          <div className="section-header" style={{ marginTop: 10 }}>
            <h2>Your Listed Tools ({myListings.length})</h2>
          </div>

          {myListings.length === 0 ? (
            <div className="empty-state">
              You haven&apos;t listed any tools yet. Add your first tool above!
            </div>
          ) : (
            <div className="grid-cards">
              {myListings.map((tool) => (
                <article key={tool.id} className="card">
                  <div className="card-meta">
                    <span
                      className={`badge ${
                        tool.availabilityStatus === "available"
                          ? "badge-available"
                          : "badge-onloan"
                      }`}
                    >
                      {tool.availabilityStatus === "available"
                        ? "Available"
                        : `On Loan until ${tool.activeLoanEndDate}`}
                    </span>
                    <span className="badge badge-neutral">
                      {CATEGORY_LABELS[tool.category]}
                    </span>
                    <span className="badge badge-neutral">
                      {CONDITION_LABELS[tool.condition]}
                    </span>
                  </div>
                  <h3 className="card-title">{tool.name}</h3>
                  <p className="card-desc">{tool.shortDescription}</p>
                  <div className="card-footer">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => startEditTool(tool)}
                    >
                      <Pencil size={13} aria-hidden="true" />
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={busyKey === `del-${tool.id}`}
                      onClick={() =>
                        runAction(
                          `del-${tool.id}`,
                          () => actions.onDeleteTool(tool.id),
                          `Removed "${tool.name}".`
                        )
                      }
                    >
                      <Trash2 size={13} aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: MY REQUESTS */}
      {activeTab === "requests" && (
        <section className="stack">
          <div className="section-header">
            <div>
              <h2>My Borrow Requests</h2>
              <p className="section-sub">
                Track approval status, return dates, and automated n8n reminder
                history.
              </p>
            </div>
          </div>

          {myRequests.length === 0 ? (
            <div className="empty-state">
              No borrow requests yet. Browse available tools to request one!
            </div>
          ) : (
            myRequests.map((loan) => (
              <article key={loan.id} className="loan-card">
                <div className="loan-top">
                  <div>
                    <div className="card-meta" style={{ marginBottom: 6 }}>
                      {renderLoanStatusBadge(loan)}
                      <span className="badge badge-neutral">
                        {CATEGORY_LABELS[loan.toolCategory]}
                      </span>
                      {loan.ownerIsTrustedLender && (
                        <span className="badge badge-trusted">
                          <BadgeCheck size={12} aria-hidden="true" />
                          Trusted Lender
                        </span>
                      )}
                    </div>
                    <h3 className="card-title">{loan.toolName}</h3>
                    <p className="card-desc">
                      Lender: <strong>{loan.ownerDisplayName}</strong> •{" "}
                      <Clock size={12} style={{ verticalAlign: "-1px" }} />{" "}
                      {loan.startDate} → {loan.endDate}
                    </p>
                    {loan.note && (
                      <p className="card-desc" style={{ marginTop: 4 }}>
                        Note: &ldquo;{loan.note}&rdquo;
                      </p>
                    )}
                  </div>

                  {loan.status === "pending" && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyKey === `cancel-${loan.id}`}
                      onClick={() =>
                        runAction(
                          `cancel-${loan.id}`,
                          () => actions.onCancelLoan(loan.id),
                          "Borrow request cancelled."
                        )
                      }
                    >
                      Cancel Request
                    </button>
                  )}
                </div>

                <ActivityFeed items={loan.automationActivity} />
              </article>
            ))
          )}
        </section>
      )}

      {/* TAB 4: INCOMING REQUESTS */}
      {activeTab === "incoming" && (
        <section className="stack">
          <div className="section-header">
            <div>
              <h2>Incoming Requests on Your Tools</h2>
              <p className="section-sub">
                Approve or decline neighbor requests, and mark active loans
                returned when handoff completes.
              </p>
            </div>
          </div>

          {incomingRequests.length === 0 ? (
            <div className="empty-state">
              No incoming borrow requests on your tools yet.
            </div>
          ) : (
            incomingRequests.map((loan) => (
              <article key={loan.id} className="loan-card">
                <div className="loan-top">
                  <div>
                    <div className="card-meta" style={{ marginBottom: 6 }}>
                      {renderLoanStatusBadge(loan)}
                      <span className="badge badge-neutral">
                        {CATEGORY_LABELS[loan.toolCategory]}
                      </span>
                    </div>
                    <h3 className="card-title">{loan.toolName}</h3>
                    <p className="card-desc">
                      Borrower: <strong>{loan.borrowerDisplayName}</strong> •{" "}
                      {loan.startDate} → {loan.endDate}
                    </p>
                    {loan.note && (
                      <p className="card-desc" style={{ marginTop: 4 }}>
                        Note: &ldquo;{loan.note}&rdquo;
                      </p>
                    )}
                  </div>

                  <div className="header-actions">
                    {loan.status === "pending" && (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busyKey === `approve-${loan.id}`}
                          onClick={() =>
                            runAction(
                              `approve-${loan.id}`,
                              () => actions.onApproveLoan(loan.id),
                              `Approved loan for ${loan.borrowerDisplayName}.`
                            )
                          }
                        >
                          <Check size={14} aria-hidden="true" />
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={busyKey === `decline-${loan.id}`}
                          onClick={() =>
                            runAction(
                              `decline-${loan.id}`,
                              () => actions.onDeclineLoan(loan.id),
                              "Borrow request declined."
                            )
                          }
                        >
                          <X size={14} aria-hidden="true" />
                          Decline
                        </button>
                      </>
                    )}
                    {loan.status === "approved" && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busyKey === `return-${loan.id}`}
                        onClick={() =>
                          runAction(
                            `return-${loan.id}`,
                            () => actions.onMarkReturned(loan.id),
                            `Marked "${loan.toolName}" as returned.`
                          )
                        }
                      >
                        <Check size={14} aria-hidden="true" />
                        Mark Returned
                      </button>
                    )}
                  </div>
                </div>

                <ActivityFeed items={loan.automationActivity} />
              </article>
            ))
          )}
        </section>
      )}

      {/* TAB 5: ADMIN PANEL */}
      {activeTab === "admin" && actor.role === "admin" && (
        <section className="stack">
          {actions.onSimulateOverdueAutomation && (
            <div className="card">
              <div className="loan-top">
                <div>
                  <h3 className="card-title">
                    n8n HMAC Overdue Reminder &amp; Idempotency Check
                  </h3>
                  <p className="card-desc">
                    Executes the exact signed HMAC-SHA256 query + deterministic
                    idempotency write-back (
                    <code>overdue:&#123;loanId&#125;:&#123;YYYY-MM-DD&#125;</code>
                    ). Run twice to verify zero duplicate reminders!
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busyKey === "sim-overdue"}
                  onClick={async () => {
                    setBusyKey("sim-overdue");
                    setStatusMessage(null);
                    try {
                      const res = await actions.onSimulateOverdueAutomation!();
                      setStatusMessage({
                        type: "info",
                        text: `HMAC verified! Overdue loans found: ${res.overdueFound} | Newly recorded: ${res.recorded} | Duplicates safely skipped: ${res.duplicatesSkipped}.`,
                      });
                    } catch (err) {
                      setStatusMessage({
                        type: "error",
                        text:
                          err instanceof Error
                            ? err.message
                            : "Automation simulation failed.",
                      });
                    } finally {
                      setBusyKey(null);
                    }
                  }}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  Run Signed Overdue Check
                </button>
              </div>
            </div>
          )}

          <div>
            <div className="section-header">
              <h2>Trusted Lender Management</h2>
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Listings</th>
                  <th>Trusted Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {adminUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.displayName}</strong>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          u.role === "admin" ? "badge-admin" : "badge-neutral"
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td>{u.toolCount}</td>
                    <td>
                      {u.isTrustedLender ? (
                        <span className="badge badge-trusted">
                          <BadgeCheck size={12} aria-hidden="true" />
                          Trusted Lender
                        </span>
                      ) : (
                        <span className="badge badge-neutral">Standard</span>
                      )}
                    </td>
                    <td>
                      {actions.onToggleTrustedLender && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busyKey === `trust-${u.id}`}
                          onClick={() =>
                            runAction(
                              `trust-${u.id}`,
                              () =>
                                actions.onToggleTrustedLender!(
                                  u.id,
                                  !u.isTrustedLender
                                ),
                              `${u.displayName} is ${
                                !u.isTrustedLender ? "now" : "no longer"
                              } a Trusted Lender.`
                            )
                          }
                        >
                          {u.isTrustedLender ? "Revoke Badge" : "Grant Trusted"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="section-header" style={{ marginTop: 12 }}>
              <h2>Listing Moderation ({tools.length})</h2>
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Category</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((tool) => (
                  <tr key={tool.id}>
                    <td>
                      <strong>{tool.name}</strong>
                    </td>
                    <td>{CATEGORY_LABELS[tool.category]}</td>
                    <td>{tool.ownerDisplayName}</td>
                    <td>
                      <span
                        className={`badge ${
                          tool.availabilityStatus === "available"
                            ? "badge-available"
                            : "badge-onloan"
                        }`}
                      >
                        {tool.availabilityStatus === "available"
                          ? "Available"
                          : "On Loan"}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={busyKey === `admin-del-${tool.id}`}
                        onClick={() =>
                          runAction(
                            `admin-del-${tool.id}`,
                            () => actions.onDeleteTool(tool.id),
                            `Admin removed "${tool.name}".`
                          )
                        }
                      >
                        <Trash2 size={13} aria-hidden="true" />
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <div className="section-header" style={{ marginTop: 12 }}>
              <h2>All Community Loans ({adminLoans.length})</h2>
            </div>
            <div className="stack">
              {adminLoans.map((loan) => (
                <article key={loan.id} className="loan-card">
                  <div className="loan-top">
                    <div>
                      <div className="card-meta" style={{ marginBottom: 6 }}>
                        {renderLoanStatusBadge(loan)}
                        <span className="badge badge-neutral">
                          Reminders sent: {loan.reminderCount}
                        </span>
                      </div>
                      <h3 className="card-title">{loan.toolName}</h3>
                      <p className="card-desc">
                        <strong>{loan.borrowerDisplayName}</strong> borrowing from{" "}
                        <strong>{loan.ownerDisplayName}</strong> •{" "}
                        {loan.startDate} → {loan.endDate}
                      </p>
                    </div>
                  </div>
                  <ActivityFeed items={loan.automationActivity} />
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* BORROW REQUEST MODAL */}
      {borrowingTool && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="borrow-modal-title"
        >
          <div className="modal-panel">
            <div className="modal-header">
              <h3 id="borrow-modal-title">Request to Borrow</h3>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setBorrowingTool(null)}
                aria-label="Close modal"
              >
                <X size={15} />
              </button>
            </div>
            <p className="card-desc">
              <strong>{borrowingTool.name}</strong> from{" "}
              {borrowingTool.ownerDisplayName}
            </p>
            <form className="form-grid" onSubmit={handleBorrowSubmit}>
              <div className="field">
                <label htmlFor="borrow-start">Start Date</label>
                <input
                  id="borrow-start"
                  type="date"
                  className="input"
                  required
                  value={borrowStart}
                  onChange={(e) => setBorrowStart(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="borrow-end">Return Date</label>
                <input
                  id="borrow-end"
                  type="date"
                  className="input"
                  required
                  value={borrowEnd}
                  onChange={(e) => setBorrowEnd(e.target.value)}
                />
              </div>
              <div className="field full">
                <label htmlFor="borrow-note">Pickup Note (optional)</label>
                <textarea
                  id="borrow-note"
                  className="textarea"
                  rows={2}
                  maxLength={280}
                  placeholder="Share a quick note about your project or preferred pickup window."
                  value={borrowNote}
                  onChange={(e) => setBorrowNote(e.target.value)}
                />
              </div>
              <div className="field full">
                <div className="header-actions" style={{ justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setBorrowingTool(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={busyKey === "borrow-submit"}
                  >
                    Send Borrow Request
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

# ARCHITECTURE — LendLoop

Neighborhood Tool Lending Library built with **Next.js (App Router) + TypeScript + Clerk + Convex + self-hosted n8n (Docker) + Vitest**.

## Core Invariants
1. **Query-Layer Data Minimization:** Unauthenticated public endpoints (`convex/tools.ts:listPublicAvailable` and `/api/demo/public-tools`) project strictly `{ id, name, category }` for available tools only — zero owner IDs, names, emails, descriptions, or schedules leave the backend.
2. **Server-Side RBAC & Ownership:** Every mutation enforces authentication, role (`user` vs `admin`), and record ownership inside Convex functions (`convex/security.ts`, `convex/tools.ts`, `convex/loans.ts`, `convex/users.ts`) and shared authorization guards (`src/lib/authz.ts`), never UI-only.
3. **Bidirectional HMAC-SHA256 & Idempotent Automation:** Outbound Convex -> n8n webhooks and inbound n8n -> Convex HTTP Actions (`convex/http.ts` & `/api/automation/*`) sign `${timestamp}.${rawBody}` with `LENDLOOP_HMAC_SECRET`, enforce a 300s replay window + constant-time verification, and deduplicate reminders via `overdue:{loanId}:{YYYY-MM-DD}`.
4. **Zero-Secret Exports & Dual Runtime:** Exported `n8n/workflows/*.json` reference `$env.*` only (audited by Vitest). The app connects to live Clerk + Convex when env vars are set and falls back cleanly to Local Demo Mode otherwise.

## Directory Boundaries
```text
lendloop/
├── convex/                        # Real Convex backend (schema, RBAC, HTTP Actions)
│   ├── schema.ts                  # users, tools, loans, automationLogs tables + indexes
│   ├── auth.config.ts             # Clerk JWT issuer configuration
│   ├── security.ts                # Server authz helpers + Web Crypto HMAC-SHA256
│   ├── users.ts                   # Clerk identity sync + admin Trusted Lender toggles
│   ├── tools.ts                   # Minimized public query + owner/admin CRUD
│   ├── loans.ts                   # Borrow workflow, overlap checks, internal idempotent logs
│   ├── automation.ts              # Outbound HMAC-signed n8n request notification action
│   └── http.ts                    # Inbound HMAC-verified HTTP endpoints for n8n
├── n8n/workflows/                 # Importable n8n JSONs (zero hardcoded secrets)
│   ├── request-notification.json  # Webhook -> HMAC verify -> minimal fields -> notify + write-back
│   ├── overdue-reminders.json     # Daily cron -> signed GET -> notify -> idempotent write-back
│   └── error-handler.json         # Error Trigger -> PII/secret redaction -> ops alert
├── src/
│   ├── middleware.ts              # Real Clerk clerkMiddleware() with safe local fallback
│   ├── lib/                       # Pure shared domain, RBAC, Web Crypto HMAC, demo store
│   ├── app/api/automation/        # Local mirror of Convex HMAC automation endpoints
│   ├── app/api/demo/              # Local demo API routes using shared RBAC & store
│   └── components/                # PublicCatalog, AuthenticatedWorkspace, Cloud & Demo shells
└── tests/                         # Vitest unit, security, RBAC, HMAC, and n8n audit tests
```

## Execution DAG
```text
Browser -> Next.js App Router -> [Clerk + Convex Live OR Local Demo API]
                                        |
              (Loan Created / Status Changed)  |  (HMAC-SHA256 signed POST, minimal payload)
                                        v
                              n8n: request-notification.json ---> Notification Sink
                                        | (HMAC write-back)
                                        v
                            convex/http.ts -> automationLogs (displayed on each loan)

n8n: overdue-reminders.json (Daily Cron) --HMAC GET--> /api/automation/overdue-loans
         |                                                         |
         +---(per overdue loan)---> Notification Sink              |
         +---HMAC POST (overdue:{loanId}:{YYYY-MM-DD})------------> /api/automation/reminder-logged

Any n8n failure ---> n8n: error-handler.json (sanitized) ---> ALERT_WEBHOOK_URL
```

<!-- AUTO-KG-STATS:START -->
- **Knowledge Graph Live Sync:** `2026-11-25 16:05 UTC` | Nodes: **63** | Edges: **47** | Layers: **5** | Languages: `javascript, markdown, typescript`
- **Top Connected Hubs:** `convex/auth.config.ts` (1), `convex/automation.ts` (1), `convex/http.ts` (1), `convex/loans.ts` (1), `convex/schema.ts` (1)
<!-- AUTO-KG-STATS:END -->

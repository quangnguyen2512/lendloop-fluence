# LendLoop — Neighborhood Tool Lending Library

> **"Borrow what you need. Lend what you don't."**

**LendLoop** is a privacy-first neighborhood tool-sharing application built with **Next.js (App Router)**, **TypeScript**, **Clerk**, **Convex**, **self-hosted n8n (Docker)**, and **Vitest**.

It demonstrates server-enforced RBAC, query-layer data minimization, bidirectional HMAC-SHA256 automation security with replay protection, deterministic daily idempotency, observable error handling, and loan-level automation activity timelines.

---

## Architecture Overview

```text
+-----------------------------------------------------------------------------+
|                        Next.js 15 App Router (TypeScript)                   |
|   - Public Catalog (read-only: name + category ONLY, zero owner PII)        |
|   - Authenticated Workspace (Browse, My Listings, My Requests, Incoming)    |
|   - Admin Panel (All Loans, Moderation, Trusted Lender Badges)              |
|   - Loan Automation Activity Feed ("Reminder sent 2 days ago", etc.)        |
+----------------------------+-------------------------------+----------------+
                             |                               |
          [Live Cloud Mode]  |                               | [Local Demo Mode]
     Clerk JWT + Convex RPC  |                               | /api/demo/* + /api/automation/*
                             v                               v
+----------------------------------------+      +-----------------------------+
|        Convex Cloud Backend            |      |   Shared Core Modules       |
|  - convex/schema.ts (4 indexed tables) |      |  - src/lib/authz.ts (RBAC)  |
|  - convex/tools.ts (minimized public)  |      |  - src/lib/domain.ts        |
|  - convex/loans.ts (overlap + RBAC)    |      |  - src/lib/hmac.ts (WebCryp)|
|  - convex/users.ts (Trusted Lender)    |      |  - src/lib/demoStore.ts     |
|  - convex/http.ts  (HMAC HTTP Actions) |      +--------------+--------------+
+-------------------+--------------------+                     |
                    |                                          |
                    +------------------+-----------------------+
                                       |
               Bidirectional HMAC-SHA256 (`X-LendLoop-Timestamp` +
               `X-LendLoop-Signature: v1=<hex>`, 300s replay window)
                                       |
                                       v
+-----------------------------------------------------------------------------+
|                    Self-Hosted n8n (Docker Compose)                         |
|  1. request-notification.json  Webhook -> Verify HMAC -> Whitelist minimal  |
|                                fields -> Notify -> Idempotent write-back    |
|  2. overdue-reminders.json     Daily Cron -> Signed GET overdue loans ->    |
|                                Notify -> Idempotent POST (`overdue:id:day`) |
|  3. error-handler.json         Error Trigger -> Sanitize PII/secrets -> Ops |
+-----------------------------------------------------------------------------+
```

---

## Key Features Implemented

- **Public Catalog (Data Minimization Enforced at Query Layer):**
  - Displays read-only available tools with **strictly `name` and `category`**.
  - Enforced inside `convex/tools.ts:listPublicAvailable` and `src/lib/domain.ts:projectPublicTool` (not merely hidden in the UI). Unauthenticated callers never receive owner IDs, emails, descriptions, or active loan dates.
- **Authenticated Member Workflows:**
  - List tools (`name`, `category`, `condition`, `shortDescription`), edit/delete own listings.
  - Browse all tools with category filters, search, availability status, and **Trusted Lender** badges.
  - Request borrow date ranges (`startDate`, `endDate`) with server-side calendar validation, self-borrow prevention, and inclusive overlap checks (re-validated atomically on approval).
  - Approve/decline incoming borrow requests, mark active loans returned, and cancel own pending requests.
- **Server-Side Role-Based Access Control (RBAC):**
  - **`user`**: Can create/edit/delete only own listings; approve/decline/return only requests on own tools; cancel/view only own borrow requests.
  - **`admin`**: Can remove any listing (unless an approved loan is currently active), view all community loans, and toggle `"Trusted Lender"` badges on any member.
  - Admin role is derived exclusively from verified server-side JWT claims / identity records — never from client arguments.
- **Loan Automation Activity Timeline (Bonus):**
  - Every loan displays recent automation events (e.g., `"Notification delivered to Maya Chen • 5 hours ago"`, `"Reminder sent (1d overdue) • 2 days ago"`) backed by the indexed `automationLogs` table.
- **n8n Automation Workflows (`n8n/workflows/`):**
  - `request-notification.json`, `overdue-reminders.json`, and `error-handler.json` — valid, importable JSON workflows with **zero hardcoded secrets**, `retryOnFail: true` on all HTTP calls, `saveDataSuccessExecution: "none"`, and error workflow linkage.

---

## Quick Start

### Option A: Local Demo Mode (Zero External Accounts Needed — ~60 seconds)

Run the full app immediately with seeded realistic data, full server-side RBAC, live HMAC-SHA256 verification endpoints, and a demo persona switcher (`Maya Chen`, `Marcus Vance`, `Dr. Elena Rostova [Admin]`):

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

Open [http://localhost:3000](http://localhost:3000):
1. Verify the public landing page shows **only available tool names and categories** (inspect Network `/api/demo/public-tools`).
2. Click **"Sign in to lend or borrow"** to test as a regular member or Community Admin.
3. As Admin (`Dr. Elena Rostova`), open **Admin Panel** and click **"Run Signed Overdue Check"** twice in a row to watch live HMAC-SHA256 signing + deterministic idempotency record `1` new reminder on run #1 and `duplicatesSkipped: 1` on run #2.

### Option B: Full Cloud Stack (Clerk + Convex + Self-Hosted Docker n8n)

1. **Copy environment template:**
   ```bash
   cp .env.example .env.local
   cp .env.example .env
   ```
   Generate strong secrets:
   ```bash
   openssl rand -hex 32   # Use for LENDLOOP_HMAC_SECRET
   openssl rand -hex 32   # Use for N8N_ENCRYPTION_KEY
   ```

2. **Configure Clerk:**
   - Create a Clerk application and JWT Template named **`convex`** (include a custom claim `"role": "{{user.public_metadata.role}}"` so admins can be promoted via Clerk `publicMetadata: { "role": "admin" }`).
   - Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_JWT_ISSUER_DOMAIN` to `.env.local`.

3. **Configure Convex:**
   ```bash
   npx convex dev
   ```
   Set Convex server environment variables:
   ```bash
   npx convex env set CLERK_JWT_ISSUER_DOMAIN "https://your-app.clerk.accounts.dev"
   npx convex env set LENDLOOP_HMAC_SECRET "<same-32-byte-hex-secret>"
   npx convex env set N8N_REQUEST_WEBHOOK_URL "http://localhost:5678/webhook/lendloop-loan-events"
   ```
   Add `NEXT_PUBLIC_CONVEX_URL` and `CONVEX_SITE_URL` (`https://<your-deployment>.convex.site`) to `.env.local` and `.env`.

4. **Start Self-Hosted n8n via Docker Compose:**
   ```bash
   docker compose up -d
   ```
   Open [http://localhost:5678](http://localhost:5678) and import the 3 workflows mounted at `./n8n/workflows/`:
   1. `error-handler.json` (import first, verify workflow ID/selection)
   2. `request-notification.json` (link Error Workflow -> `LendLoop — Automation Error Handler`, activate)
   3. `overdue-reminders.json` (link Error Workflow -> `LendLoop — Automation Error Handler`, activate)

5. **Run Next.js:**
   ```bash
   npm run dev
   ```
   Once `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `NEXT_PUBLIC_CONVEX_URL` are present, the header badge automatically switches to **Clerk + Convex Live** and mounts `<ClerkProvider>`, `<SignInButton>`, `<UserButton>`, and `<ConvexProviderWithClerk>`.

---

## Environment Variables Reference

| Variable | Where Used | Required In | Purpose |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next.js | Cloud Mode | Clerk publishable key |
| `CLERK_SECRET_KEY` | Next.js Middleware | Cloud Mode | Server-side Clerk verification |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex `auth.config.ts` | Cloud Mode | Clerk JWT issuer URL |
| `NEXT_PUBLIC_CONVEX_URL` | Next.js Client | Cloud Mode | Convex deployment RPC URL |
| `CONVEX_SITE_URL` | n8n | Cloud / Local | Base URL for `/api/automation/*` (`*.convex.site` or `http://host.docker.internal:3000`) |
| `LENDLOOP_HMAC_SECRET` | Convex, Next.js, n8n | Cloud / n8n | Shared 256-bit HMAC-SHA256 signing secret |
| `N8N_REQUEST_WEBHOOK_URL` | Convex Action | Cloud Mode | n8n webhook URL for borrow request creation & status changes |
| `NOTIFICATION_SINK_URL` | n8n | n8n | Outbound notification delivery webhook |
| `ALERT_WEBHOOK_URL` | n8n Error Workflow | n8n | Ops alert sink for failed automation runs |
| `N8N_ENCRYPTION_KEY` | Docker n8n | n8n | Encrypts n8n credentials at rest |

---

## Security & Architecture Decisions

### 1. RBAC Enforcement Matrix (Server-Side Only)

| Action | Unauthenticated | `user` (Owner) | `user` (Other) | `admin` |
| :--- | :---: | :---: | :---: | :---: |
| View available tools (`name`, `category` only) | Allowed | Allowed | Allowed | Allowed |
| View full tool details / create listing | `401` | Allowed | Allowed | Allowed |
| Edit tool listing | `401` | Allowed | `403 FORBIDDEN` | `403 FORBIDDEN` |
| Delete tool listing | `401` | Allowed* | `403 FORBIDDEN` | Allowed* |
| Request borrow (own tool) | `401` | `403 FORBIDDEN` | Allowed | Allowed (non-own) |
| Approve / Decline / Mark Returned | `401` | Allowed | `403 FORBIDDEN` | `403 FORBIDDEN` (non-own) |
| Cancel pending borrow request | `401` | `403` (unless borrower) | Allowed (borrower only) | `403` (unless borrower) |
| View all community loans / Toggle Trusted Lender | `401` | `403 FORBIDDEN` | `403 FORBIDDEN` | Allowed |

*\*Deletion is rejected with `409 CONFLICT` if the tool has an active `approved` loan.*

### 2. Bidirectional HMAC-SHA256 Signing Specification

Every webhook and automation HTTP call carries:
- `X-LendLoop-Timestamp`: Unix epoch timestamp in seconds (UTC)
- `X-LendLoop-Signature`: `v1=<64-char-lowercase-hex>`

Canonical signed message:
- **POST requests:** `${timestamp}.${rawJsonBody}`
- **GET `/api/automation/overdue-loans`:** `${timestamp}.GET:/api/automation/overdue-loans`

Verification rules enforced identically in `convex/security.ts`, `src/lib/hmac.ts`, and `n8n/workflows/request-notification.json`:
1. Reject if secret or headers are missing (`503` / `401`).
2. Enforce strict **±300 second (5-minute) replay window**.
3. Compute HMAC-SHA256 using Web Crypto (`crypto.subtle` in Convex/Next.js) or `node:crypto` (n8n Code node).
4. Compare digests using **constant-time comparison** (`timingSafeEqual`) to prevent timing side-channels.

### 3. Deterministic Idempotency Strategy

- Overdue reminders generate deterministic daily keys:
  ```text
  overdue:{loanId}:{YYYY-MM-DD}
  ```
- Borrow request creation & status-change notifications generate:
  ```text
  notify:{loanId}:{requested|approved|declined|returned|cancelled}
  ```
- Both `/api/automation/reminder-logged` and `/api/automation/notification-logged` also verify that the `loanId` embedded inside `idempotencyKey` matches the request body's `loanId` (blocking cross-loan key spoofing).
- `automationLogs` enforces a unique lookup via index `by_idempotency_key`. If n8n retries after a transient network timeout or a cron job executes twice on the same UTC day, Convex returns `200 OK` `{ status: "already_recorded", duplicate: true }` without creating duplicate rows or double-incrementing `loan.reminderCount`.

### 4. Verification Suite

```bash
npm run typecheck   # Strict TypeScript across Next.js, Convex, and tests
npm test            # Vitest: RBAC, Data Minimization, HMAC/Replay, Idempotency, n8n static audit
npm run build       # Production Next.js build verification
```

---

## What I Would Change for Production (HIPAA / Healthcare-Grade)

Moving an architecture like this into a regulated healthcare or clinical-training environment (handling PHI, clinician supervision records, or patient-adjacent workflows) requires hardening every boundary beyond a take-home prototype:

1. **BAA-Covered Infrastructure & Tenant Isolation:**
   - Run all PHI-touching workloads exclusively on BAA-eligible infrastructure (e.g., AWS ECS/Lambda/RDS Postgres with RLS or HIPAA-tier Convex/Clerk Enterprise under executed BAAs). Never send PHI through non-BAA webhook relays or default cloud notification sinks.
   - Enforce strict **organization/clinic tenant scoping** (`organizationId` claim in Clerk JWTs) on every query index so cross-tenant data leaks are structurally impossible.
2. **Defense-in-Depth Encryption & Secret Lifecycle:**
   - Replace static shared `.env` HMAC keys with **AWS KMS / Secrets Manager** + automated dual-key rotation (supporting `v1` + `v2` signature headers concurrently during rotation windows with zero downtime).
   - Apply **envelope encryption** (per-tenant DEKs wrapped by KMS CMKs) for sensitive clinical notes/fields at rest, with TLS 1.3 + mTLS between internal automation workers and backend APIs.
3. **Immutable Audit Logging (HIPAA §164.312(b)):**
   - Emit structured, append-only audit records (actor ID, role, tenant ID, resource ID, action, timestamp, request correlation ID — **strictly zero PHI in log bodies**) into tamper-evident WORM storage (e.g., AWS S3 Object Lock + CloudTrail).
4. **Hardened n8n / Automation Operations:**
   - Run self-hosted n8n in **queue mode** (Redis + dedicated worker replicas) inside a private VPC subnet with egress allowlisting, strict `saveDataSuccessExecution: "none"`, encrypted Postgres backend, and a **Dead-Letter Queue (DLQ)** + PagerDuty/Slack paging via the Error Workflow.
   - Ensure outbound notifications (email/SMS) never include PHI in cleartext — send only a generic alert ("You have a new clinical review item") linking back to the authenticated, MFA-protected portal.
5. **Identity, Session & Application Edge Hardening:**
   - Mandate **MFA** for admins and clinicians, shorten idle session lifetimes (HIPAA automatic logoff §164.312(a)(2)(iii)), enforce strict `Content-Security-Policy` + `HSTS`, and add distributed rate limiting (Redis/WAF) on auth and webhook routes.
6. **AI / LLM Guardrails (When Integrating Clinical AI Workflows):**
   - Route prompts through a **PII/PHI redaction & tokenization gateway** before calling LLM APIs, use zero-data-retention (ZDR) enterprise model endpoints under a BAA, validate structured outputs with strict schemas, and keep a mandatory human clinician in the loop for high-stakes outputs.

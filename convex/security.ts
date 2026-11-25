import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const HMAC_SIGNATURE_HEADER = "x-lendloop-signature";
export const HMAC_TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const HMAC_PREFIX = "v1=";
export const MAX_REPLAY_WINDOW_SECONDS = 300;

const encoder = new TextEncoder();
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function throwDomainError(
  code: "UNAUTHORIZED" | "FORBIDDEN" | "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND",
  message: string
): never {
  throw new ConvexError({ code, message });
}

export async function requireUser(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throwDomainError("UNAUTHORIZED", "Authentication required.");
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
  if (!user) {
    throwDomainError(
      "UNAUTHORIZED",
      "Authenticated user profile has not been synced yet."
    );
  }
  return user;
}

export async function requireAdmin(
  ctx: QueryCtx | MutationCtx
): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") {
    throwDomainError("FORBIDDEN", "Admin privileges are required.");
  }
  return user;
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) {
    return false;
  }
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function assertValidDateRange(startDate: string, endDate: string): void {
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
    throwDomainError(
      "BAD_REQUEST",
      "Dates must be valid calendar dates in YYYY-MM-DD format."
    );
  }
  if (startDate > endDate) {
    throwDomainError("BAD_REQUEST", "endDate must be on or after startDate.");
  }
}

export function dateRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function todayUtcIso(nowMs: number = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function computeDaysOverdue(endDate: string, todayIso: string): number {
  if (!isValidIsoDate(endDate) || todayIso <= endDate) {
    return 0;
  }
  const endMs = Date.parse(`${endDate}T00:00:00.000Z`);
  const todayMs = Date.parse(`${todayIso}T00:00:00.000Z`);
  return Math.max(0, Math.floor((todayMs - endMs) / 86_400_000));
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i += 1) {
    diff |= (i < aBytes.length ? aBytes[i] : 0) ^ (i < bBytes.length ? bBytes[i] : 0);
  }
  return diff === 0;
}

export async function hmacSha256Hex(
  secret: string,
  payload: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return bytesToHex(new Uint8Array(sig));
}

export async function signHmacHeaders(
  secret: string,
  rawBody: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000)
): Promise<Record<string, string>> {
  const ts = String(timestampSeconds);
  const hex = await hmacSha256Hex(secret, `${ts}.${rawBody}`);
  return {
    "X-LendLoop-Timestamp": ts,
    "X-LendLoop-Signature": `${HMAC_PREFIX}${hex}`,
  };
}

export async function verifyHmacRequest(params: {
  secret: string | undefined;
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!params.secret) {
    return {
      ok: false,
      status: 503,
      error: "LENDLOOP_HMAC_SECRET is not configured on Convex deployment.",
    };
  }
  if (!params.signatureHeader || !params.timestampHeader) {
    return {
      ok: false,
      status: 401,
      error: "Missing HMAC authentication headers.",
    };
  }
  const trimmedTs = params.timestampHeader.trim();
  if (!/^\d+$/.test(trimmedTs)) {
    return { ok: false, status: 401, error: "Invalid timestamp header." };
  }
  const ts = Number(trimmedTs);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > MAX_REPLAY_WINDOW_SECONDS) {
    return {
      ok: false,
      status: 401,
      error: "Request timestamp outside 5-minute replay window.",
    };
  }
  const sig = params.signatureHeader.trim();
  if (!sig.startsWith(HMAC_PREFIX)) {
    return { ok: false, status: 401, error: "Unsupported signature version." };
  }
  const providedHex = sig.slice(HMAC_PREFIX.length).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(providedHex)) {
    return { ok: false, status: 401, error: "Malformed signature digest." };
  }
  const expectedHex = await hmacSha256Hex(
    params.secret,
    `${trimmedTs}.${params.rawBody}`
  );
  if (!timingSafeEqual(expectedHex, providedHex)) {
    return { ok: false, status: 401, error: "Invalid HMAC signature." };
  }
  return { ok: true };
}

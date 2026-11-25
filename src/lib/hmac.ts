export const HMAC_SIGNATURE_HEADER = "x-lendloop-signature";
export const HMAC_TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const HMAC_SIGNATURE_PREFIX = "v1=";
export const DEFAULT_MAX_SKEW_SECONDS = 300; // 5-minute replay window

const textEncoder = new TextEncoder();

export function buildCanonicalSigningPayload(
  timestampSeconds: number | string,
  rawBody: string
): string {
  return `${String(timestampSeconds)}.${rawBody}`;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Constant-time comparison over UTF-8 byte arrays to prevent timing side-channels.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const aBytes = textEncoder.encode(a);
  const bBytes = textEncoder.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i += 1) {
    const aVal = i < aBytes.length ? aBytes[i] : 0;
    const bVal = i < bBytes.length ? bBytes[i] : 0;
    diff |= aVal ^ bVal;
  }
  return diff === 0;
}

/**
 * Web Crypto HMAC-SHA256 — runs identically in Convex V8, Next.js Edge/Node, and Vitest.
 */
export async function computeHmacSha256Hex(
  secret: string,
  message: string
): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(message)
  );
  return bytesToHex(new Uint8Array(signatureBuffer));
}

export async function signWebhookPayload(params: {
  secret: string;
  rawBody: string;
  timestampSeconds?: number;
}): Promise<{
  timestamp: string;
  signature: string;
  headers: Record<string, string>;
}> {
  if (!params.secret) {
    throw new Error("HMAC secret must be configured before signing payloads.");
  }
  const timestamp = String(
    params.timestampSeconds ?? Math.floor(Date.now() / 1000)
  );
  const canonical = buildCanonicalSigningPayload(timestamp, params.rawBody);
  const hex = await computeHmacSha256Hex(params.secret, canonical);
  const signature = `${HMAC_SIGNATURE_PREFIX}${hex}`;
  return {
    timestamp,
    signature,
    headers: {
      "X-LendLoop-Timestamp": timestamp,
      "X-LendLoop-Signature": signature,
    },
  };
}

export type VerifySignatureFailureReason =
  | "missing_secret"
  | "missing_headers"
  | "invalid_timestamp"
  | "timestamp_out_of_window"
  | "invalid_format"
  | "signature_mismatch";

export type VerifySignatureResult =
  | { valid: true; timestampSeconds: number }
  | { valid: false; reason: VerifySignatureFailureReason };

export async function verifyWebhookSignature(params: {
  secret: string | undefined;
  rawBody: string;
  signatureHeader: string | null | undefined;
  timestampHeader: string | null | undefined;
  nowSeconds?: number;
  maxSkewSeconds?: number;
}): Promise<VerifySignatureResult> {
  if (!params.secret || params.secret.trim().length === 0) {
    return { valid: false, reason: "missing_secret" };
  }
  if (!params.signatureHeader || !params.timestampHeader) {
    return { valid: false, reason: "missing_headers" };
  }

  const trimmedTs = params.timestampHeader.trim();
  if (!/^\d+$/.test(trimmedTs)) {
    return { valid: false, reason: "invalid_timestamp" };
  }
  const timestampSeconds = Number(trimmedTs);
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) {
    return { valid: false, reason: "invalid_timestamp" };
  }

  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxSkew = params.maxSkewSeconds ?? DEFAULT_MAX_SKEW_SECONDS;
  if (Math.abs(nowSeconds - timestampSeconds) > maxSkew) {
    return { valid: false, reason: "timestamp_out_of_window" };
  }

  const sig = params.signatureHeader.trim();
  if (!sig.startsWith(HMAC_SIGNATURE_PREFIX)) {
    return { valid: false, reason: "invalid_format" };
  }
  const providedHex = sig.slice(HMAC_SIGNATURE_PREFIX.length).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(providedHex)) {
    return { valid: false, reason: "invalid_format" };
  }

  const canonical = buildCanonicalSigningPayload(
    timestampSeconds,
    params.rawBody
  );
  const expectedHex = await computeHmacSha256Hex(params.secret, canonical);
  if (!timingSafeEqualString(expectedHex, providedHex)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  return { valid: true, timestampSeconds };
}

/**
 * Strips emails, bearer tokens, HMAC headers, and long hex secrets from logs/alerts.
 */
export function sanitizeTelemetryText(input: string, maxLength = 400): string {
  return input
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/v1=[0-9a-f]{32,128}/gi, "v1=[redacted-sig]")
    .replace(/\b[0-9a-f]{32,}\b/gi, "[redacted-secret]")
    .slice(0, maxLength);
}

import { describe, expect, it } from "vitest";
import {
  sanitizeTelemetryText,
  signWebhookPayload,
  verifyWebhookSignature,
} from "@/lib/hmac";

const TEST_SECRET = "test-hmac-secret-0123456789abcdef0123456789abcdef";

describe("Bidirectional HMAC-SHA256 Signing & Replay Protection", () => {
  it("signs and verifies a valid webhook payload within the 5-minute replay window", async () => {
    const now = 1_780_000_000;
    const rawBody = JSON.stringify({
      loanId: "loan_1",
      idempotencyKey: "overdue:loan_1:2026-06-01",
    });

    const signed = await signWebhookPayload({
      secret: TEST_SECRET,
      rawBody,
      timestampSeconds: now,
    });

    expect(signed.signature.startsWith("v1=")).toBe(true);
    expect(signed.signature.length).toBe(3 + 64);

    const verified = await verifyWebhookSignature({
      secret: TEST_SECRET,
      rawBody,
      signatureHeader: signed.signature,
      timestampHeader: signed.timestamp,
      nowSeconds: now + 120, // 2 min skew — valid
    });

    expect(verified).toEqual({ valid: true, timestampSeconds: now });
  });

  it("rejects tampered payloads with signature_mismatch", async () => {
    const now = 1_780_000_000;
    const rawBody = JSON.stringify({ loanId: "loan_1" });
    const signed = await signWebhookPayload({
      secret: TEST_SECRET,
      rawBody,
      timestampSeconds: now,
    });

    const tamperedBody = JSON.stringify({ loanId: "loan_999" });
    const result = await verifyWebhookSignature({
      secret: TEST_SECRET,
      rawBody: tamperedBody,
      signatureHeader: signed.signature,
      timestampHeader: signed.timestamp,
      nowSeconds: now + 5,
    });

    expect(result).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("rejects signatures signed with a wrong secret", async () => {
    const now = 1_780_000_000;
    const rawBody = "GET:/api/automation/overdue-loans";
    const signed = await signWebhookPayload({
      secret: "wrong-secret",
      rawBody,
      timestampSeconds: now,
    });

    const result = await verifyWebhookSignature({
      secret: TEST_SECRET,
      rawBody,
      signatureHeader: signed.signature,
      timestampHeader: signed.timestamp,
      nowSeconds: now,
    });

    expect(result).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("rejects replayed requests older than 300 seconds or far in the future", async () => {
    const oldTs = 1_780_000_000;
    const rawBody = "GET:/api/automation/overdue-loans";
    const signed = await signWebhookPayload({
      secret: TEST_SECRET,
      rawBody,
      timestampSeconds: oldTs,
    });

    const expired = await verifyWebhookSignature({
      secret: TEST_SECRET,
      rawBody,
      signatureHeader: signed.signature,
      timestampHeader: signed.timestamp,
      nowSeconds: oldTs + 301,
    });
    expect(expired).toEqual({ valid: false, reason: "timestamp_out_of_window" });

    const future = await verifyWebhookSignature({
      secret: TEST_SECRET,
      rawBody,
      signatureHeader: signed.signature,
      timestampHeader: signed.timestamp,
      nowSeconds: oldTs - 301,
    });
    expect(future).toEqual({ valid: false, reason: "timestamp_out_of_window" });
  });

  it("rejects missing headers, missing secret, and malformed signatures", async () => {
    expect(
      await verifyWebhookSignature({
        secret: undefined,
        rawBody: "{}",
        signatureHeader: "v1=abc",
        timestampHeader: "1780000000",
      })
    ).toEqual({ valid: false, reason: "missing_secret" });

    expect(
      await verifyWebhookSignature({
        secret: TEST_SECRET,
        rawBody: "{}",
        signatureHeader: null,
        timestampHeader: "1780000000",
      })
    ).toEqual({ valid: false, reason: "missing_headers" });

    expect(
      await verifyWebhookSignature({
        secret: TEST_SECRET,
        rawBody: "{}",
        signatureHeader: "sha256=not-v1",
        timestampHeader: "1780000000",
        nowSeconds: 1780000000,
      })
    ).toEqual({ valid: false, reason: "invalid_format" });
  });

  it("redacts PII emails, bearer tokens, and secrets from error telemetry", () => {
    const raw =
      "Failed notifying jane.doe@clinic.org with Bearer eyJhbGciOiJIUzI1NiJ9.abc and sig v1=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const sanitized = sanitizeTelemetryText(raw);
    expect(sanitized).not.toContain("jane.doe@clinic.org");
    expect(sanitized).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(sanitized).not.toContain("0123456789abcdef0123456789abcdef");
    expect(sanitized).toContain("[redacted-email]");
    expect(sanitized).toContain("Bearer [redacted]");
    expect(sanitized).toContain("v1=[redacted-sig]");
  });
});

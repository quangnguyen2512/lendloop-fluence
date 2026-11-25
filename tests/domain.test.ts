import { describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz";
import {
  buildOverdueIdempotencyKey,
  computeOverdueDays,
  datesOverlap,
  isValidIsoDate,
  projectPublicTool,
  validateDateRange,
  validateToolInput,
} from "@/lib/domain";

describe("Domain Rules & Data Minimization", () => {
  it("projects strictly { id, name, category } for public tools with zero PII", () => {
    const fullRecord = {
      id: "tool_1",
      name: "Bosch Jigsaw",
      category: "power_tools" as const,
      condition: "like_new" as const,
      shortDescription: "Owner lives at 123 Maple St, call 555-0199",
      ownerId: "user_secret_123",
      ownerEmail: "private@example.com",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };

    const projected = projectPublicTool(fullRecord);
    expect(projected).toEqual({
      id: "tool_1",
      name: "Bosch Jigsaw",
      category: "power_tools",
    });
    expect(Object.keys(projected).sort()).toEqual(["category", "id", "name"]);
    expect(JSON.stringify(projected)).not.toContain("private@example.com");
    expect(JSON.stringify(projected)).not.toContain("user_secret_123");
    expect(JSON.stringify(projected)).not.toContain("Maple");
  });

  it("validates ISO calendar dates and rejects invalid or reversed ranges", () => {
    expect(isValidIsoDate("2026-05-15")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true); // leap year
    expect(isValidIsoDate("2026-02-29")).toBe(false); // non-leap year
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("05/15/2026")).toBe(false);

    expect(() => validateDateRange("2026-05-10", "2026-05-12")).not.toThrow();
    expect(() => validateDateRange("2026-05-12", "2026-05-12")).not.toThrow();
    expect(() => validateDateRange("2026-05-15", "2026-05-10")).toThrow(
      AuthorizationError
    );
    expect(() => validateDateRange("2026-02-30", "2026-03-02")).toThrow(
      AuthorizationError
    );
  });

  it("detects inclusive date overlaps accurately", () => {
    expect(datesOverlap("2026-06-01", "2026-06-05", "2026-06-05", "2026-06-08")).toBe(
      true
    );
    expect(datesOverlap("2026-06-01", "2026-06-10", "2026-06-03", "2026-06-04")).toBe(
      true
    );
    expect(datesOverlap("2026-06-01", "2026-06-04", "2026-06-05", "2026-06-08")).toBe(
      false
    );
  });

  it("computes overdue days and deterministic idempotency keys", () => {
    expect(computeOverdueDays("2026-06-10", "2026-06-10")).toBe(0);
    expect(computeOverdueDays("2026-06-10", "2026-06-09")).toBe(0);
    expect(computeOverdueDays("2026-06-10", "2026-06-13")).toBe(3);

    expect(buildOverdueIdempotencyKey("loan_42", "2026-06-13")).toBe(
      "overdue:loan_42:2026-06-13"
    );
    expect(() => buildOverdueIdempotencyKey("loan_42", "bad-date")).toThrow(
      AuthorizationError
    );
  });

  it("validates tool listing payloads strictly", () => {
    const clean = validateToolInput({
      name: "  Cordless Leaf Blower  ",
      category: "garden",
      condition: "good",
      shortDescription: "  Includes 40V battery and rapid charger.  ",
    });
    expect(clean.name).toBe("Cordless Leaf Blower");
    expect(clean.shortDescription).toBe("Includes 40V battery and rapid charger.");

    expect(() =>
      validateToolInput({
        name: "A",
        category: "garden",
        condition: "good",
        shortDescription: "Too short name.",
      })
    ).toThrow(AuthorizationError);
  });
});

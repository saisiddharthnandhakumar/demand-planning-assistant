import { describe, expect, it } from "vitest";
import type { DecisionStatus } from "@/lib/decisions";
import { overrideRate, reviewProgress, submitBlocker, type ReviewItem } from "@/lib/override-rate";

const engine = (decisionStatus: DecisionStatus): ReviewItem => ({ isEdge: false, decisionStatus });
const edge = (decisionStatus: DecisionStatus): ReviewItem => ({ isEdge: true, decisionStatus });
const many = (n: number, status: DecisionStatus) => Array.from({ length: n }, () => engine(status));

describe("overrideRate", () => {
  it("is overridden engine decisions over all engine decisions", () => {
    expect(overrideRate([...many(7, "approved"), ...many(2, "edited"), ...many(1, "rejected")])).toBeCloseTo(0.3);
  });

  it("only Edit and Reject count as overrides; Approve does not", () => {
    expect(overrideRate(many(10, "approved"))).toBe(0);
    expect(overrideRate(many(10, "edited"))).toBe(1);
    expect(overrideRate(many(10, "rejected"))).toBe(1);
  });

  it("the denominator includes every non-edge SKU, so approved no-action rows dilute the rate", () => {
    // 15 SKUs, 1 edge, 14 engine: 5 overridden of 14, not of the 6 that had an action
    const items = [edge("approved"), ...many(9, "approved"), ...many(3, "edited"), ...many(2, "rejected")];
    expect(overrideRate(items)).toBeCloseTo(5 / 14, 10);
  });

  it("excludes edge SKUs entirely, whatever their status", () => {
    const base = [...many(8, "approved"), ...many(2, "edited")];
    expect(overrideRate([...base, edge("approved"), edge("approved"), edge("edited"), edge("rejected")])).toBe(
      overrideRate(base),
    );
  });

  it("is null when there are no engine decisions to judge", () => {
    expect(overrideRate([])).toBeNull();
    expect(overrideRate([edge("approved"), edge("approved")])).toBeNull();
  });

  it("the 30% line: 4 of 14 is under, 5 of 14 is over (strictly above 0.30)", () => {
    expect(overrideRate([...many(10, "approved"), ...many(4, "edited")])!).toBeLessThan(0.3);
    expect(overrideRate([...many(9, "approved"), ...many(5, "edited")])!).toBeGreaterThan(0.3);
  });
});

describe("reviewProgress", () => {
  it("counts engine and edge decisions separately", () => {
    const p = reviewProgress([...many(5, "approved"), ...many(2, "edited"), engine("rejected"), engine("pending"), edge("approved"), edge("pending")]);
    expect(p).toMatchObject({
      engineTotal: 9,
      engineDecided: 8,
      engineApproved: 5,
      engineEdited: 2,
      engineRejected: 1,
      pendingEngine: 1,
      edgeTotal: 2,
      edgeDecided: 1,
      pendingEdge: 1,
      readyToSubmit: false,
    });
  });

  it("is ready only when every engine and edge SKU is decided", () => {
    expect(reviewProgress([...many(14, "approved"), edge("approved")]).readyToSubmit).toBe(true);
    expect(reviewProgress([...many(14, "approved"), edge("pending")]).readyToSubmit).toBe(false);
    expect(reviewProgress([...many(13, "approved"), engine("pending"), edge("approved")]).readyToSubmit).toBe(false);
  });

  it("an empty run is never ready to submit", () => {
    expect(reviewProgress([]).readyToSubmit).toBe(false);
  });
});

describe("submitBlocker", () => {
  it("is null when ready", () => {
    expect(submitBlocker(reviewProgress([...many(3, "approved"), edge("approved")]))).toBeNull();
  });

  it("names what is left, with correct plurals", () => {
    expect(submitBlocker(reviewProgress([edge("pending"), ...many(1, "pending")]))).toBe(
      "Still to decide: 1 SKU that needs your judgment and 1 engine decision.",
    );
    expect(submitBlocker(reviewProgress([edge("pending"), edge("pending"), ...many(13, "pending")]))).toBe(
      "Still to decide: 2 SKUs that need your judgment and 13 engine decisions.",
    );
    expect(submitBlocker(reviewProgress(many(3, "pending")))).toBe("Still to decide: 3 engine decisions.");
  });
});

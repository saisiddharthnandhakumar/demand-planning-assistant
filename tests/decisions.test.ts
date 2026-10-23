import { describe, expect, it } from "vitest";
import {
  buildDecision,
  decisionInputSchema,
  isOrderAction,
  reasonLabel,
  REASON_CATEGORIES,
  type DecisionInput,
} from "@/lib/decisions";

const engineItem = { isEdge: false, recommendedAction: "REORDER_NOW", recommendedQty: 300 };
const noAction = { isEdge: false, recommendedAction: "NO_ACTION", recommendedQty: 0 };
const pause = { isEdge: false, recommendedAction: "PAUSE_ORDER", recommendedQty: 0 };
const edgeItem = { isEdge: true, recommendedAction: "REORDER_NOW", recommendedQty: 750 };

/** Parse like the server action does, then build. */
function run(input: DecisionInput, item = engineItem) {
  const parsed = decisionInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  return buildDecision(parsed.data, item);
}

describe("approve", () => {
  it("copies the recommendation and clears any reason", () => {
    expect(run({ decision: "approve" })).toEqual({
      ok: true,
      update: { decisionStatus: "approved", finalAction: "REORDER_NOW", finalQty: 300, overrideReason: null, overrideNote: null },
    });
  });

  it("approves a no-action or pause recommendation as is", () => {
    expect(run({ decision: "approve" }, noAction)).toMatchObject({ ok: true, update: { finalAction: "NO_ACTION", finalQty: 0 } });
    expect(run({ decision: "approve" }, pause)).toMatchObject({ ok: true, update: { finalAction: "PAUSE_ORDER", finalQty: 0 } });
  });
});

describe("edit", () => {
  it("records the new action and quantity with a reason, as an override", () => {
    const res = run({ decision: "edit", action: "REORDER", qty: 250, reasonCategory: "supplier_constraint", note: "  MOQ is 250  " });
    expect(res).toEqual({
      ok: true,
      update: { decisionStatus: "edited", finalAction: "REORDER", finalQty: 250, overrideReason: "supplier_constraint", overrideNote: "MOQ is 250" },
    });
  });

  it("requires a reason category", () => {
    expect(run({ decision: "edit", action: "REORDER", qty: 250 } as DecisionInput)).toMatchObject({ ok: false, error: "Choose a reason." });
    expect(run({ decision: "edit", action: "REORDER", qty: 250, reasonCategory: "" as never })).toMatchObject({ ok: false });
    expect(run({ decision: "edit", action: "REORDER", qty: 250, reasonCategory: "because" as never })).toMatchObject({ ok: false });
  });

  it("the note is optional and blank notes become null", () => {
    const a = run({ decision: "edit", action: "REORDER", qty: 250, reasonCategory: "other" });
    const b = run({ decision: "edit", action: "REORDER", qty: 250, reasonCategory: "other", note: "   " });
    expect(a).toMatchObject({ ok: true, update: { overrideNote: null } });
    expect(b).toMatchObject({ ok: true, update: { overrideNote: null } });
  });

  it("rejects an edit that changes nothing", () => {
    expect(run({ decision: "edit", action: "REORDER_NOW", qty: 300, reasonCategory: "other" })).toMatchObject({
      ok: false,
      error: "That matches the recommendation. Use Approve instead.",
    });
  });

  it("changing only the quantity, or only the action, counts as an edit", () => {
    expect(run({ decision: "edit", action: "REORDER_NOW", qty: 301, reasonCategory: "other" })).toMatchObject({ ok: true });
    expect(run({ decision: "edit", action: "REORDER", qty: 300, reasonCategory: "other" })).toMatchObject({ ok: true });
  });

  it("an order needs a quantity of at least 1", () => {
    for (const qty of [0, null, undefined]) {
      expect(run({ decision: "edit", action: "REORDER", qty, reasonCategory: "other" })).toMatchObject({
        ok: false,
        error: "Enter a quantity of at least 1 for an order.",
      });
    }
  });

  it("non-order actions force the quantity to 0, whatever was typed", () => {
    expect(run({ decision: "edit", action: "PAUSE_ORDER", qty: 500, reasonCategory: "market_event" })).toMatchObject({
      ok: true,
      update: { finalAction: "PAUSE_ORDER", finalQty: 0 },
    });
    expect(run({ decision: "edit", action: "NO_ACTION", qty: null, reasonCategory: "market_event" })).toMatchObject({
      ok: true,
      update: { finalAction: "NO_ACTION", finalQty: 0 },
    });
  });

  it("turning a no-action into an order is a valid edit", () => {
    expect(run({ decision: "edit", action: "REORDER", qty: 100, reasonCategory: "demand_view_differs" }, noAction)).toMatchObject({
      ok: true,
      update: { decisionStatus: "edited", finalQty: 100 },
    });
  });

  it("validates quantity: whole, non-negative, not absurd", () => {
    const bad = (qty: number) => run({ decision: "edit", action: "REORDER", qty, reasonCategory: "other" });
    expect(bad(12.5)).toMatchObject({ ok: false, error: "Quantity must be a whole number." });
    expect(bad(-3)).toMatchObject({ ok: false, error: "Quantity cannot be negative." });
    expect(bad(5_000_000)).toMatchObject({ ok: false });
  });

  it("limits the note length", () => {
    expect(run({ decision: "edit", action: "REORDER", qty: 100, reasonCategory: "other", note: "x".repeat(501) })).toMatchObject({ ok: false });
    expect(run({ decision: "edit", action: "REORDER", qty: 100, reasonCategory: "other", note: "x".repeat(500) })).toMatchObject({ ok: true });
  });

  it("rejects unknown actions", () => {
    expect(run({ decision: "edit", action: "BUY_EVERYTHING" as never, qty: 1, reasonCategory: "other" })).toMatchObject({ ok: false });
  });
});

describe("reject", () => {
  it("means no action, needs a reason, and counts as an override", () => {
    expect(run({ decision: "reject", reasonCategory: "data_issue", note: "stock count looks wrong" })).toEqual({
      ok: true,
      update: { decisionStatus: "rejected", finalAction: "NO_ACTION", finalQty: 0, overrideReason: "data_issue", overrideNote: "stock count looks wrong" },
    });
    expect(run({ decision: "reject" } as DecisionInput)).toMatchObject({ ok: false, error: "Choose a reason." });
  });

  it("cannot reject a no-action recommendation (nothing to reject)", () => {
    expect(run({ decision: "reject", reasonCategory: "other" }, noAction)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/nothing to reject/),
    });
  });

  it("can reject a pause recommendation", () => {
    expect(run({ decision: "reject", reasonCategory: "demand_view_differs" }, pause)).toMatchObject({ ok: true });
  });
});

describe("edge SKUs (needs your judgment)", () => {
  it("only accept 'decide', with explicit action, quantity and reason", () => {
    expect(run({ decision: "decide", action: "REORDER_NOW", qty: 700, reasonCategory: "market_event", note: "festival stock-up" }, edgeItem)).toEqual({
      ok: true,
      update: { decisionStatus: "approved", finalAction: "REORDER_NOW", finalQty: 700, overrideReason: "market_event", overrideNote: "festival stock-up" },
    });
  });

  it("do not allow approve, edit or reject", () => {
    for (const input of [
      { decision: "approve" },
      { decision: "reject", reasonCategory: "other" },
      { decision: "edit", action: "REORDER", qty: 5, reasonCategory: "other" },
    ] as DecisionInput[]) {
      expect(run(input, edgeItem)).toMatchObject({ ok: false, error: expect.stringMatching(/needs your judgment/) });
    }
  });

  it("require action and reason; an order needs a quantity", () => {
    expect(run({ decision: "decide", qty: 5, reasonCategory: "other" } as DecisionInput, edgeItem)).toMatchObject({ ok: false, error: "Choose an action." });
    expect(run({ decision: "decide", action: "REORDER", qty: 5 } as DecisionInput, edgeItem)).toMatchObject({ ok: false, error: "Choose a reason." });
    expect(run({ decision: "decide", action: "REORDER", qty: null, reasonCategory: "other" }, edgeItem)).toMatchObject({ ok: false });
  });

  it("accept a decision that matches the reference (he is free to agree), still as his own decision", () => {
    expect(run({ decision: "decide", action: "REORDER_NOW", qty: 750, reasonCategory: "demand_view_differs" }, edgeItem)).toMatchObject({ ok: true });
  });

  it("can decide not to order", () => {
    expect(run({ decision: "decide", action: "NO_ACTION", qty: 400, reasonCategory: "market_event" }, edgeItem)).toMatchObject({
      ok: true,
      update: { finalAction: "NO_ACTION", finalQty: 0 },
    });
  });

  it("engine SKUs cannot use 'decide'", () => {
    expect(run({ decision: "decide", action: "REORDER", qty: 5, reasonCategory: "other" }, engineItem)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Approve, Edit or Reject/),
    });
  });
});

describe("clear", () => {
  it("puts any item back to pending and wipes the decision", () => {
    for (const item of [engineItem, edgeItem]) {
      expect(run({ decision: "clear" }, item)).toEqual({
        ok: true,
        update: { decisionStatus: "pending", finalAction: null, finalQty: null, overrideReason: null, overrideNote: null },
      });
    }
  });
});

describe("helpers", () => {
  it("knows which actions are orders", () => {
    expect(isOrderAction("REORDER")).toBe(true);
    expect(isOrderAction("REORDER_NOW")).toBe(true);
    expect(isOrderAction("PAUSE_ORDER")).toBe(false);
    expect(isOrderAction("NO_ACTION")).toBe(false);
    expect(isOrderAction(null)).toBe(false);
  });

  it("offers exactly the five reason categories from the brief", () => {
    expect(REASON_CATEGORIES.map((r) => r.label)).toEqual([
      "Demand view differs",
      "Supplier constraint",
      "Market event",
      "Data issue",
      "Other",
    ]);
    expect(reasonLabel("market_event")).toBe("Market event");
    expect(reasonLabel(null)).toBe("");
  });
});

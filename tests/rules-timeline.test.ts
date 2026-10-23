import { describe, expect, it } from "vitest";
import { runEngine } from "@/lib/engine";
import { compareResults } from "@/lib/engine/compare";
import { INITIAL_RULES, type Rules } from "@/lib/rules";
import { buildTimeline, diffRules, type RulesVersion } from "@/lib/rules-timeline";
import { rulesWith, seedEngineInput } from "./helpers/engine-fixtures";

const v = (version: number, patch: Partial<Rules>, by = "Raghav", day = version): RulesVersion => ({
  version,
  document: { ...INITIAL_RULES, ...patch },
  by,
  at: new Date(Date.UTC(2026, 9, day)),
});

describe("diffRules", () => {
  it("lists changed leaves, including nested ones, in a stable order", () => {
    const changes = diffRules(INITIAL_RULES, {
      ...INITIAL_RULES,
      stockout_weeks: 5,
      edge: { ...INITIAL_RULES.edge, outlier_zscore: 3 },
    });
    expect(changes).toEqual([
      { path: "stockout_weeks", from: 6, to: 5 },
      { path: "edge.outlier_zscore", from: 2.5, to: 3 },
    ]);
  });

  it("returns nothing for identical documents regardless of key order", () => {
    const reverse = (o: unknown): unknown =>
      o && typeof o === "object"
        ? Object.fromEntries(Object.entries(o).reverse().map(([k, val]) => [k, reverse(val)]))
        : o;
    const reordered = reverse(INITIAL_RULES) as Rules;
    expect(Object.keys(reordered)[0]).not.toBe(Object.keys(INITIAL_RULES)[0]); // really reordered
    expect(diffRules(INITIAL_RULES, reordered)).toEqual([]);
  });
});

describe("buildTimeline", () => {
  const versions = [v(1, {}, "system"), v(3, { stockout_weeks: 5, overstock_weeks: 12 }, "Priya"), v(2, { stockout_weeks: 5 }, "Raghav")];

  it("is newest first and marks the current version", () => {
    const t = buildTimeline(versions, 3);
    expect(t.map((e) => e.version)).toEqual([3, 2, 1]);
    expect(t.map((e) => e.isCurrent)).toEqual([true, false, false]);
    expect(t.map((e) => e.by)).toEqual(["Priya", "Raghav", "system"]);
  });

  it("shows what each version changed relative to the one before it", () => {
    const t = buildTimeline(versions, 3);
    expect(t[0].changes).toEqual([{ path: "overstock_weeks", from: 14, to: 12 }]);
    expect(t[1].changes).toEqual([{ path: "stockout_weeks", from: 6, to: 5 }]);
    expect(t[2].changes).toBeNull(); // version 1 is the initial rules
  });

  it("copes with a missing previous version", () => {
    const t = buildTimeline([v(5, { stockout_weeks: 4 })], 5);
    expect(t[0].changes).toBeNull();
  });
});

describe("compareResults", () => {
  it("is empty when nothing changed", () => {
    const r = runEngine(seedEngineInput());
    expect(compareResults(r, r)).toEqual([]);
  });

  it("finds exactly the decisions a rule change affects", () => {
    const before = runEngine(seedEngineInput());
    const after = runEngine(seedEngineInput({ rules: rulesWith({ stockout_weeks: 4 }) }));
    // cover under 6 weeks was a stockout; a 4-week limit clears SKU003 (4.36) and SKU013 (3.17 stays)
    const changed = compareResults(before, after);
    expect(changed.map((c) => c.skuId)).toContain("SKU003");
    const sku003 = changed.find((c) => c.skuId === "SKU003")!;
    expect(sku003.before).toMatchObject({ action: "REORDER_NOW", qty: 300, isEdge: false });
    expect(sku003.after).toMatchObject({ action: "NO_ACTION", qty: 0, isEdge: false });
    expect(changed.find((c) => c.skuId === "SKU013")).toBeUndefined();
  });

  it("with uplift 0 only SKU002 differs (matches the brief's sensitivity test)", () => {
    const changed = compareResults(
      runEngine(seedEngineInput()),
      runEngine(seedEngineInput({ rules: rulesWith({ festival_uplift: 0 }) })),
    );
    expect(changed.map((c) => c.skuId)).toEqual(["SKU002"]);
  });
});

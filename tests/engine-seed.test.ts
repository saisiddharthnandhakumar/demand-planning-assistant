import { describe, expect, it } from "vitest";
import { runEngine } from "@/lib/engine";
import type { EngineItem } from "@/lib/engine/types";
import { INITIAL_RULES } from "@/lib/rules";
import { rulesWith, seedEngineInput } from "./helpers/engine-fixtures";

/**
 * Section 6.2 of the brief: expected engine output on the seed data, as-of
 * 2026-10-19 (festival month, uplift 25%, window W31-W42, recent W39-W42).
 */
const r2 = (n: number | null) => (n === null ? null : Number(n.toFixed(2)));

const EXPECTED = [
  // sku, avg12, avg4, cover, flags, action, qty
  ["SKU001", 214.92, 261.0, 3.35, ["HIGH_DEMAND", "STOCKOUT_RISK"], "REORDER_NOW", 750],
  ["SKU003", 150.5, 150.75, 4.36, ["STOCKOUT_RISK"], "REORDER_NOW", 300],
  ["SKU004", 79.83, 81.0, 1.8, ["STOCKOUT_RISK"], "REORDER_NOW", 150],
  ["SKU011", 204.33, 209.25, 1.8, ["STOCKOUT_RISK"], "REORDER_NOW", 500],
  ["SKU013", 45.42, 44.75, 3.17, ["STOCKOUT_RISK"], "REORDER_NOW", 120],
  ["SKU006", 39.58, 40.25, 22.23, ["OVERSTOCK_RISK"], "PAUSE_ORDER", 0],
  ["SKU007", 121.5, 133.5, 4.08, ["OVERSTOCK_RISK"], "PAUSE_ORDER", 0],
] as const;

const NO_ACTION_COVER: Record<string, number> = {
  SKU002: 11.46,
  SKU005: 8.07,
  SKU008: 6.99,
  SKU009: 9.39,
  SKU010: 8.52,
  SKU012: 6.77,
  SKU014: 6.85,
  SKU015: 9.65,
};

const result = runEngine(seedEngineInput());
const byId = new Map(result.items.map((i) => [i.skuId, i]));
const get = (id: string): EngineItem => {
  const item = byId.get(id);
  if (!item) throw new Error(`no item ${id}`);
  return item;
};

describe("engine reproduces the section 6.2 table on the seed data", () => {
  it("uses the right as-of logic", () => {
    expect(result.asOfDate).toBe("2026-10-19");
    expect(result.lastCompleteWeek).toBe("2026-W42");
    expect(result.uplift).toBe(0.25);
    const m = get("SKU001").metrics;
    expect(m.windowWeeks[0]).toBe("2026-W31");
    expect(m.windowWeeks.at(-1)).toBe("2026-W42");
    expect(m.windowWeeks).toHaveLength(12);
  });

  it.each(EXPECTED)("%s: metrics, flags, action and quantity", (id, avg12, avg4, cover, flags, action, qty) => {
    const item = get(id);
    expect(r2(item.metrics.avg12)).toBe(avg12);
    expect(r2(item.metrics.avg4)).toBe(avg4);
    expect(r2(item.metrics.coverWeeks)).toBe(cover);
    expect([...item.flags].sort()).toEqual([...flags].sort());
    expect(item.action).toBe(action);
    expect(item.qty).toBe(qty);
  });

  it.each(Object.entries(NO_ACTION_COVER))("%s: no flags, no action", (id, cover) => {
    const item = get(id);
    expect(r2(item.metrics.coverWeeks)).toBe(cover);
    expect(item.flags).toEqual([]);
    expect(item.action).toBe("NO_ACTION");
    expect(item.qty).toBe(0);
  });

  it("SKU001 surge is +21.4% from raw actuals (no uplift)", () => {
    expect(get("SKU001").metrics.surge).toBeCloseTo(0.214, 3);
  });

  it("perishability sets the limits (SKU004/011/007 use 3 and 4, others 6 and 14)", () => {
    for (const id of ["SKU004", "SKU011", "SKU007"]) {
      expect([get(id).metrics.minWeeks, get(id).metrics.maxWeeks]).toEqual([3, 4]);
    }
    expect([get("SKU003").metrics.minWeeks, get("SKU003").metrics.maxWeeks]).toEqual([6, 14]);
  });

  it("totals: 5 stockout, 2 overstock, 8 no-action, 1 edge", () => {
    expect(result.summary).toMatchObject({
      skus: 15,
      stockout: 5,
      overstock: 2,
      noAction: 8,
      edge: 1,
    });
  });

  it("only SKU001 is routed, and only for a step change of about +36%", () => {
    const edge = result.items.filter((i) => i.isEdge);
    expect(edge.map((i) => i.skuId)).toEqual(["SKU001"]);
    expect(edge[0].edgeReasons.map((r) => r.code)).toEqual(["STEP_CHANGE"]);
    expect(get("SKU001").metrics.stepChange).toBeCloseTo(0.36, 2);
    expect(edge[0].edgeReasons[0].message).toMatch(/36% above the prior 8-week average/);
  });

  it("no SKU trips the outlier or distributor-swing checks", () => {
    for (const item of result.items) {
      expect(item.metrics.maxZ).toBeLessThan(INITIAL_RULES.edge.outlier_zscore);
      expect(item.edgeReasons.some((r) => r.code === "DISTRIBUTOR_SWING")).toBe(false);
    }
  });

  it("reason text follows the template with computed numbers only", () => {
    expect(get("SKU001").reason).toBe(
      "Stock covers 3.4 weeks (festival uplift +25% applied) against a 6-week minimum. " +
        "Last-4-week sales are 21% above the 12-week average. Quantity is 1.5x the standard 500.",
    );
    expect(get("SKU004").reason).toBe(
      "Stock covers 1.8 weeks (festival uplift +25% applied) against a 3-week minimum.",
    );
    expect(get("SKU006").reason).toBe(
      "Stock covers 22.2 weeks (festival uplift +25% applied) against a 14-week maximum.",
    );
    expect(get("SKU002").reason).toBe(
      "Stock covers 11.5 weeks (festival uplift +25% applied), within the 6 to 14 week range.",
    );
  });
});

describe("sensitivity: festival uplift", () => {
  const decisions = (res: ReturnType<typeof runEngine>) =>
    new Map(res.items.map((i) => [i.skuId, `${[...i.flags].sort().join("+")}|${i.action}|${i.qty}`]));

  it("with uplift 0, exactly one decision changes: SKU002 becomes overstock at cover 14.33", () => {
    const withUplift = runEngine(seedEngineInput());
    const noUplift = runEngine(seedEngineInput({ rules: rulesWith({ festival_uplift: 0 }) }));
    const a = decisions(withUplift);
    const b = decisions(noUplift);
    const changed = [...a.keys()].filter((id) => a.get(id) !== b.get(id));
    expect(changed).toEqual(["SKU002"]);
    const sku002 = noUplift.items.find((i) => i.skuId === "SKU002")!;
    expect(r2(sku002.metrics.coverWeeks)).toBe(14.33);
    expect(sku002.flags).toEqual(["OVERSTOCK_RISK"]);
    expect(sku002.action).toBe("PAUSE_ORDER");
  });

  it("uplift changes cover only, never the surge test", () => {
    const withUplift = runEngine(seedEngineInput());
    const noUplift = runEngine(seedEngineInput({ rules: rulesWith({ festival_uplift: 0 }) }));
    for (const item of withUplift.items) {
      const other = noUplift.items.find((i) => i.skuId === item.skuId)!;
      expect(item.metrics.surge).toBe(other.metrics.surge);
      expect(item.metrics.avg12).toBe(other.metrics.avg12);
    }
  });
});

describe("thresholds come from the rules, not constants", () => {
  it("changing stockout_weeks changes the SKU003 decision", () => {
    const strict = runEngine(seedEngineInput({ rules: rulesWith({ stockout_weeks: 4 }) }));
    expect(strict.items.find((i) => i.skuId === "SKU003")!.action).toBe("NO_ACTION");
  });

  it("changing the multiplier changes the reference quantity", () => {
    const res = runEngine(seedEngineInput({ rules: rulesWith({ surge_reorder_multiplier: 2 }) }));
    expect(res.items.find((i) => i.skuId === "SKU001")!.qty).toBe(1000);
  });

  it("an as-of date override moves the windows", () => {
    const res = runEngine(seedEngineInput({ asOfDate: "2026-10-12" }));
    expect(res.lastCompleteWeek).toBe("2026-W41");
    expect(res.items[0].metrics.windowWeeks[0]).toBe("2026-W30");
  });
});

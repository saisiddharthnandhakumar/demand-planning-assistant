import { describe, expect, it } from "vitest";
import {
  EngineInputError,
  lastCompleteWeek,
  runEngine,
  windowWeeks,
  type EngineInput,
  type EngineItem,
  type EventTag,
} from "@/lib/engine";
import {
  PLAIN_ASOF,
  calendar2026,
  deepFreeze,
  flat,
  makeSku,
  rulesWith,
  salesFor,
  seedEngineInput,
  singleSku,
} from "./helpers/engine-fixtures";

const one = (input: EngineInput): EngineItem => runEngine(input).items[0];
const codes = (item: EngineItem) => item.edgeReasons.map((r) => r.code);
const SURGE = [...flat(100, 8), ...flat(150, 4)]; // surge +28.6%, step +50%

describe("as-of windows", () => {
  it("last complete week is the week before the as-of week", () => {
    expect(lastCompleteWeek("2026-10-19")).toBe("2026-W42");
    expect(lastCompleteWeek("2026-10-25")).toBe("2026-W42"); // Sunday of W43
    expect(lastCompleteWeek("2026-10-26")).toBe("2026-W43");
  });

  it("window is 12 weeks ending at the last complete week, across year ends", () => {
    const w = windowWeeks("2026-10-19", 12);
    expect([w[0], w[11]]).toEqual(["2026-W31", "2026-W42"]);
    expect(w.slice(-4)).toEqual(["2026-W39", "2026-W40", "2026-W41", "2026-W42"]);
    const y = windowWeeks("2027-01-04", 12); // ISO 2027-W01
    expect([y[0], y[11]]).toEqual(["2026-W42", "2026-W53"]);
  });

  it("window lengths come from the rules", () => {
    const item = one(
      singleSku({
        values: [10, 10, 10, 10, 10, 10, 20, 20],
        onHand: 100,
        rules: rulesWith({ baseline_weeks: 8, surge_recent_weeks: 2 }),
      }),
    );
    expect(item.metrics.windowWeeks).toHaveLength(8);
    expect(item.metrics.avg12).toBeCloseTo(12.5);
    expect(item.metrics.avg4).toBeCloseTo(20);
    expect(item.metrics.prior8).toBeCloseTo(10);
  });
});

describe("festival uplift", () => {
  it.each([
    ["2026-10-19", 0.25],
    ["2026-11-16", 0.25],
    ["2026-03-16", 0.25],
    [PLAIN_ASOF, 0],
    ["2026-12-14", 0],
  ])("as-of %s has uplift %s", (asOf, uplift) => {
    expect(runEngine(singleSku({ values: flat(100, 12), onHand: 1000, asOf })).uplift).toBe(uplift);
  });

  it("is read from the calendar table, and a missing month fails loudly", () => {
    const input = singleSku({ values: flat(100, 12), onHand: 1000 });
    expect(() => runEngine({ ...input, calendar: [] })).toThrow(EngineInputError);
    const custom = { ...input, calendar: calendar2026([8]) }; // August made a festival month
    expect(runEngine(custom).uplift).toBe(0.25);
  });

  it("applies to cover only: the surge test uses raw actuals", () => {
    const values = [...flat(100, 8), ...flat(119, 4)];
    const plain = one(singleSku({ values, onHand: 1000, asOf: PLAIN_ASOF }));
    const festival = one(singleSku({ values, onHand: 1000, asOf: "2026-10-19" }));
    expect(festival.metrics.surge).toBe(plain.metrics.surge);
    expect(plain.metrics.surge).toBeCloseTo(0.119, 2);
    expect(festival.metrics.coverWeeks).toBeCloseTo(plain.metrics.coverWeeks! / 1.25, 10);
  });
});

describe("threshold boundaries are strict", () => {
  const cover = (onHand: number, perishable = false) =>
    one(
      singleSku({
        values: flat(100, 12),
        onHand,
        sku: { perishability: perishable ? "High" : "Low" },
      }),
    );

  it("non-perishable: exactly 6 and 14 weeks are not flagged", () => {
    expect(cover(600).flags).toEqual([]);
    expect(cover(599).flags).toEqual(["STOCKOUT_RISK"]);
    expect(cover(1400).flags).toEqual([]);
    expect(cover(1401).flags).toEqual(["OVERSTOCK_RISK"]);
  });

  it("perishable: exactly 3 and 4 weeks are not flagged", () => {
    expect(cover(300, true).flags).toEqual([]);
    expect(cover(299, true).flags).toEqual(["STOCKOUT_RISK"]);
    expect(cover(400, true).flags).toEqual([]);
    expect(cover(401, true).flags).toEqual(["OVERSTOCK_RISK"]);
  });

  it("surge exactly at the threshold is not high-demand", () => {
    const surge = one(singleSku({ values: SURGE, onHand: 1000 })).metrics.surge!;
    const at = one(singleSku({ values: SURGE, onHand: 1000, rules: rulesWith({ surge_threshold: surge }) }));
    const below = one(
      singleSku({ values: SURGE, onHand: 1000, rules: rulesWith({ surge_threshold: surge - 1e-9 }) }),
    );
    expect(at.flags).not.toContain("HIGH_DEMAND");
    expect(below.flags).toContain("HIGH_DEMAND");
  });
});

describe("actions and quantities", () => {
  const sku = { standardReorderQty: 100 };

  it("stockout: REORDER_NOW at the standard quantity", () => {
    const i = one(singleSku({ values: flat(100, 12), onHand: 100, sku }));
    expect([i.action, i.qty]).toEqual(["REORDER_NOW", 100]);
  });

  it("stockout + high-demand: REORDER_NOW at 1.5x", () => {
    const i = one(singleSku({ values: SURGE, onHand: 100, sku }));
    expect(i.flags.sort()).toEqual(["HIGH_DEMAND", "STOCKOUT_RISK"]);
    expect([i.action, i.qty]).toEqual(["REORDER_NOW", 150]);
  });

  it("high-demand alone: REORDER at 1.5x", () => {
    const i = one(singleSku({ values: SURGE, onHand: 1000, sku }));
    expect(i.flags).toEqual(["HIGH_DEMAND"]);
    expect([i.action, i.qty]).toEqual(["REORDER", 150]);
  });

  it("overstock: PAUSE_ORDER with quantity 0", () => {
    const i = one(singleSku({ values: flat(100, 12), onHand: 5000, sku }));
    expect([i.action, i.qty]).toEqual(["PAUSE_ORDER", 0]);
  });

  it("neither: NO_ACTION", () => {
    const i = one(singleSku({ values: flat(100, 12), onHand: 1000, sku }));
    expect([i.action, i.qty]).toEqual(["NO_ACTION", 0]);
  });

  it("1.5x is rounded to whole units (half up)", () => {
    const i = one(singleSku({ values: SURGE, onHand: 100, sku: { standardReorderQty: 5 } }));
    expect(i.qty).toBe(8); // 7.5
  });

  it("high-demand with overstock conflicts: reference action is PAUSE_ORDER and the SKU is routed", () => {
    const i = one(singleSku({ values: SURGE, onHand: 5000, sku }));
    expect(i.flags.sort()).toEqual(["HIGH_DEMAND", "OVERSTOCK_RISK"]);
    expect(i.action).toBe("PAUSE_ORDER");
    expect(i.isEdge).toBe(true);
    expect(codes(i)).toContain("CONFLICTING_FLAGS");
  });
});

describe("edge router", () => {
  it("a clean SKU is not an edge case", () => {
    const i = one(singleSku({ values: flat(100, 12), onHand: 1000 }));
    expect(i.isEdge).toBe(false);
    expect(i.edgeReasons).toEqual([]);
  });

  it("short history", () => {
    const i = one(singleSku({ values: flat(100, 10), onHand: 1000 }));
    expect(codes(i)).toEqual(["SHORT_HISTORY", "DATA_MISSING_WEEKS"]);
    expect(i.edgeReasons[0].message).toBe("Only 10 weeks of sales history (minimum 12).");
  });

  it("history only counts weeks up to the last complete week", () => {
    const input = singleSku({ values: flat(100, 10), onHand: 1000 });
    input.sales.push({ skuId: "S1", isoWeek: "2026-W34", units: 999 }); // current week
    const i = one(input);
    expect(i.metrics.historyWeeks).toBe(10);
  });

  it("step change in either direction, strictly above the threshold", () => {
    const up = one(singleSku({ values: [...flat(100, 8), ...flat(140, 4)], onHand: 1000 }));
    expect(codes(up)).toContain("STEP_CHANGE");
    expect(up.metrics.stepChange).toBeCloseTo(0.4);
    const down = one(singleSku({ values: [...flat(100, 8), ...flat(60, 4)], onHand: 1000 }));
    expect(down.edgeReasons.find((r) => r.code === "STEP_CHANGE")!.message).toMatch(/40% below/);
    const mild = one(singleSku({ values: [...flat(100, 8), ...flat(120, 4)], onHand: 1000 }));
    expect(codes(mild)).not.toContain("STEP_CHANGE");
    const step = up.metrics.stepChange!;
    const atThreshold = one(
      singleSku({
        values: [...flat(100, 8), ...flat(140, 4)],
        onHand: 1000,
        rules: rulesWith({ edge: { ...rulesWith({}).edge, step_change_threshold: step } }),
      }),
    );
    expect(codes(atThreshold)).not.toContain("STEP_CHANGE");
  });

  it("outlier week (z above 2.5 with the sample standard deviation)", () => {
    const values = flat(100, 12);
    values[2] = 200;
    const i = one(singleSku({ values, onHand: 1000 }));
    expect(codes(i)).toEqual(["OUTLIER_WEEK"]);
    expect(i.metrics.maxZ).toBeCloseTo(3.175, 2);
    expect(i.metrics.maxZWeek).toBe(windowWeeks(PLAIN_ASOF, 12)[2]);
    // configurable: a higher threshold stops it firing
    const lenient = one(
      singleSku({
        values,
        onHand: 1000,
        rules: rulesWith({ edge: { ...rulesWith({}).edge, outlier_zscore: 3.5 } }),
      }),
    );
    expect(lenient.isEdge).toBe(false);
  });

  it("a constant series has no outlier", () => {
    expect(one(singleSku({ values: flat(100, 12), onHand: 1000 })).metrics.maxZ).toBe(0);
  });

  describe("distributor swing", () => {
    const build = (threshold?: number): EngineInput => ({
      asOfDate: PLAIN_ASOF,
      skus: [
        makeSku("A", { distributorId: "DIST1" }),
        makeSku("B", { distributorId: "DIST1" }),
        makeSku("C", { distributorId: "DIST2" }),
      ],
      sales: [
        ...salesFor("A", [...flat(100, 8), ...flat(200, 4)]),
        ...salesFor("B", flat(100, 12)),
        ...salesFor("C", flat(100, 12)),
      ],
      inventory: ["A", "B", "C"].map((skuId) => ({ skuId, unitsOnHand: 1000 })),
      calendar: calendar2026(),
      rules: threshold
        ? rulesWith({ edge: { ...rulesWith({}).edge, distributor_swing_threshold: threshold } })
        : rulesWith({}),
    });

    it("routes every SKU of a distributor whose total moved more than the threshold", () => {
      const items = new Map(runEngine(build()).items.map((i) => [i.skuId, i]));
      expect(codes(items.get("B")!)).toEqual(["DISTRIBUTOR_SWING"]);
      expect(codes(items.get("A")!)).toContain("DISTRIBUTOR_SWING");
      expect(items.get("C")!.isEdge).toBe(false);
      expect(items.get("B")!.edgeReasons[0].message).toMatch(/DIST1 .* \+50%/);
    });

    it("is configurable", () => {
      const items = new Map(runEngine(build(0.6)).items.map((i) => [i.skuId, i]));
      expect(items.get("B")!.isEdge).toBe(false);
    });
  });

  describe("data problems", () => {
    it("missing week: flagged, and the average uses the weeks that exist", () => {
      const values: (number | null)[] = flat(100, 12);
      values[5] = null;
      const i = one(singleSku({ values, onHand: 1000 }));
      // 11 rows of history is also below the 12-week minimum, so both fire
      expect(codes(i)).toEqual(["SHORT_HISTORY", "DATA_MISSING_WEEKS"]);
      expect(i.metrics.missingWeeks).toEqual([windowWeeks(PLAIN_ASOF, 12)[5]]);
      expect(i.metrics.series[5]).toBeNull();
      expect(i.metrics.avg12).toBe(100);
    });

    it("zero or negative week", () => {
      const zero = flat(100, 12);
      zero[3] = 0;
      expect(codes(one(singleSku({ values: zero, onHand: 1000 })))).toContain("DATA_ZERO_DEMAND");
      const neg = flat(100, 12);
      neg[3] = -5;
      expect(codes(one(singleSku({ values: neg, onHand: 1000 })))).toContain("DATA_ZERO_DEMAND");
    });

    it("all-zero demand: no cover, no flags, routed with a clear reason", () => {
      const i = one(singleSku({ values: flat(0, 12), onHand: 1000 }));
      expect(i.metrics.coverWeeks).toBeNull();
      expect(i.flags).toEqual([]);
      expect(i.action).toBe("NO_ACTION");
      expect(i.isEdge).toBe(true);
      expect(i.reason).toMatch(/could not be computed/);
    });

    it("SKU missing from inventory", () => {
      const i = one(singleSku({ values: flat(100, 12), onHand: null }));
      expect(codes(i)).toEqual(["DATA_NO_INVENTORY"]);
      expect(i.metrics.coverWeeks).toBeNull();
      expect(i.action).toBe("NO_ACTION");
    });

    it("SKU with no sales at all does not crash and is routed", () => {
      const input = singleSku({ values: [], onHand: 1000 });
      const i = one(input);
      expect(i.isEdge).toBe(true);
      expect(codes(i)).toEqual(expect.arrayContaining(["SHORT_HISTORY", "DATA_MISSING_WEEKS"]));
      expect(i.metrics.avg12).toBeNull();
    });

    it("stock across locations is summed", () => {
      const input = singleSku({ values: flat(100, 12), onHand: 300 });
      input.inventory.push({ skuId: "S1", unitsOnHand: 300 });
      expect(one(input).metrics.unitsOnHand).toBe(600);
      expect(one(input).flags).toEqual([]); // exactly 6 weeks
    });
  });

  describe("tagged events", () => {
    const weeks = windowWeeks(PLAIN_ASOF, 12);
    const tag = (patch: Partial<EventTag>): EventTag => ({
      id: "E1",
      skuIds: ["S1"],
      startWeek: weeks[9],
      endWeek: weeks[9],
      eventType: "competitor_scheme",
      ...patch,
    });
    const spiky = () => {
      const values = flat(100, 12);
      values[9] = 400;
      return singleSku({ values, onHand: 1000 });
    };

    it("tagged weeks are excluded from the averages and the SKU is routed", () => {
      const untagged = one(spiky());
      expect(untagged.metrics.avg12).toBeGreaterThan(100);
      const i = one({ ...spiky(), events: [tag({})] });
      expect(i.metrics.avg12).toBe(100);
      expect(i.metrics.excludedWeeks).toEqual([weeks[9]]);
      expect(codes(i)).toEqual(["TAGGED_EVENT"]); // the excluded spike no longer counts as an outlier
      expect(i.edgeReasons[0].message).toMatch(/competitor_scheme/);
      expect(i.isEdge).toBe(true);
    });

    it("range is inclusive at both ends", () => {
      const i = one({ ...spiky(), events: [tag({ startWeek: weeks[8], endWeek: weeks[9] })] });
      expect(i.metrics.excludedWeeks).toEqual([weeks[8], weeks[9]]);
    });

    it("matches by SKU, category or distributor, and ignores other SKUs", () => {
      expect(one({ ...spiky(), events: [tag({ skuIds: undefined, categories: ["Snack"] })] }).isEdge).toBe(true);
      expect(one({ ...spiky(), events: [tag({ skuIds: undefined, distributorIds: ["DIST1"] })] }).metrics.excludedWeeks).toHaveLength(1);
      expect(one({ ...spiky(), events: [tag({ skuIds: ["OTHER"] })] }).metrics.excludedWeeks).toEqual([]);
      expect(one({ ...spiky(), events: [tag({ skuIds: ["OTHER"] })] }).edgeReasons.some((r) => r.code === "TAGGED_EVENT")).toBe(false);
    });

    it("a tag outside the window still routes the SKU", () => {
      const i = one({ ...spiky(), events: [tag({ startWeek: "2026-W40", endWeek: "2026-W42" })] });
      expect(i.metrics.excludedWeeks).toEqual([]);
      expect(codes(i)).toContain("TAGGED_EVENT");
    });
  });
});

describe("purity", () => {
  it("does not mutate its input and is deterministic", () => {
    const input = deepFreeze(seedEngineInput());
    const a = runEngine(input);
    const b = runEngine(input);
    expect(b).toEqual(a);
  });
});

import { describe, expect, it } from "vitest";
import {
  compareLoss,
  formatInr,
  formatLakh,
  parseQuarterKey,
  parseRupees,
  previousQuarter,
  quarterKey,
  quarterLabel,
  quarterMonths,
  quarterOfDate,
  recentQuarters,
  todayInIst,
  totalLoss,
} from "@/lib/money";

describe("quarters", () => {
  it("maps dates to calendar quarters", () => {
    expect(quarterOfDate("2026-01-01")).toEqual({ year: 2026, q: 1 });
    expect(quarterOfDate("2026-03-31")).toEqual({ year: 2026, q: 1 });
    expect(quarterOfDate("2026-04-01")).toEqual({ year: 2026, q: 2 });
    expect(quarterOfDate("2026-09-30")).toEqual({ year: 2026, q: 3 });
    expect(quarterOfDate("2026-10-23")).toEqual({ year: 2026, q: 4 });
    expect(quarterOfDate("2026-12-31")).toEqual({ year: 2026, q: 4 });
  });

  it("steps back across year ends", () => {
    expect(previousQuarter({ year: 2026, q: 4 })).toEqual({ year: 2026, q: 3 });
    expect(previousQuarter({ year: 2026, q: 1 })).toEqual({ year: 2025, q: 4 });
    expect(recentQuarters({ year: 2026, q: 2 }, 4).map(quarterKey)).toEqual(["2026-Q2", "2026-Q1", "2025-Q4", "2025-Q3"]);
  });

  it("labels quarters with their months, so no financial-year convention is assumed", () => {
    expect(quarterLabel({ year: 2026, q: 4 })).toBe("Oct–Dec 2026");
    expect(quarterLabel({ year: 2026, q: 1 })).toBe("Jan–Mar 2026");
    expect(quarterMonths({ year: 2026, q: 4 })).toEqual([10, 11, 12]);
  });

  it("round-trips keys and rejects bad ones", () => {
    expect(parseQuarterKey("2026-Q3")).toEqual({ year: 2026, q: 3 });
    for (const bad of ["2026-Q5", "2026-Q0", "26-Q1", "2026Q1", "2026-q1", "", "2026-Q1 "]) expect(parseQuarterKey(bad)).toBeNull();
  });

  it("uses the IST date, not the server's", () => {
    // 20:00 UTC on 31 Dec is already 1 Jan in India
    expect(todayInIst(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
    expect(todayInIst(new Date("2026-10-23T03:30:00Z"))).toBe("2026-10-23");
  });
});

describe("rupee formatting", () => {
  it("uses Indian digit grouping", () => {
    expect(formatInr(1850000)).toBe("₹18,50,000");
    expect(formatInr(0)).toBe("₹0");
    expect(formatInr(999)).toBe("₹999");
    expect(formatInr(12345678)).toBe("₹1,23,45,678");
    expect(formatInr(-250000)).toBe("-₹2,50,000");
  });

  it("shows lakh to two decimals", () => {
    expect(formatLakh(1850000)).toBe("18.50 lakh");
    expect(formatLakh(-250000)).toBe("2.50 lakh");
  });
});

describe("parseRupees", () => {
  it("accepts plain, comma-grouped and ₹-prefixed whole rupees", () => {
    expect(parseRupees("1850000")).toBe(1850000);
    expect(parseRupees("18,50,000")).toBe(1850000);
    expect(parseRupees("₹ 18,50,000")).toBe(1850000);
    expect(parseRupees("  0 ")).toBe(0);
  });

  it("rejects blanks, decimals, negatives, letters and absurd values", () => {
    for (const bad of ["", " ", "12.5", "-100", "1e6", "abc", "10 lakh", "99999999999999999999", "100000000001"]) {
      expect(parseRupees(bad)).toBeNull();
    }
    expect(parseRupees("100000000000")).toBe(100_000_000_000);
  });
});

describe("Rs vs last quarter = last quarter's total loss minus this quarter's", () => {
  const last = { stockoutLossInr: 2_000_000, writeoffLossInr: 1_100_000 }; // 31 lakh
  it("is positive when this quarter lost less (better)", () => {
    const c = compareLoss(last, { stockoutLossInr: 1_500_000, writeoffLossInr: 900_000 });
    expect(c).toEqual({ status: "ok", lastTotal: 3_100_000, thisTotal: 2_400_000, diff: 700_000, direction: "better" });
  });

  it("is negative when this quarter lost more (worse)", () => {
    const c = compareLoss(last, { stockoutLossInr: 2_500_000, writeoffLossInr: 1_000_000 });
    expect(c).toMatchObject({ status: "ok", diff: -400_000, direction: "worse" });
  });

  it("is zero when equal", () => {
    expect(compareLoss(last, last)).toMatchObject({ diff: 0, direction: "same" });
  });

  it("sums stockout and write-off for each quarter", () => {
    expect(totalLoss(last)).toBe(3_100_000);
  });

  it("says what is missing instead of inventing a baseline", () => {
    expect(compareLoss(null, last)).toEqual({ status: "missing", missing: ["last"] });
    expect(compareLoss(last, undefined)).toEqual({ status: "missing", missing: ["this"] });
    expect(compareLoss(null, null)).toEqual({ status: "missing", missing: ["last", "this"] });
  });
});

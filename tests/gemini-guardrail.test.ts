import { describe, expect, it } from "vitest";
import { checkBrief, extractNumbers, MAX_BRIEF_WORDS, numbersInData, wordCount } from "@/lib/gemini/guardrail";

const DATA = {
  sku: { id: "SKU001", name: "Freshroots Mango Drink 200ml", distributorId: "DIST001" },
  windows: { baselineWeeks: 12, recentWeeks: 4, priorWeeks: 8 },
  metrics: { recentAverage: 261, priorAverage: 191.9, baselineAverage: 214.9, stepChangePercent: 36, coverWeeks: 3.35, minimumCoverWeeks: 6 },
  weeklyUnits: [{ week: "2026-W41", units: 258 }, { week: "2026-W42", units: 270 }],
  routingReasons: ["Last-4-week average (261.0) is 36% above the prior 8-week average (191.9); threshold 30%."],
  eventTags: [{ eventType: "competitor_scheme", summary: "Competitor scheme in Pune", startWeek: "2026-W40", endWeek: "2026-W42" }],
};

describe("extractNumbers", () => {
  it("finds integers, decimals, percentages and grouped numbers", () => {
    expect(extractNumbers("261 units, 191.9 prior, 36% up, 1,234 total, 1,00,000 rupees")).toEqual([261, 191.9, 36, 1234, 100000]);
  });

  it("normalises 261.0 to 261 and ignores signs", () => {
    expect(extractNumbers("261.0 and -5%")).toEqual([261, 5]);
  });

  it("reads identifiers and weeks the same way on both sides", () => {
    expect(extractNumbers("SKU001 in 2026-W42")).toEqual([1, 2026, 42]);
  });

  it("catches spelled-out numbers so they cannot slip through", () => {
    expect(extractNumbers("sales doubled over twelve weeks, about half of last year")).toContain(12);
    expect(extractNumbers("sales doubled")).toEqual([2]); // multiplier verbs count too
    expect(extractNumbers("sales tripled and then halved")).toEqual([3, 0.5]);
    expect(extractNumbers("a double jump")).toEqual([2]);
    expect(extractNumbers("Two weeks and three days, a dozen orders")).toEqual([2, 3, 12]);
  });

  it("leaves ordinary prose alone, including 'one'", () => {
    expect(extractNumbers("a one-off spike with no one around")).toEqual([]);
  });
});

describe("numbersInData", () => {
  it("collects numeric values and the digits inside strings", () => {
    const n = numbersInData(DATA);
    for (const x of [261, 191.9, 214.9, 36, 3.35, 12, 4, 8, 258, 270, 2026, 41, 42, 40, 30, 1, 6]) expect(n.has(x)).toBe(true);
    expect(n.has(215)).toBe(false);
    expect(n.has(70)).toBe(false);
  });
});

describe("checkBrief", () => {
  const good = "Recent sales rose to 261 units a week against 191.9 earlier, a 36% change, while the 12-week average is 214.9. A competitor scheme is tagged for 2026-W40 to 2026-W42. Stock covers 3.35 weeks.";

  it("accepts a brief whose every number is in the data", () => {
    expect(checkBrief(good, DATA)).toEqual({ ok: true });
  });

  it("rejects a number that is not in the data, and names it", () => {
    const r = checkBrief("Sales rose to 261 units, about 70 more than before.", DATA);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain("70");
  });

  it("rejects a re-rounded number (215 instead of 214.9)", () => {
    expect(checkBrief("The 12-week average is about 215 units.", DATA).ok).toBe(false);
  });

  it("rejects a number the model derived by calculation", () => {
    expect(checkBrief("Sales are up by 69.1 units a week.", DATA).ok).toBe(false);
  });

  it("rejects spelled-out numbers that are not in the data, accepts ones that are", () => {
    expect(checkBrief("Sales are up about seventy units.", DATA).ok).toBe(false);
    expect(checkBrief("Sales over the last four weeks rose to 261 units.", DATA).ok).toBe(true); // four = 4, which is in the data
    expect(checkBrief("Sales doubled week on week, a double jump.", DATA).ok).toBe(false); // double = 2, not in the data
  });

  it("rejects advice about actions or quantities", () => {
    for (const text of [
      "You should reorder this SKU soon.",
      "I recommend ordering more.",
      "Consider placing an order for 261 units.".replace("Consider placing an order", "Place an order"),
      "Pause the order until the scheme ends.",
      "It must be topped up.",
      "We suggest waiting.",
      "Buy more stock.",
    ]) {
      const r = checkBrief(text, DATA);
      expect(r.ok, text).toBe(false);
    }
  });

  it("does not trip on ordinary words that merely contain 'order' or 'should'", () => {
    expect(checkBrief("Distributor orders fell, and the shoulder weeks look normal.", DATA).ok).toBe(true);
  });

  it("rejects an empty brief and one over the word limit", () => {
    expect(checkBrief("   ", DATA).ok).toBe(false);
    const long = Array.from({ length: MAX_BRIEF_WORDS + 1 }, () => "sales").join(" ");
    expect(wordCount(long)).toBe(MAX_BRIEF_WORDS + 1);
    expect(checkBrief(long, DATA).ok).toBe(false);
    expect(checkBrief(Array.from({ length: MAX_BRIEF_WORDS }, () => "sales").join(" "), DATA).ok).toBe(true);
  });

  it("a brief with no numbers at all is fine", () => {
    expect(checkBrief("Sales jumped recently and the cause is unexplained by the data.", DATA)).toEqual({ ok: true });
  });
});

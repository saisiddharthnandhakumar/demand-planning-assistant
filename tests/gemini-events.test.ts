import { describe, expect, it } from "vitest";
import { EVENT_JSON_SCHEMA, normalizeParsedEvent, tagHasTargets, toEngineTag, type Catalog } from "@/lib/gemini/events";

const CATALOG: Catalog = {
  skus: [
    { id: "SKU001", name: "Freshroots Mango Drink 200ml", category: "Beverage", distributorId: "DIST001" },
    { id: "SKU002", name: "Freshroots Oats Cookies 150g", category: "Snack", distributorId: "DIST001" },
    { id: "SKU003", name: "Freshroots Brown Rice 1kg", category: "Staple", distributorId: "DIST002" },
  ],
  distributors: [
    { id: "DIST001", name: "NutriFlow Distributors", region: "Maharashtra" },
    { id: "DIST002", name: "GrainPath Logistics", region: "Maharashtra" },
  ],
};
const WEEK = "2026-W43";

const base = {
  summary: "Competitor running a scheme on mango drinks.",
  eventType: "competitor_scheme",
  skuIds: ["SKU001"],
  categories: [] as string[],
  distributorIds: [] as string[],
  startWeek: "2026-W43",
  endWeek: "2026-W44",
  confidence: "medium",
  notUnderstood: [] as string[],
};

const ok = (raw: unknown) => {
  const r = normalizeParsedEvent(raw, CATALOG, WEEK);
  if (!r.ok) throw new Error(r.error);
  return r.tag;
};

describe("normalizeParsedEvent", () => {
  it("accepts a clean answer unchanged, with no warnings", () => {
    const expected: Partial<typeof base> = { ...base };
    delete expected.notUnderstood; // it becomes warnings
    expect(ok(base)).toEqual({ ...expected, warnings: [] });
  });

  it("drops SKU ids that do not exist, and says so (never silently)", () => {
    const t = ok({ ...base, skuIds: ["SKU001", "SKU999", "sku002"] });
    expect(t.skuIds).toEqual(["SKU001", "SKU002"]); // sku002 matched case-insensitively
    expect(t.warnings).toEqual(['Ignored SKU id(s) that do not exist: "SKU999".']);
  });

  it("drops unknown categories and distributors, and matches case-insensitively", () => {
    const t = ok({ ...base, skuIds: [], categories: ["beverage", "Frozen"], distributorIds: ["dist002", "DIST777"] });
    expect(t.categories).toEqual(["Beverage"]);
    expect(t.distributorIds).toEqual(["DIST002"]);
    expect(t.warnings.join(" ")).toContain('"Frozen"');
    expect(t.warnings.join(" ")).toContain('"DIST777"');
  });

  it("de-duplicates ids", () => {
    expect(ok({ ...base, skuIds: ["SKU001", "SKU001", "sku001"] }).skuIds).toEqual(["SKU001"]);
  });

  describe("weeks", () => {
    it("defaults to the current week, with a warning, when the note gives no timing", () => {
      const t = ok({ ...base, startWeek: null, endWeek: null });
      expect([t.startWeek, t.endWeek]).toEqual([WEEK, WEEK]);
      expect(t.warnings.join(" ")).toContain("current week (2026-W43)");
    });

    it("fills a missing end from the start, and a missing start from the end", () => {
      expect(ok({ ...base, startWeek: "2026-W45", endWeek: null })).toMatchObject({ startWeek: "2026-W45", endWeek: "2026-W45" });
      expect(ok({ ...base, startWeek: null, endWeek: "2026-W45" })).toMatchObject({ startWeek: "2026-W45", endWeek: "2026-W45" });
    });

    it("ignores weeks that are not real ISO weeks, with a warning", () => {
      const t = ok({ ...base, startWeek: "next Tuesday", endWeek: "2025-W53" });
      expect([t.startWeek, t.endWeek]).toEqual([WEEK, WEEK]);
      expect(t.warnings.join(" ")).toContain("not a valid ISO week");
    });

    it("swaps a start that is after the end, with a warning", () => {
      const t = ok({ ...base, startWeek: "2026-W46", endWeek: "2026-W44" });
      expect([t.startWeek, t.endWeek]).toEqual(["2026-W44", "2026-W46"]);
      expect(t.warnings.join(" ")).toContain("swapped");
    });

    it("works across a year end", () => {
      expect(ok({ ...base, startWeek: "2026-W52", endWeek: "2027-W01" })).toMatchObject({ startWeek: "2026-W52", endWeek: "2027-W01" });
    });
  });

  it("warns when nothing in the note could be matched, and the tag has no targets", () => {
    const t = ok({ ...base, skuIds: ["SKU999"], categories: [], distributorIds: [] });
    expect(tagHasTargets(t)).toBe(false);
    expect(t.warnings.join(" ")).toContain("would not affect anything");
  });

  it("carries over what the model could not represent", () => {
    const t = ok({ ...base, notUnderstood: ["Pune is a region, not a SKU or distributor"] });
    expect(t.warnings).toContain("Not represented: Pune is a region, not a SKU or distributor");
  });

  it("rejects answers that are not in the expected shape", () => {
    for (const bad of [null, "text", {}, { ...base, eventType: "alien_invasion" }, { ...base, confidence: "certain" }, { ...base, skuIds: "SKU001" }, { ...base, summary: "" }, { ...base, startWeek: 5 }]) {
      const r = normalizeParsedEvent(bad, CATALOG, WEEK);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      expect(!r.ok && r.error).toContain("expected format");
    }
  });
});

describe("tags and the engine", () => {
  it("a tag with any target can be confirmed", () => {
    expect(tagHasTargets({ skuIds: ["SKU001"], categories: [], distributorIds: [] })).toBe(true);
    expect(tagHasTargets({ skuIds: [], categories: ["Snack"], distributorIds: [] })).toBe(true);
    expect(tagHasTargets({ skuIds: [], categories: [], distributorIds: ["DIST001"] })).toBe(true);
    expect(tagHasTargets({ skuIds: [], categories: [], distributorIds: [] })).toBe(false);
  });

  it("converts to the engine's tag shape", () => {
    const t = ok(base);
    expect(toEngineTag("note-1", t)).toEqual({
      id: "note-1",
      skuIds: ["SKU001"],
      categories: [],
      distributorIds: [],
      startWeek: "2026-W43",
      endWeek: "2026-W44",
      eventType: "competitor_scheme",
    });
  });
});

describe("the schema sent to Gemini", () => {
  it("requires every field and only uses the supported JSON-schema subset", () => {
    expect([...EVENT_JSON_SCHEMA.required].sort()).toEqual(Object.keys(EVENT_JSON_SCHEMA.properties).sort());
    expect(EVENT_JSON_SCHEMA.properties.startWeek.type).toEqual(["string", "null"]);
    expect(EVENT_JSON_SCHEMA.properties.eventType.enum).toContain("competitor_scheme");
  });
});

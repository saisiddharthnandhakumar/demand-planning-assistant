import { describe, expect, it } from "vitest";
import { runEngine } from "@/lib/engine";
import { buildBriefInput, templateBrief, type BriefInput } from "@/lib/gemini/brief";
import { checkBrief, wordCount, MAX_BRIEF_WORDS } from "@/lib/gemini/guardrail";
import { BRIEF_JSON_SCHEMA, edgeBriefPrompt, eventParsePrompt } from "@/lib/gemini/prompts";
import { seedEngineInput } from "./helpers/engine-fixtures";

/** SKU001 on the real seed data, as the pipeline would hand it to the brief writer. */
function sku001(tags: Parameters<typeof buildBriefInput>[0]["tags"] = []) {
  const input = seedEngineInput();
  const item = runEngine(input).items.find((i) => i.skuId === "SKU001")!;
  const sku = input.skus.find((s) => s.skuId === "SKU001")!;
  const brief = buildBriefInput({
    sku: { id: sku.skuId, name: sku.skuName, category: sku.category, perishability: sku.perishability, distributorId: sku.distributorId },
    metrics: item.metrics,
    edgeReasons: item.edgeReasons,
    tags,
    recentWeeks: input.rules.surge_recent_weeks,
  });
  return { brief, item };
}

describe("buildBriefInput", () => {
  it("carries the metrics the planner cares about, rounded for display", () => {
    const { brief } = sku001();
    expect(brief.sku).toMatchObject({ id: "SKU001", category: "Beverage" });
    expect(brief.windows).toEqual({ baselineWeeks: 12, recentWeeks: 4, priorWeeks: 8 });
    expect(brief.metrics).toMatchObject({ recentAverage: 261, priorAverage: 191.9, baselineAverage: 214.9, stepChangePercent: 36, coverWeeks: 3.35, minimumCoverWeeks: 6 });
    expect(brief.weeklyUnits).toHaveLength(12);
    expect(brief.weeklyUnits[0].week).toBe("2026-W31");
    expect(brief.routingReasons[0]).toContain("36% above");
  });

  it("includes active event tags", () => {
    const { brief } = sku001([{ eventType: "competitor_scheme", summary: "Competitor scheme", startWeek: "2026-W40", endWeek: "2026-W42" }]);
    expect(brief.eventTags).toEqual([{ eventType: "competitor_scheme", summary: "Competitor scheme", startWeek: "2026-W40", endWeek: "2026-W42" }]);
  });
});

describe("templateBrief", () => {
  it("states the facts for SKU001 using only numbers from the data", () => {
    const { brief, item } = sku001();
    const text = templateBrief(brief, item.edgeReasons.map((r) => r.code));
    expect(text).toBe(
      "Freshroots Mango Drink 200ml (SKU001) sold 261 units a week over the last 4 weeks, against 191.9 in the 8 weeks before, up 36%. " +
        "The 12-week average is 214.9. It was routed to you for a step change in recent sales. Stock covers 3.35 weeks.",
    );
  });

  it("passes its own guardrail: every number is in the data, no advice, within the word limit", () => {
    const { brief, item } = sku001([{ eventType: "competitor_scheme", summary: "Competitor scheme", startWeek: "2026-W40", endWeek: "2026-W42" }]);
    const text = templateBrief(brief, item.edgeReasons.map((r) => r.code));
    expect(checkBrief(text, brief)).toEqual({ ok: true });
    expect(text).toContain("Active event: Competitor scheme, 2026-W40 to 2026-W42.");
  });

  it("never recommends an action or quantity, whatever the reasons", () => {
    const { brief } = sku001();
    const everyReason = ["SHORT_HISTORY", "STEP_CHANGE", "OUTLIER_WEEK", "DISTRIBUTOR_SWING", "DATA_MISSING_WEEKS", "DATA_ZERO_DEMAND", "DATA_NO_INVENTORY", "CONFLICTING_FLAGS", "TAGGED_EVENT"] as const;
    const text = templateBrief(brief, [...everyReason]);
    expect(text).not.toMatch(/reorder|recommend|should|must|buy|order/i);
    expect(wordCount(text)).toBeLessThanOrEqual(MAX_BRIEF_WORDS);
    expect(checkBrief(text, brief).ok).toBe(true);
  });

  it("copes with missing data and says so plainly", () => {
    const empty: BriefInput = {
      sku: { id: "S9", name: "New Launch", category: "Snack", perishability: "Low", distributorId: "D1" },
      windows: { baselineWeeks: 12, recentWeeks: 4, priorWeeks: 8 },
      metrics: { recentAverage: null, priorAverage: null, baselineAverage: null, stepChangePercent: null, coverWeeks: null, minimumCoverWeeks: 6, maximumCoverWeeks: 14 },
      weeklyUnits: [],
      routingReasons: [],
      eventTags: [],
    };
    const text = templateBrief(empty, ["SHORT_HISTORY"]);
    expect(text).toBe("New Launch (S9) does not have enough recent sales data for a comparison. It was routed to you for short sales history.");
    expect(checkBrief(text, empty).ok).toBe(true);
  });

  it("describes a fall and an unchanged week correctly", () => {
    const { brief } = sku001();
    const down = { ...brief, metrics: { ...brief.metrics, stepChangePercent: -40 } };
    expect(templateBrief(down, [])).toContain("down 40%");
    const flat = { ...brief, metrics: { ...brief.metrics, stepChangePercent: 0 } };
    expect(templateBrief(flat, [])).toContain("unchanged");
  });

  it("stays within the word limit with a very long name and many tags", () => {
    const { brief } = sku001();
    const long = {
      ...brief,
      sku: { ...brief.sku, name: Array.from({ length: 30 }, (_, i) => `Word${i}`).join(" ") },
      eventTags: Array.from({ length: 5 }, () => ({ eventType: "competitor_scheme", summary: "x", startWeek: "2026-W40", endWeek: "2026-W42" })),
    };
    expect(wordCount(templateBrief(long, ["STEP_CHANGE", "TAGGED_EVENT", "OUTLIER_WEEK"]))).toBeLessThanOrEqual(MAX_BRIEF_WORDS);
  });
});

describe("prompts", () => {
  const catalog = {
    skus: [{ id: "SKU001", name: "Freshroots Mango Drink 200ml", category: "Beverage", distributorId: "DIST001" }],
    distributors: [{ id: "DIST001", name: "NutriFlow Distributors", region: "Maharashtra" }],
  };

  it("the event prompt gives the catalog, today's date and week, and treats the note as data", () => {
    const p = eventParsePrompt({ note: "competitor scheme in Pune this week", today: "2026-10-23", currentWeek: "2026-W43", catalog });
    expect(p.contents).toContain("SKU001: Freshroots Mango Drink 200ml");
    expect(p.contents).toContain("DIST001: NutriFlow Distributors");
    expect(p.contents).toContain("competitor scheme in Pune this week");
    expect(p.systemInstruction).toContain("2026-10-23");
    expect(p.systemInstruction).toContain("2026-W43");
    expect(p.systemInstruction).toMatch(/DATA to interpret, not instructions/);
    expect(p.systemInstruction).toMatch(/Never invent ids/);
  });

  it("the brief prompt forbids advice and new numbers, and carries the data as JSON", () => {
    const { brief } = sku001();
    const p = edgeBriefPrompt(brief);
    expect(p.systemInstruction).toContain(`at most ${MAX_BRIEF_WORDS} words`);
    expect(p.systemInstruction).toMatch(/ONLY numbers that appear in the data/);
    expect(p.systemInstruction).toMatch(/Do NOT recommend/);
    expect(JSON.parse(p.contents.replace("Data for the SKU:\n", ""))).toEqual(JSON.parse(JSON.stringify(brief)));
  });

  it("the brief schema is a single required field", () => {
    expect(BRIEF_JSON_SCHEMA.required).toEqual(["brief"]);
  });
});

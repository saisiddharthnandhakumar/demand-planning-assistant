import { describe, expect, it } from "vitest";
import { INITIAL_RULES } from "@/lib/rules";
import {
  RULE_FIELDS,
  formatRuleValue,
  parseRulesForm,
  ruleLabel,
  rulesToInputValues,
} from "@/lib/rules-form";

describe("rules form", () => {
  it("covers every field of the rules document exactly once", () => {
    const leafPaths: string[] = [];
    const walk = (o: Record<string, unknown>, prefix = "") => {
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === "object") walk(v as Record<string, unknown>, `${prefix}${k}.`);
        else leafPaths.push(`${prefix}${k}`);
      }
    };
    walk(INITIAL_RULES);
    expect(RULE_FIELDS.map((f) => f.path).sort()).toEqual(leafPaths.sort());
  });

  it("shows percentages as whole percents and round-trips to the same document", () => {
    const values = rulesToInputValues(INITIAL_RULES);
    expect(values.surge_threshold).toBe("20");
    expect(values.festival_uplift).toBe("25");
    expect(values["edge.step_change_threshold"]).toBe("30");
    expect(values["kill.override_rate_threshold"]).toBe("30");
    expect(values.stockout_weeks).toBe("6");
    expect(values["perishable.max_weeks"]).toBe("4");
    const parsed = parseRulesForm(values);
    expect(parsed).toEqual({ ok: true, rules: INITIAL_RULES });
  });

  it("converts an edited percent back to a fraction without float noise", () => {
    const parsed = parseRulesForm({ ...rulesToInputValues(INITIAL_RULES), surge_threshold: "35", festival_uplift: "7" });
    expect(parsed.ok && parsed.rules.surge_threshold).toBe(0.35);
    expect(parsed.ok && parsed.rules.festival_uplift).toBe(0.07);
  });

  it("reports blank and non-numeric fields by name", () => {
    const parsed = parseRulesForm({ ...rulesToInputValues(INITIAL_RULES), stockout_weeks: "", "edge.outlier_zscore": "abc" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.stockout_weeks).toMatch(/number/);
    expect(parsed.errors["edge.outlier_zscore"]).toMatch(/number/);
  });

  it("requires whole numbers for week counts", () => {
    const parsed = parseRulesForm({ ...rulesToInputValues(INITIAL_RULES), baseline_weeks: "12.5" });
    expect(!parsed.ok && parsed.errors.baseline_weeks).toMatch(/whole number/);
  });

  it("surfaces cross-field rule errors on the right field", () => {
    const values = rulesToInputValues(INITIAL_RULES);
    const a = parseRulesForm({ ...values, stockout_weeks: "20" });
    expect(!a.ok && a.errors.stockout_weeks).toMatch(/stockout limit must be smaller than the overstock limit/);
    const b = parseRulesForm({ ...values, "perishable.min_weeks": "5" });
    expect(!b.ok && b.errors["perishable.min_weeks"]).toBeTruthy();
    const c = parseRulesForm({ ...values, surge_recent_weeks: "12" });
    expect(!c.ok && c.errors.surge_recent_weeks).toBeTruthy();
  });

  it("rejects out-of-range values", () => {
    const values = rulesToInputValues(INITIAL_RULES);
    expect(parseRulesForm({ ...values, "kill.override_rate_threshold": "150" }).ok).toBe(false);
    expect(parseRulesForm({ ...values, surge_threshold: "-5" }).ok).toBe(false);
    expect(parseRulesForm({ ...values, surge_reorder_multiplier: "0" }).ok).toBe(false);
  });

  it("formats values and labels for the history view", () => {
    expect(formatRuleValue("surge_threshold", 0.2)).toBe("20%");
    expect(formatRuleValue("stockout_weeks", 6)).toBe("6");
    expect(ruleLabel("edge.outlier_zscore")).toBe("Outlier z-score");
    expect(ruleLabel("unknown.path")).toBe("unknown.path");
  });
});

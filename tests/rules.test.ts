import { describe, expect, it } from "vitest";
import { INITIAL_RULES, rulesSchema } from "@/lib/rules";

describe("rules schema", () => {
  it("accepts the initial rules from the brief, exactly", () => {
    expect(rulesSchema.parse(INITIAL_RULES)).toEqual({
      surge_threshold: 0.2,
      surge_recent_weeks: 4,
      baseline_weeks: 12,
      surge_reorder_multiplier: 1.5,
      stockout_weeks: 6,
      overstock_weeks: 14,
      festival_uplift: 0.25,
      perishable: { min_weeks: 3, max_weeks: 4 },
      edge: {
        min_history_weeks: 12,
        step_change_threshold: 0.3,
        outlier_zscore: 2.5,
        distributor_swing_threshold: 0.3,
      },
      kill: { override_rate_threshold: 0.3, consecutive_runs: 2 },
    });
  });

  const bad = (patch: Record<string, unknown>) =>
    rulesSchema.safeParse({ ...INITIAL_RULES, ...patch }).success;

  it("rejects inconsistent windows and limits", () => {
    expect(bad({ stockout_weeks: 14 })).toBe(false);
    expect(bad({ surge_recent_weeks: 12 })).toBe(false);
    expect(bad({ perishable: { min_weeks: 4, max_weeks: 4 } })).toBe(false);
  });

  it("rejects bad values, unknown keys and missing keys", () => {
    expect(bad({ surge_threshold: -0.1 })).toBe(false);
    expect(bad({ baseline_weeks: 12.5 })).toBe(false);
    expect(bad({ kill: { override_rate_threshold: 1.5, consecutive_runs: 2 } })).toBe(false);
    expect(bad({ surprise: 1 })).toBe(false);
    const missing: Record<string, unknown> = { ...INITIAL_RULES };
    delete missing.festival_uplift;
    expect(rulesSchema.safeParse(missing).success).toBe(false);
  });
});

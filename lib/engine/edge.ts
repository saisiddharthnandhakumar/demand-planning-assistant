import type { Rules } from "@/lib/rules";
import { pct, num1 } from "./format";
import type { EdgeReason, EventTag, Flag, SkuInput, SkuMetrics } from "./types";

/**
 * Relative change in a distributor's total weekly sales between the recent
 * window and the prior window: (sum of SKU avg4 - sum of SKU prior8) / sum of
 * prior8. Null when there is nothing to compare.
 */
export function distributorSwings(
  entries: readonly { sku: SkuInput; metrics: SkuMetrics }[],
): Map<string, number | null> {
  const totals = new Map<string, { recent: number; prior: number }>();
  for (const { sku, metrics } of entries) {
    if (metrics.avg4 === null || metrics.prior8 === null) continue;
    const t = totals.get(sku.distributorId) ?? { recent: 0, prior: 0 };
    t.recent += metrics.avg4;
    t.prior += metrics.prior8;
    totals.set(sku.distributorId, t);
  }
  const swings = new Map<string, number | null>();
  for (const [id, t] of totals) swings.set(id, t.prior > 0 ? (t.recent - t.prior) / t.prior : null);
  return swings;
}

/**
 * Deterministic checks for what needs the planner's judgment. A SKU is an edge
 * case if ANY of these fire. Every message uses only computed numbers.
 */
export function detectEdgeReasons(args: {
  sku: SkuInput;
  metrics: SkuMetrics;
  flags: readonly Flag[];
  /** Swing for this SKU's distributor (see distributorSwings), if computable. */
  distributorSwing: number | null;
  /** Active event tags covering this SKU. */
  tags: readonly EventTag[];
  rules: Rules;
}): EdgeReason[] {
  const { sku, metrics: m, flags, distributorSwing, tags, rules } = args;
  const e = rules.edge;
  const reasons: EdgeReason[] = [];

  if (m.historyWeeks < e.min_history_weeks) {
    reasons.push({
      code: "SHORT_HISTORY",
      message: `Only ${m.historyWeeks} weeks of sales history (minimum ${e.min_history_weeks}).`,
    });
  }

  if (m.stepChange !== null && Math.abs(m.stepChange) > e.step_change_threshold) {
    reasons.push({
      code: "STEP_CHANGE",
      message:
        `Last-${rules.surge_recent_weeks}-week average (${num1(m.avg4!)}) is ` +
        `${pct(Math.abs(m.stepChange))}% ${m.stepChange > 0 ? "above" : "below"} the prior ` +
        `${rules.baseline_weeks - rules.surge_recent_weeks}-week average (${num1(m.prior8!)}); ` +
        `threshold ${pct(e.step_change_threshold)}%.`,
    });
  }

  if (m.maxZ > e.outlier_zscore) {
    reasons.push({
      code: "OUTLIER_WEEK",
      message:
        `Week ${m.maxZWeek} is ${num1(m.maxZ)} standard deviations from the ` +
        `${rules.baseline_weeks}-week mean (threshold ${e.outlier_zscore}).`,
    });
  }

  if (distributorSwing !== null && Math.abs(distributorSwing) > e.distributor_swing_threshold) {
    reasons.push({
      code: "DISTRIBUTOR_SWING",
      message:
        `Distributor ${sku.distributorId} total weekly sales changed ${distributorSwing > 0 ? "+" : "-"}` +
        `${pct(Math.abs(distributorSwing))}% between the recent and prior windows ` +
        `(threshold ${pct(e.distributor_swing_threshold)}%).`,
    });
  }

  if (m.missingWeeks.length > 0) {
    reasons.push({
      code: "DATA_MISSING_WEEKS",
      message: `No sales recorded for week(s): ${m.missingWeeks.join(", ")}.`,
    });
  }

  if (m.zeroWeeks.length > 0 || (m.avg12 !== null && m.avg12 <= 0)) {
    reasons.push({
      code: "DATA_ZERO_DEMAND",
      message:
        m.zeroWeeks.length > 0
          ? `Zero or negative sales in week(s): ${m.zeroWeeks.join(", ")}.`
          : `Average weekly sales are zero or negative.`,
    });
  }

  if (m.unitsOnHand === null) {
    reasons.push({ code: "DATA_NO_INVENTORY", message: "No inventory record for this SKU." });
  }

  if (flags.includes("HIGH_DEMAND") && flags.includes("OVERSTOCK_RISK")) {
    reasons.push({
      code: "CONFLICTING_FLAGS",
      message: "High-demand and overstock flags fire together.",
    });
  }

  if (tags.length > 0) {
    reasons.push({
      code: "TAGGED_EVENT",
      message:
        `Active event tag(s) cover this SKU: ${tags.map((t) => t.summary || t.eventType || t.id).join("; ")}.` +
        (m.excludedWeeks.length
          ? ` Tagged week(s) excluded from averages: ${m.excludedWeeks.join(", ")}.`
          : ""),
    });
  }

  return reasons;
}

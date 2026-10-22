import type { Rules } from "@/lib/rules";
import type { Action, Flag, SkuInput, SkuMetrics } from "./types";

/**
 * Flags and the action the documented rules produce. All limits come from
 * `metrics` (set from the rules by perishability) and `rules`; comparisons are
 * strict, so exactly 6.0 weeks of cover is NOT a stockout.
 *
 * Quantities are whole units: 1.5x standard is rounded half up.
 */
export function evaluateFlags(
  metrics: SkuMetrics,
  sku: SkuInput,
  rules: Rules,
): { flags: Flag[]; action: Action; qty: number } {
  const flags: Flag[] = [];
  const highDemand = metrics.surge !== null && metrics.surge > rules.surge_threshold;
  if (highDemand) flags.push("HIGH_DEMAND");

  const cover = metrics.coverWeeks;
  const stockout = cover !== null && cover < metrics.minWeeks;
  const overstock = cover !== null && cover > metrics.maxWeeks;
  if (stockout) flags.push("STOCKOUT_RISK");
  if (overstock) flags.push("OVERSTOCK_RISK");

  const surgeQty = Math.round(sku.standardReorderQty * rules.surge_reorder_multiplier);

  if (stockout) {
    return { flags, action: "REORDER_NOW", qty: highDemand ? surgeQty : sku.standardReorderQty };
  }
  if (overstock) return { flags, action: "PAUSE_ORDER", qty: 0 };
  if (highDemand) return { flags, action: "REORDER", qty: surgeQty };
  return { flags, action: "NO_ACTION", qty: 0 };
}

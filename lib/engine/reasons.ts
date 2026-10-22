import type { Rules } from "@/lib/rules";
import { pct, num1 } from "./format";
import type { Action, Flag, SkuInput, SkuMetrics } from "./types";

/**
 * Plain-language reason built from a template using only computed numbers.
 * No AI involved. Example:
 * "Stock covers 3.4 weeks (festival uplift +25% applied) against a 6-week
 * minimum. Last-4-week sales are 21% above the 12-week average."
 */
export function buildReason(args: {
  metrics: SkuMetrics;
  flags: readonly Flag[];
  action: Action;
  sku: SkuInput;
  rules: Rules;
}): string {
  const { metrics: m, flags, sku, rules } = args;
  if (m.coverWeeks === null) {
    return "Cover could not be computed from the available sales and stock data.";
  }

  const uplift = m.uplift > 0 ? ` (festival uplift +${pct(m.uplift)}% applied)` : "";
  const cover = `Stock covers ${num1(m.coverWeeks)} weeks${uplift}`;
  const parts: string[] = [];

  if (flags.includes("STOCKOUT_RISK")) {
    parts.push(`${cover} against a ${m.minWeeks}-week minimum.`);
  } else if (flags.includes("OVERSTOCK_RISK")) {
    parts.push(`${cover} against a ${m.maxWeeks}-week maximum.`);
  } else {
    parts.push(`${cover}, within the ${m.minWeeks} to ${m.maxWeeks} week range.`);
  }

  if (flags.includes("HIGH_DEMAND") && m.surge !== null) {
    parts.push(
      `Last-${rules.surge_recent_weeks}-week sales are ${pct(m.surge)}% above the ` +
        `${rules.baseline_weeks}-week average.`,
    );
    if (!flags.includes("OVERSTOCK_RISK")) {
      parts.push(
        `Quantity is ${rules.surge_reorder_multiplier}x the standard ${sku.standardReorderQty}.`,
      );
    }
  }

  return parts.join(" ");
}

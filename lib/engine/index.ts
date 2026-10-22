import { detectEdgeReasons, distributorSwings } from "./edge";
import { excludedWeeks, tagsForSku } from "./events";
import { evaluateFlags } from "./flags";
import { computeSkuMetrics, lastCompleteWeek, upliftFor, windowWeeks } from "./metrics";
import { buildReason } from "./reasons";
import type { EngineInput, EngineItem, EngineResult } from "./types";

export * from "./types";
export { lastCompleteWeek, windowWeeks } from "./metrics";

/**
 * Runs the whole engine. Pure: no database, network, clock or randomness, and
 * the input is never mutated. The same input always gives the same result.
 */
export function runEngine(input: EngineInput): EngineResult {
  const { asOfDate, skus, sales, inventory, calendar, rules } = input;
  const events = input.events ?? [];

  const uplift = upliftFor(asOfDate, calendar, rules);
  const weeks = windowWeeks(asOfDate, rules.baseline_weeks);

  const salesBySku = new Map<string, Map<string, number>>();
  for (const row of sales) {
    if (!salesBySku.has(row.skuId)) salesBySku.set(row.skuId, new Map());
    salesBySku.get(row.skuId)!.set(row.isoWeek, row.units);
  }

  const stockBySku = new Map<string, number>();
  for (const row of inventory) {
    stockBySku.set(row.skuId, (stockBySku.get(row.skuId) ?? 0) + row.unitsOnHand);
  }

  // Pass 1: metrics per SKU
  const perSku = skus.map((sku) => {
    const tags = tagsForSku(events, sku);
    const metrics = computeSkuMetrics({
      sku,
      salesByWeek: salesBySku.get(sku.skuId) ?? new Map(),
      unitsOnHand: stockBySku.has(sku.skuId) ? stockBySku.get(sku.skuId)! : null,
      asOfDate,
      uplift,
      rules,
      excludedWeeks: excludedWeeks(tags, weeks),
    });
    return { sku, tags, metrics };
  });

  // Pass 2: distributor-level swing needs every SKU's metrics
  const swings = distributorSwings(perSku);

  const items: EngineItem[] = perSku.map(({ sku, tags, metrics }) => {
    const { flags, action, qty } = evaluateFlags(metrics, sku, rules);
    const edgeReasons = detectEdgeReasons({
      sku,
      metrics,
      flags,
      distributorSwing: swings.get(sku.distributorId) ?? null,
      tags,
      rules,
    });
    return {
      skuId: sku.skuId,
      metrics,
      flags,
      action,
      qty,
      reason: buildReason({ metrics, flags, action, sku, rules }),
      isEdge: edgeReasons.length > 0,
      edgeReasons,
    };
  });

  return {
    asOfDate,
    lastCompleteWeek: lastCompleteWeek(asOfDate),
    uplift,
    items,
    summary: {
      skus: items.length,
      stockout: items.filter((i) => i.flags.includes("STOCKOUT_RISK")).length,
      overstock: items.filter((i) => i.flags.includes("OVERSTOCK_RISK")).length,
      highDemand: items.filter((i) => i.flags.includes("HIGH_DEMAND")).length,
      noAction: items.filter((i) => i.action === "NO_ACTION").length,
      edge: items.filter((i) => i.isEdge).length,
    },
  };
}

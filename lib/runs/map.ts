import type { runItems } from "@/lib/db/schema";
import type { EngineItem } from "@/lib/engine/types";

export type RunItemRow = typeof runItems.$inferInsert;

/**
 * One engine result as a run_items row. For edge SKUs recommended_action and
 * recommended_qty hold what the rules WOULD have said, for reference only;
 * is_edge tells the UI to label them that way and never present them as a
 * recommendation. Raghav's decision goes in final_action / final_qty.
 */
export function engineItemToRow(runId: string, item: EngineItem): RunItemRow {
  return {
    runId,
    skuId: item.skuId,
    metrics: item.metrics,
    flags: [...item.flags],
    recommendedAction: item.action,
    recommendedQty: item.qty,
    reason: item.reason,
    isEdge: item.isEdge,
    edgeReasons: item.edgeReasons.map((r) => ({ ...r })),
    decisionStatus: "pending",
  };
}

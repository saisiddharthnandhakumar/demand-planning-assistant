import type { InferSelectModel } from "drizzle-orm";
import type { runItems } from "@/lib/db/schema";
import type { DecisionStatus } from "@/lib/decisions";
import type { Action, EdgeReason, Flag } from "@/lib/engine/types";

/** One SKU of a run as the review screen needs it (plain, serialisable data). */
export interface RunItemView {
  skuId: string;
  skuName: string;
  category: string;
  perishability: "High" | "Low";
  standardReorderQty: number;
  flags: Flag[];
  coverWeeks: number | null;
  minWeeks: number;
  maxWeeks: number;
  avg12: number | null;
  avg4: number | null;
  prior8: number | null;
  windowWeeks: string[];
  series: (number | null)[];
  excludedWeeks: string[];
  recommendedAction: Action;
  recommendedQty: number;
  reason: string;
  isEdge: boolean;
  edgeReasons: EdgeReason[];
  decisionStatus: DecisionStatus;
  finalAction: Action | null;
  finalQty: number | null;
  overrideReason: string | null;
  overrideNote: string | null;
}

type Row = {
  item: InferSelectModel<typeof runItems>;
  skuName: string;
  category: string;
  perishability: "High" | "Low";
  standardReorderQty: number;
};

export function toItemView({ item, skuName, category, perishability, standardReorderQty }: Row): RunItemView {
  const m = item.metrics;
  return {
    skuId: item.skuId,
    skuName,
    category,
    perishability,
    standardReorderQty,
    flags: item.flags as Flag[],
    coverWeeks: m.coverWeeks,
    minWeeks: m.minWeeks,
    maxWeeks: m.maxWeeks,
    avg12: m.avg12,
    avg4: m.avg4,
    prior8: m.prior8,
    windowWeeks: m.windowWeeks,
    series: m.series,
    excludedWeeks: m.excludedWeeks,
    recommendedAction: (item.recommendedAction ?? "NO_ACTION") as Action,
    recommendedQty: item.recommendedQty ?? 0,
    reason: item.reason ?? "",
    isEdge: item.isEdge,
    edgeReasons: item.edgeReasons,
    decisionStatus: item.decisionStatus,
    finalAction: item.finalAction as Action | null,
    finalQty: item.finalQty,
    overrideReason: item.overrideReason,
    overrideNote: item.overrideNote,
  };
}

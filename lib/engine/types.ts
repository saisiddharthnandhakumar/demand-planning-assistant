import type { Rules } from "@/lib/rules";

export type Perishability = "High" | "Low";

export interface SkuInput {
  skuId: string;
  skuName: string;
  category: string;
  perishability: Perishability;
  standardReorderQty: number;
  distributorId: string;
}

export interface SalesRow {
  skuId: string;
  isoWeek: string; // e.g. 2026-W42
  units: number;
}

/** Stock snapshot rows; the caller picks the snapshot. Multiple locations are summed. */
export interface InventoryRow {
  skuId: string;
  unitsOnHand: number;
}

export interface CalendarRow {
  year: number;
  month: number;
  isFestivalMonth: boolean;
}

/**
 * A confirmed, active event tag (see M7). Tagged weeks inside the metric
 * windows are excluded from the averages and the SKU is routed to the planner.
 */
export interface EventTag {
  id: string;
  skuIds?: string[];
  categories?: string[];
  distributorIds?: string[];
  startWeek: string; // inclusive, e.g. 2026-W40
  endWeek: string; // inclusive
  eventType?: string;
  /** A short human description, shown in briefs and the UI. Never used for any decision. */
  summary?: string;
}

export interface EngineInput {
  /** "YYYY-MM-DD". The last complete sales week is the week before this date's ISO week. */
  asOfDate: string;
  skus: SkuInput[];
  sales: SalesRow[];
  inventory: InventoryRow[];
  calendar: CalendarRow[];
  rules: Rules;
  events?: EventTag[];
}

export interface SkuMetrics {
  asOfDate: string;
  lastCompleteWeek: string;
  /** The baseline window, oldest to newest, e.g. W31..W42. */
  windowWeeks: string[];
  /** Raw units per window week; null when the week has no sales row. */
  series: (number | null)[];
  /** Window weeks excluded from the averages because an event tag covers them. */
  excludedWeeks: string[];
  missingWeeks: string[];
  /** Window weeks with zero or negative units. */
  zeroWeeks: string[];
  /** Weeks of sales history available up to the last complete week. */
  historyWeeks: number;
  avg12: number | null;
  avg4: number | null;
  prior8: number | null;
  /** avg4 / avg12 - 1, from raw actuals (no uplift). */
  surge: number | null;
  /** (avg4 - prior8) / prior8, signed. */
  stepChange: number | null;
  /** 0.25 in a festival month, otherwise 0. Applies to cover only, never to surge. */
  uplift: number;
  demandForCover: number | null;
  unitsOnHand: number | null;
  coverWeeks: number | null;
  minWeeks: number;
  maxWeeks: number;
  /** Largest |z| over the window (sample standard deviation) and the week it occurs in. */
  maxZ: number;
  maxZWeek: string | null;
}

export type Flag = "HIGH_DEMAND" | "STOCKOUT_RISK" | "OVERSTOCK_RISK";
export type Action = "REORDER_NOW" | "REORDER" | "PAUSE_ORDER" | "NO_ACTION";

export type EdgeCode =
  | "SHORT_HISTORY"
  | "STEP_CHANGE"
  | "OUTLIER_WEEK"
  | "DISTRIBUTOR_SWING"
  | "DATA_MISSING_WEEKS"
  | "DATA_ZERO_DEMAND"
  | "DATA_NO_INVENTORY"
  | "CONFLICTING_FLAGS"
  | "TAGGED_EVENT";

export interface EdgeReason {
  code: EdgeCode;
  message: string;
}

export interface EngineItem {
  skuId: string;
  metrics: SkuMetrics;
  flags: Flag[];
  /** What the rules say. For edge SKUs this is reference only and must be labelled as such. */
  action: Action;
  qty: number;
  reason: string;
  isEdge: boolean;
  edgeReasons: EdgeReason[];
}

export interface EngineResult {
  asOfDate: string;
  lastCompleteWeek: string;
  uplift: number;
  items: EngineItem[];
  summary: {
    skus: number;
    stockout: number;
    overstock: number;
    highDemand: number;
    noAction: number;
    edge: number;
  };
}

export class EngineInputError extends Error {}

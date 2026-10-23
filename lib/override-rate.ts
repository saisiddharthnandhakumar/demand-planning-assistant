import type { DecisionStatus } from "@/lib/decisions";

export interface ReviewItem {
  isEdge: boolean;
  decisionStatus: DecisionStatus;
}

/**
 * Override rate for a run = overridden engine decisions / all engine decisions.
 * An override is any Edit or Reject on an engine decision. The denominator is
 * every non-edge SKU in the run, NO_ACTION ones included. Edge SKUs are
 * excluded because they go to the planner by design. Null when the run has no
 * engine decisions (every SKU was routed), so there is no rate to judge.
 */
export function overrideRate(items: readonly ReviewItem[]): number | null {
  const engine = items.filter((i) => !i.isEdge);
  if (engine.length === 0) return null;
  const overridden = engine.filter((i) => i.decisionStatus === "edited" || i.decisionStatus === "rejected").length;
  return overridden / engine.length;
}

export interface ReviewProgress {
  engineTotal: number;
  engineDecided: number;
  engineApproved: number;
  engineEdited: number;
  engineRejected: number;
  edgeTotal: number;
  edgeDecided: number;
  pendingEngine: number;
  pendingEdge: number;
  /** Every SKU, engine and edge, has an explicit decision. */
  readyToSubmit: boolean;
}

export function reviewProgress(items: readonly ReviewItem[]): ReviewProgress {
  const engine = items.filter((i) => !i.isEdge);
  const edge = items.filter((i) => i.isEdge);
  const decided = (xs: readonly ReviewItem[]) => xs.filter((i) => i.decisionStatus !== "pending").length;
  const count = (s: DecisionStatus) => engine.filter((i) => i.decisionStatus === s).length;
  const pendingEngine = engine.length - decided(engine);
  const pendingEdge = edge.length - decided(edge);
  return {
    engineTotal: engine.length,
    engineDecided: decided(engine),
    engineApproved: count("approved"),
    engineEdited: count("edited"),
    engineRejected: count("rejected"),
    edgeTotal: edge.length,
    edgeDecided: decided(edge),
    pendingEngine,
    pendingEdge,
    readyToSubmit: items.length > 0 && pendingEngine === 0 && pendingEdge === 0,
  };
}

/** Why a run cannot be submitted yet, in plain words; null when it can. */
export function submitBlocker(p: ReviewProgress): string | null {
  if (p.readyToSubmit) return null;
  const parts: string[] = [];
  if (p.pendingEdge > 0) parts.push(`${p.pendingEdge} SKU${p.pendingEdge === 1 ? "" : "s"} that need${p.pendingEdge === 1 ? "s" : ""} your judgment`);
  if (p.pendingEngine > 0) parts.push(`${p.pendingEngine} engine decision${p.pendingEngine === 1 ? "" : "s"}`);
  return `Still to decide: ${parts.join(" and ")}.`;
}

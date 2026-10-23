import type { EventTagDraft } from "./events";
import { EVENT_TYPE_LABEL } from "./events";
import { MAX_BRIEF_WORDS, wordCount } from "./guardrail";
import type { EdgeCode, EdgeReason, SkuMetrics } from "@/lib/engine/types";

/**
 * Everything Gemini is allowed to see for an edge brief, already rounded for
 * display. The number guardrail checks the brief against THIS object, so a
 * number the model computes or rounds differently is caught.
 */
export interface BriefInput {
  sku: { id: string; name: string; category: string; perishability: "High" | "Low"; distributorId: string };
  windows: { baselineWeeks: number; recentWeeks: number; priorWeeks: number };
  metrics: {
    recentAverage: number | null;
    priorAverage: number | null;
    baselineAverage: number | null;
    /** Signed whole percent: recent average vs the prior window. */
    stepChangePercent: number | null;
    coverWeeks: number | null;
    minimumCoverWeeks: number;
    maximumCoverWeeks: number;
  };
  weeklyUnits: { week: string; units: number | null }[];
  routingReasons: string[];
  eventTags: { eventType: string; summary: string; startWeek: string; endWeek: string }[];
}

const round = (n: number | null, dp: number) => (n === null ? null : Number(n.toFixed(dp)));

export function buildBriefInput(args: {
  sku: BriefInput["sku"];
  metrics: SkuMetrics;
  edgeReasons: EdgeReason[];
  tags: Pick<EventTagDraft, "eventType" | "summary" | "startWeek" | "endWeek">[];
  recentWeeks: number;
}): BriefInput {
  const { metrics: m } = args;
  return {
    sku: args.sku,
    windows: {
      baselineWeeks: m.windowWeeks.length,
      recentWeeks: args.recentWeeks,
      priorWeeks: m.windowWeeks.length - args.recentWeeks,
    },
    metrics: {
      recentAverage: round(m.avg4, 1),
      priorAverage: round(m.prior8, 1),
      baselineAverage: round(m.avg12, 1),
      stepChangePercent: m.stepChange === null ? null : Math.round(m.stepChange * 100),
      coverWeeks: round(m.coverWeeks, 2),
      minimumCoverWeeks: m.minWeeks,
      maximumCoverWeeks: m.maxWeeks,
    },
    weeklyUnits: m.windowWeeks.map((week, i) => ({ week, units: m.series[i] })),
    routingReasons: args.edgeReasons.map((r) => r.message),
    eventTags: args.tags.map((t) => ({ eventType: t.eventType, summary: t.summary, startWeek: t.startWeek, endWeek: t.endWeek })),
  };
}

const REASON_PHRASE: Record<EdgeCode, string> = {
  SHORT_HISTORY: "short sales history",
  STEP_CHANGE: "a step change in recent sales",
  OUTLIER_WEEK: "an unusual week",
  DISTRIBUTOR_SWING: "a swing in its distributor's sales",
  DATA_MISSING_WEEKS: "missing weeks of sales",
  DATA_ZERO_DEMAND: "zero or negative sales",
  DATA_NO_INVENTORY: "no stock record",
  CONFLICTING_FLAGS: "conflicting flags",
  TAGGED_EVENT: "an active event tag",
};

/**
 * The deterministic brief used whenever the AI brief is unavailable or fails
 * the guardrail. Built only from the same data as the AI brief, states facts
 * only, and never recommends an action or a quantity.
 */
export function templateBrief(input: BriefInput, reasonCodes: EdgeCode[]): string {
  const { metrics: m, windows: w, sku } = input;
  const parts: string[] = [];

  if (m.recentAverage !== null && m.priorAverage !== null) {
    const change = m.stepChangePercent;
    const move = change === null ? "" : change === 0 ? ", unchanged" : `, ${change > 0 ? "up" : "down"} ${Math.abs(change)}%`;
    parts.push(
      `${sku.name} (${sku.id}) sold ${m.recentAverage} units a week over the last ${w.recentWeeks} weeks, against ${m.priorAverage} in the ${w.priorWeeks} weeks before${move}.`,
    );
  } else {
    parts.push(`${sku.name} (${sku.id}) does not have enough recent sales data for a comparison.`);
  }
  if (m.baselineAverage !== null) parts.push(`The ${w.baselineWeeks}-week average is ${m.baselineAverage}.`);

  const why = reasonCodes.map((c) => REASON_PHRASE[c]);
  if (why.length) parts.push(`It was routed to you for ${why.join(", ")}.`);

  for (const t of input.eventTags.slice(0, 2)) {
    parts.push(`Active event: ${EVENT_TYPE_LABEL[t.eventType as keyof typeof EVENT_TYPE_LABEL] ?? t.eventType}, ${t.startWeek} to ${t.endWeek}.`);
  }
  if (m.coverWeeks !== null) parts.push(`Stock covers ${m.coverWeeks} weeks.`);

  // Stay inside the word limit even in odd cases (many reasons, long names): drop the least important sentences from the end.
  let text = parts.join(" ");
  while (wordCount(text) > MAX_BRIEF_WORDS && parts.length > 1) {
    parts.pop();
    text = parts.join(" ");
  }
  return text;
}

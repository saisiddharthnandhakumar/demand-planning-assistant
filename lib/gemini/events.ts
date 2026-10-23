import { z } from "zod";
import { parseIsoWeek } from "@/lib/dates";
import type { EventTag } from "@/lib/engine/types";

// Turning a free-text event note into tags a human confirms. Pure: the model's
// answer is validated and cleaned against the real catalog here, so a made-up
// SKU or a malformed week can never reach the database.

export const EVENT_TYPES = [
  "competitor_scheme",
  "festival_or_holiday",
  "supply_disruption",
  "distributor_behaviour",
  "price_promotion",
  "weather",
  "new_launch",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  competitor_scheme: "Competitor scheme",
  festival_or_holiday: "Festival or holiday",
  supply_disruption: "Supply disruption",
  distributor_behaviour: "Distributor behaviour",
  price_promotion: "Price promotion",
  weather: "Weather",
  new_launch: "New launch",
  other: "Other",
};

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const MAX_NOTE_LENGTH = 1000;

/** What we ask Gemini to return (the JSON-schema subset the API supports). */
export const EVENT_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One short sentence restating the event in plain words." },
    eventType: { type: "string", enum: [...EVENT_TYPES] },
    skuIds: { type: "array", items: { type: "string" }, description: "SKU ids from the catalog that the event affects. Empty if none are clearly named." },
    categories: { type: "array", items: { type: "string" }, description: "Categories from the catalog that the event affects, when it concerns a whole category." },
    distributorIds: { type: "array", items: { type: "string" }, description: "Distributor ids from the catalog that the event affects." },
    startWeek: { type: ["string", "null"], description: "First affected ISO week such as 2026-W43, or null if the note gives no timing." },
    endWeek: { type: ["string", "null"], description: "Last affected ISO week such as 2026-W44, or null if the note gives no timing." },
    confidence: { type: "string", enum: [...CONFIDENCE_LEVELS], description: "How confident you are that the tags capture the note." },
    notUnderstood: { type: "array", items: { type: "string" }, description: "Parts of the note that could not be turned into tags (for example a region that is not in the catalog)." },
  },
  required: ["summary", "eventType", "skuIds", "categories", "distributorIds", "startWeek", "endWeek", "confidence", "notUnderstood"],
} as const;

const rawEventSchema = z.object({
  summary: z.string().trim().min(1).max(300),
  eventType: z.enum(EVENT_TYPES),
  skuIds: z.array(z.string()).max(50),
  categories: z.array(z.string()).max(20),
  distributorIds: z.array(z.string()).max(20),
  startWeek: z.string().nullable(),
  endWeek: z.string().nullable(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  notUnderstood: z.array(z.string()).max(20),
});

export interface Catalog {
  skus: { id: string; name: string; category: string; distributorId: string }[];
  distributors: { id: string; name: string; region: string }[];
}

/** A cleaned tag, ready to show for confirmation. */
export interface EventTagDraft {
  summary: string;
  eventType: EventType;
  skuIds: string[];
  categories: string[];
  distributorIds: string[];
  startWeek: string;
  endWeek: string;
  confidence: Confidence;
  /** Things the planner should know before confirming. */
  warnings: string[];
}

export type NormalizeResult = { ok: true; tag: EventTagDraft } | { ok: false; error: string };

const list = (xs: string[]) => xs.map((x) => `"${x}"`).join(", ");

/**
 * Validates Gemini's answer against the catalog and today's week. Unknown ids
 * and categories are dropped with a warning (never silently), weeks are checked
 * to be real ISO weeks, and missing timing defaults to the current week with a
 * warning so the planner sees it.
 */
export function normalizeParsedEvent(raw: unknown, catalog: Catalog, currentWeek: string): NormalizeResult {
  const parsed = rawEventSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: `The AI answer was not in the expected format: ${parsed.error.issues[0].path.join(".") || "root"}: ${parsed.error.issues[0].message}` };
  }
  const p = parsed.data;
  const warnings: string[] = [];

  const skuById = new Map(catalog.skus.map((s) => [s.id.toUpperCase(), s.id]));
  const skuIds = [...new Set(p.skuIds.map((x) => skuById.get(x.trim().toUpperCase())).filter((x): x is string => !!x))];
  const badSkus = p.skuIds.filter((x) => !skuById.has(x.trim().toUpperCase()));
  if (badSkus.length) warnings.push(`Ignored SKU id(s) that do not exist: ${list(badSkus)}.`);

  const catByLower = new Map([...new Set(catalog.skus.map((s) => s.category))].map((c) => [c.toLowerCase(), c]));
  const categories = [...new Set(p.categories.map((x) => catByLower.get(x.trim().toLowerCase())).filter((x): x is string => !!x))];
  const badCats = p.categories.filter((x) => !catByLower.has(x.trim().toLowerCase()));
  if (badCats.length) warnings.push(`Ignored categor${badCats.length === 1 ? "y" : "ies"} that do not exist: ${list(badCats)}.`);

  const distById = new Map(catalog.distributors.map((d) => [d.id.toUpperCase(), d.id]));
  const distributorIds = [...new Set(p.distributorIds.map((x) => distById.get(x.trim().toUpperCase())).filter((x): x is string => !!x))];
  const badDists = p.distributorIds.filter((x) => !distById.has(x.trim().toUpperCase()));
  if (badDists.length) warnings.push(`Ignored distributor id(s) that do not exist: ${list(badDists)}.`);

  let start = p.startWeek && parseIsoWeek(p.startWeek) ? p.startWeek.trim() : null;
  let end = p.endWeek && parseIsoWeek(p.endWeek) ? p.endWeek.trim() : null;
  if ((p.startWeek && !start) || (p.endWeek && !end)) warnings.push("Ignored a week that is not a valid ISO week (for example 2026-W43).");
  if (!start && !end) {
    start = end = currentWeek;
    warnings.push(`The note gives no usable timing, so it was set to the current week (${currentWeek}).`);
  } else if (!start) start = end;
  else if (!end) end = start;
  if (start! > end!) {
    [start, end] = [end, start];
    warnings.push("The start week was after the end week, so they were swapped.");
  }

  if (skuIds.length + categories.length + distributorIds.length === 0) {
    warnings.push("No SKU, category or distributor was identified, so this tag would not affect anything. Rewrite the note naming what it covers.");
  }
  for (const n of p.notUnderstood) warnings.push(`Not represented: ${n}`);

  return {
    ok: true,
    tag: { summary: p.summary, eventType: p.eventType, skuIds, categories, distributorIds, startWeek: start!, endWeek: end!, confidence: p.confidence, warnings },
  };
}

/** A tag can only be confirmed if it covers something. */
export const tagHasTargets = (t: Pick<EventTagDraft, "skuIds" | "categories" | "distributorIds">) =>
  t.skuIds.length + t.categories.length + t.distributorIds.length > 0;

/** The engine's view of a confirmed tag. */
export function toEngineTag(id: string, t: EventTagDraft): EventTag {
  return {
    id,
    skuIds: t.skuIds,
    categories: t.categories,
    distributorIds: t.distributorIds,
    startWeek: t.startWeek,
    endWeek: t.endWeek,
    eventType: t.eventType,
    summary: t.summary,
  };
}

/**
 * Whether a confirmed tag still matters for a run whose baseline window starts
 * at `windowStartWeek`. A tag that ended before the window began has no effect
 * on any average any more, so it must stop routing SKUs. Tags that overlap the
 * window, or lie in the future (a scheme next week), stay relevant.
 */
export const tagIsRelevant = (t: Pick<EventTagDraft, "endWeek">, windowStartWeek: string) => t.endWeek >= windowStartWeek;

/** "expired", "upcoming" or "current", for display. `lastCompleteWeek` is the newest finished sales week. */
export function tagTiming(t: Pick<EventTagDraft, "startWeek" | "endWeek">, windowStartWeek: string, lastCompleteWeek: string): "expired" | "upcoming" | "current" {
  if (t.endWeek < windowStartWeek) return "expired";
  if (t.startWeek > lastCompleteWeek) return "upcoming";
  return "current";
}

/** Stored tags are re-validated on the way out of the database. */
export const storedTagSchema = z.object({
  summary: z.string(),
  eventType: z.enum(EVENT_TYPES),
  skuIds: z.array(z.string()),
  categories: z.array(z.string()),
  distributorIds: z.array(z.string()),
  startWeek: z.string(),
  endWeek: z.string(),
  confidence: z.enum(CONFIDENCE_LEVELS),
  warnings: z.array(z.string()),
});

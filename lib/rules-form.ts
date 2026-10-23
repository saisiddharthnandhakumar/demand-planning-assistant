import { rulesSchema, type Rules } from "@/lib/rules";

export type FieldKind = "percent" | "int" | "number";

export interface RuleField {
  /** Dotted path into the rules document, e.g. "edge.outlier_zscore". Also the form field name. */
  path: string;
  label: string;
  help: string;
  kind: FieldKind;
  step: string;
}

export interface RuleGroup {
  title: string;
  description: string;
  fields: RuleField[];
}

/** Single source of truth for the editor: labels, units and field order. */
export const RULE_GROUPS: RuleGroup[] = [
  {
    title: "High demand",
    description: "When recent sales run ahead of the baseline, reorder more than the standard quantity.",
    fields: [
      { path: "surge_threshold", label: "Surge threshold", help: "Recent sales this far above the baseline average flag high-demand.", kind: "percent", step: "1" },
      { path: "surge_recent_weeks", label: "Recent window (weeks)", help: "Weeks counted as recent sales.", kind: "int", step: "1" },
      { path: "baseline_weeks", label: "Baseline window (weeks)", help: "Weeks averaged as the baseline. The weeks before the recent window form the prior window.", kind: "int", step: "1" },
      { path: "surge_reorder_multiplier", label: "Reorder multiplier", help: "Multiplies the standard reorder quantity for high-demand SKUs.", kind: "number", step: "0.1" },
    ],
  },
  {
    title: "Stock cover",
    description: "Weeks of stock at average weekly sales (festival uplift applied to demand).",
    fields: [
      { path: "stockout_weeks", label: "Stockout below (weeks)", help: "Cover below this flags stockout risk and recommends an immediate reorder.", kind: "number", step: "0.5" },
      { path: "overstock_weeks", label: "Overstock above (weeks)", help: "Cover above this flags overstock risk and recommends pausing the next order.", kind: "number", step: "0.5" },
    ],
  },
  {
    title: "Festival months",
    description: "Which months are festival months comes from the calendar table.",
    fields: [
      { path: "festival_uplift", label: "Demand uplift", help: "Added to demand in festival months before the cover calculation. Not applied to the surge test.", kind: "percent", step: "1" },
    ],
  },
  {
    title: "Perishable SKUs",
    description: "Tighter cover limits for high-perishability SKUs.",
    fields: [
      { path: "perishable.min_weeks", label: "Minimum cover (weeks)", help: "Below this is a stockout risk for perishable SKUs.", kind: "number", step: "0.5" },
      { path: "perishable.max_weeks", label: "Maximum cover (weeks)", help: "Above this is an overstock risk for perishable SKUs.", kind: "number", step: "0.5" },
    ],
  },
  {
    title: "Edge detection",
    description: "SKUs that trip any of these go to the \"Needs your judgment\" queue instead of getting a recommendation.",
    fields: [
      { path: "edge.min_history_weeks", label: "Minimum history (weeks)", help: "Fewer weeks of sales than this routes the SKU.", kind: "int", step: "1" },
      { path: "edge.step_change_threshold", label: "Step change threshold", help: "Recent average vs the prior window, in either direction.", kind: "percent", step: "1" },
      { path: "edge.outlier_zscore", label: "Outlier z-score", help: "A single week this many standard deviations from the window mean routes the SKU. With 12 weeks the maximum possible is about 3.2.", kind: "number", step: "0.1" },
      { path: "edge.distributor_swing_threshold", label: "Distributor swing threshold", help: "A distributor's total sales moving more than this routes all its SKUs.", kind: "percent", step: "1" },
    ],
  },
  {
    title: "Kill switch",
    description: "Pauses the whole system when too many engine decisions are overridden.",
    fields: [
      { path: "kill.override_rate_threshold", label: "Override rate limit", help: "A submitted run above this override rate counts as a breach.", kind: "percent", step: "1" },
      { path: "kill.consecutive_runs", label: "Consecutive breaches", help: "Breaching runs in a row that trigger the pause.", kind: "int", step: "1" },
    ],
  },
];

export const RULE_FIELDS: RuleField[] = RULE_GROUPS.flatMap((g) => g.fields);
const FIELD_BY_PATH = new Map(RULE_FIELDS.map((f) => [f.path, f]));

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let cur = obj;
  for (const k of keys.slice(0, -1)) cur = (cur[k] ??= {}) as Record<string, unknown>;
  cur[keys.at(-1)!] = value;
}

const round = (n: number, dp: number) => Number(n.toFixed(dp));

/** Stored value to the text shown in an input (fractions become percentages). */
export function toInputValue(field: RuleField, value: unknown): string {
  if (typeof value !== "number") return "";
  return String(field.kind === "percent" ? round(value * 100, 4) : value);
}

/** Stored value to display text, e.g. 0.2 -> "20%". */
export function formatRuleValue(path: string, value: unknown): string {
  const field = FIELD_BY_PATH.get(path);
  if (typeof value !== "number") return String(value);
  return field?.kind === "percent" ? `${round(value * 100, 4)}%` : String(value);
}

export function ruleLabel(path: string): string {
  return FIELD_BY_PATH.get(path)?.label ?? path;
}

export function rulesToInputValues(rules: Rules): Record<string, string> {
  return Object.fromEntries(RULE_FIELDS.map((f) => [f.path, toInputValue(f, getPath(rules, f.path))]));
}

export type ParsedRules =
  | { ok: true; rules: Rules }
  | { ok: false; errors: Record<string, string> };

/** Parses the editor's text inputs into a validated rules document. */
export function parseRulesForm(values: Record<string, FormDataEntryValue | null | undefined>): ParsedRules {
  const errors: Record<string, string> = {};
  const draft: Record<string, unknown> = {};

  for (const f of RULE_FIELDS) {
    const raw = String(values[f.path] ?? "").trim();
    const n = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(n)) {
      errors[f.path] = "Enter a number.";
      continue;
    }
    if (f.kind === "int" && !Number.isInteger(n)) {
      errors[f.path] = "Enter a whole number.";
      continue;
    }
    setPath(draft, f.path, f.kind === "percent" ? round(n / 100, 6) : n);
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const parsed = rulesSchema.safeParse(draft);
  if (parsed.success) return { ok: true, rules: parsed.data };
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".");
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

import { formatIsoWeek, isoWeekOfDate, shiftIsoWeek } from "@/lib/dates";
import type { Rules } from "@/lib/rules";
import {
  EngineInputError,
  type CalendarRow,
  type SkuInput,
  type SkuMetrics,
} from "./types";

/** The week before the as-of date's ISO week (as-of 2026-10-19 is W43, so W42). */
export function lastCompleteWeek(asOfDate: string): string {
  return formatIsoWeek(shiftIsoWeek(isoWeekOfDate(asOfDate), -1));
}

/** The n weeks ending at the last complete week, oldest first. */
export function windowWeeks(asOfDate: string, n: number): string[] {
  const last = shiftIsoWeek(isoWeekOfDate(asOfDate), -1);
  return Array.from({ length: n }, (_, i) => formatIsoWeek(shiftIsoWeek(last, i - (n - 1))));
}

/**
 * Demand uplift for the as-of month, taken from the calendar table (the source
 * of truth for festival months). Throws if the month is missing rather than
 * silently assuming no uplift.
 */
export function upliftFor(asOfDate: string, calendar: CalendarRow[], rules: Rules): number {
  const year = Number(asOfDate.slice(0, 4));
  const month = Number(asOfDate.slice(5, 7));
  const row = calendar.find((c) => c.year === year && c.month === month);
  if (!row) throw new EngineInputError(`Calendar has no row for ${asOfDate.slice(0, 7)}`);
  return row.isFestivalMonth ? rules.festival_uplift : 0;
}

/** Stockout and overstock limits in weeks of cover, by perishability. */
export function coverLimits(perishability: SkuInput["perishability"], rules: Rules) {
  return perishability === "High"
    ? { minWeeks: rules.perishable.min_weeks, maxWeeks: rules.perishable.max_weeks }
    : { minWeeks: rules.stockout_weeks, maxWeeks: rules.overstock_weeks };
}

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/**
 * Metrics for one SKU. Surge and step change use raw actuals; the festival
 * uplift is applied ONLY to the demand used for cover (documented and tested).
 * Weeks covered by an event tag are excluded from every average.
 */
export function computeSkuMetrics(args: {
  sku: SkuInput;
  /** isoWeek -> units for this SKU */
  salesByWeek: ReadonlyMap<string, number>;
  /** null when the SKU has no inventory row */
  unitsOnHand: number | null;
  asOfDate: string;
  uplift: number;
  rules: Rules;
  excludedWeeks: ReadonlySet<string>;
}): SkuMetrics {
  const { sku, salesByWeek, unitsOnHand, asOfDate, uplift, rules, excludedWeeks } = args;

  const weeks = windowWeeks(asOfDate, rules.baseline_weeks);
  const series = weeks.map((w) => salesByWeek.get(w) ?? null);
  const recentCount = rules.surge_recent_weeks;
  const priorStart = 0;
  const priorEnd = weeks.length - recentCount;

  const usable = (i: number) => series[i] !== null && !excludedWeeks.has(weeks[i]);
  const valuesIn = (from: number, to: number) =>
    series
      .slice(from, to)
      .flatMap((v, k) => (v !== null && usable(from + k) ? [v] : []));

  const windowValues = valuesIn(0, weeks.length);
  const avg12 = mean(windowValues);
  const avg4 = mean(valuesIn(priorEnd, weeks.length));
  const prior8 = mean(valuesIn(priorStart, priorEnd));

  const last = lastCompleteWeek(asOfDate);
  let historyWeeks = 0;
  for (const w of salesByWeek.keys()) if (w <= last) historyWeeks++;

  // z-scores over the usable window values, using the sample standard deviation
  let maxZ = 0;
  let maxZWeek: string | null = null;
  if (windowValues.length >= 2 && avg12 !== null) {
    const variance =
      windowValues.reduce((s, x) => s + (x - avg12) ** 2, 0) / (windowValues.length - 1);
    const sd = Math.sqrt(variance);
    if (sd > 0) {
      series.forEach((v, i) => {
        if (v === null || !usable(i)) return;
        const z = Math.abs(v - avg12) / sd;
        if (z > maxZ) {
          maxZ = z;
          maxZWeek = weeks[i];
        }
      });
    }
  }

  const demandForCover = avg12 === null ? null : avg12 * (1 + uplift);
  const coverWeeks =
    unitsOnHand !== null && demandForCover !== null && demandForCover > 0
      ? unitsOnHand / demandForCover
      : null;

  const { minWeeks, maxWeeks } = coverLimits(sku.perishability, rules);

  return {
    asOfDate,
    lastCompleteWeek: last,
    windowWeeks: weeks,
    series,
    excludedWeeks: weeks.filter((w) => excludedWeeks.has(w)),
    missingWeeks: weeks.filter((_, i) => series[i] === null),
    zeroWeeks: weeks.filter((_, i) => series[i] !== null && series[i]! <= 0),
    historyWeeks,
    avg12,
    avg4,
    prior8,
    surge: avg12 !== null && avg12 > 0 && avg4 !== null ? avg4 / avg12 - 1 : null,
    stepChange: prior8 !== null && prior8 > 0 && avg4 !== null ? (avg4 - prior8) / prior8 : null,
    uplift,
    demandForCover,
    unitsOnHand,
    coverWeeks,
    minWeeks,
    maxWeeks,
    maxZ,
    maxZWeek,
  };
}

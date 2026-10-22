import path from "node:path";
import { formatIsoWeek, isoWeekOfDate, shiftIsoWeek } from "@/lib/dates";
import type { EngineInput, SalesRow, SkuInput } from "@/lib/engine/types";
import { INITIAL_RULES, type Rules } from "@/lib/rules";
import { readSeedFiles } from "@/lib/seed/read";
import { validateSeed } from "@/lib/seed/validate";

/** The real seed files as engine input (as-of 2026-10-19, initial rules). */
export function seedEngineInput(overrides: Partial<EngineInput> = {}): EngineInput {
  const result = validateSeed(readSeedFiles(path.resolve(__dirname, "../../seed")));
  if (!result.ok) throw new Error("seed files should be valid");
  const { data } = result;
  return {
    asOfDate: "2026-10-19",
    skus: data.skus.map((s) => ({
      skuId: s.skuId,
      skuName: s.skuName,
      category: s.category,
      perishability: s.perishability,
      standardReorderQty: s.standardReorderQty,
      distributorId: s.distributorId,
    })),
    sales: data.weeklySales.map((w) => ({ skuId: w.skuId, isoWeek: w.isoWeek, units: w.units })),
    inventory: data.inventory.map((i) => ({ skuId: i.skuId, unitsOnHand: i.unitsOnHand })),
    calendar: data.calendar.map((c) => ({
      year: c.year,
      month: c.month,
      isFestivalMonth: c.isFestivalMonth,
    })),
    rules: INITIAL_RULES,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Small synthetic inputs for unit tests
// ---------------------------------------------------------------------------

/** A non-festival date (Monday, ISO week 34 of 2026), so last complete week is W33. */
export const PLAIN_ASOF = "2026-08-17";

export const rulesWith = (patch: Partial<Rules>): Rules => ({ ...INITIAL_RULES, ...patch });

export const flat = (units: number, weeks: number) => Array<number>(weeks).fill(units);

/**
 * Sales rows for one SKU. `values` is oldest to newest and ends at the last
 * complete week before `asOf`. Use null to leave a week without a row.
 */
export function salesFor(
  skuId: string,
  values: (number | null)[],
  asOf = PLAIN_ASOF,
): SalesRow[] {
  const last = shiftIsoWeek(isoWeekOfDate(asOf), -1);
  return values.flatMap((units, i) =>
    units === null
      ? []
      : [{ skuId, isoWeek: formatIsoWeek(shiftIsoWeek(last, i - (values.length - 1))), units }],
  );
}

export const makeSku = (skuId: string, patch: Partial<SkuInput> = {}): SkuInput => ({
  skuId,
  skuName: `Test ${skuId}`,
  category: "Snack",
  perishability: "Low",
  standardReorderQty: 100,
  distributorId: "DIST1",
  ...patch,
});

export const calendar2026 = (festivalMonths = [3, 10, 11]) =>
  Array.from({ length: 12 }, (_, i) => ({
    year: 2026,
    month: i + 1,
    isFestivalMonth: festivalMonths.includes(i + 1),
  }));

/** One SKU with 12 weeks of sales ending at the last complete week. */
export function singleSku(opts: {
  values: (number | null)[];
  onHand: number | null;
  sku?: Partial<SkuInput>;
  asOf?: string;
  rules?: Rules;
}): EngineInput {
  const asOf = opts.asOf ?? PLAIN_ASOF;
  const sku = makeSku("S1", opts.sku);
  return {
    asOfDate: asOf,
    skus: [sku],
    sales: salesFor("S1", opts.values, asOf),
    inventory: opts.onHand === null ? [] : [{ skuId: "S1", unitsOnHand: opts.onHand }],
    calendar: calendar2026(),
    rules: opts.rules ?? INITIAL_RULES,
  };
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

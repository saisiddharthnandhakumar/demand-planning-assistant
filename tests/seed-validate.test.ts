import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { parseCsv, readSeedFiles } from "@/lib/seed/read";
import { runSeed } from "@/lib/seed/run";
import type { RawSeed } from "@/lib/seed/types";
import { formatIssue, validateSeed } from "@/lib/seed/validate";

let real: RawSeed;
beforeAll(() => {
  real = readSeedFiles(path.resolve(__dirname, "../seed"));
});

const fresh = () => structuredClone(real);

/** Validates a mutated copy and returns the error messages (empty if it passed). */
function errorsFor(mutate: (raw: RawSeed) => void): string[] {
  const raw = fresh();
  mutate(raw);
  const result = validateSeed(raw);
  return result.ok ? [] : result.errors.map(formatIssue);
}

describe("real seed files", () => {
  it("validate cleanly with the expected row counts", () => {
    const result = validateSeed(real);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.skus).toHaveLength(15);
    expect(result.data.weeklySales).toHaveLength(240);
    expect(result.data.inventory).toHaveLength(15);
    expect(result.data.calendar).toHaveLength(24);
    expect(result.data.distributors).toHaveLength(4);
    expect(result.data.skuVendorMap).toHaveLength(15);
  });

  it("converts dates, weeks and flags correctly", () => {
    const result = validateSeed(real);
    if (!result.ok) throw new Error("seed should be valid");
    const { data } = result;
    expect(new Set(data.inventory.map((i) => i.asOfDate))).toEqual(new Set(["2026-10-19"]));
    const weeks = [...new Set(data.weeklySales.map((w) => w.isoWeek))].sort();
    expect(weeks[0]).toBe("2026-W27");
    expect(weeks.at(-1)).toBe("2026-W42");
    expect(weeks).toHaveLength(16);
    expect(data.weeklySales.find((w) => w.isoWeek === "2026-W43")).toBeUndefined();
    const festival = data.calendar.filter((c) => c.isFestivalMonth).map((c) => c.yearMonth);
    expect(festival).toEqual(["2025-03", "2025-10", "2025-11", "2026-03", "2026-10", "2026-11"]);
    expect(data.skus.find((s) => s.skuId === "SKU004")?.perishability).toBe("High");
  });

  it("has no placeholder Zoho IDs left in the vendor map", () => {
    const result = validateSeed(real);
    expect(result.warnings.some((w) => /PLACEHOLDER/.test(w.message))).toBe(false);
  });
});

describe("malformed data is rejected with readable errors", () => {
  it("duplicate SKU/week pair", () => {
    const errs = errorsFor((r) => r.weeklySales.rows.push({ ...r.weeklySales.rows[0] }));
    expect(errs.join("\n")).toMatch(/duplicate SKU\/week SKU001 2026-W27/);
  });

  it("missing week", () => {
    const errs = errorsFor((r) => {
      r.weeklySales.rows = r.weeklySales.rows.filter(
        (row) => !(row.SKU_ID === "SKU003" && row.Week === "2026-W35"),
      );
    });
    expect(errs.join("\n")).toMatch(/SKU003 is missing week\(s\): 2026-W35/);
  });

  it("negative units", () => {
    const errs = errorsFor((r) => (r.weeklySales.rows[3].Units_Sold = -5));
    expect(errs.join("\n")).toMatch(/Weekly_Sales_Seed_Data\.xlsx row 5: Units_Sold -5 is negative/);
  });

  it("non-integer units", () => {
    const errs = errorsFor((r) => (r.weeklySales.rows[0].Units_Sold = 12.5));
    expect(errs.join("\n")).toMatch(/Units_Sold 12\.5 is not a whole number/);
  });

  it("non-numeric units", () => {
    const errs = errorsFor((r) => (r.weeklySales.rows[0].Units_Sold = "lots"));
    expect(errs.join("\n")).toMatch(/Units_Sold "lots" is not a number/);
  });

  it.each(["2026-W99", "2026W27", "W27", "2025-W53", "27-2026"])("unparseable week %s", (bad) => {
    const errs = errorsFor((r) => (r.weeklySales.rows[0].Week = bad));
    expect(errs.join("\n")).toMatch(/is not a valid ISO week/);
  });

  it("SKU in sales but not in SKU master", () => {
    const errs = errorsFor((r) => (r.weeklySales.rows[0].SKU_ID = "SKU999"));
    expect(errs.join("\n")).toMatch(/SKU999 is not in the SKU master/);
  });

  it("SKU missing from inventory", () => {
    const errs = errorsFor((r) => {
      r.inventory.rows = r.inventory.rows.filter((row) => row.SKU_ID !== "SKU008");
    });
    expect(errs.join("\n")).toMatch(/SKU008 is missing from inventory/);
  });

  it("SKU with no vendor mapping", () => {
    const errs = errorsFor((r) => {
      r.skuVendorMap.rows = r.skuVendorMap.rows.filter((row) => row.SKU_ID !== "SKU005");
    });
    expect(errs.join("\n")).toMatch(/SKU005 has no vendor mapping/);
  });

  it("SKU pointing at an unknown distributor", () => {
    const errs = errorsFor((r) => (r.skus.rows[0].Distributor_ID = "DIST999"));
    expect(errs.join("\n")).toMatch(/DIST999 is not in the distributor master/);
  });

  it("bad perishability value", () => {
    const errs = errorsFor((r) => (r.skus.rows[0].Perishability = "Medium"));
    expect(errs.join("\n")).toMatch(/Perishability "Medium" must be High or Low/);
  });

  it("missing column", () => {
    const errs = errorsFor((r) => {
      r.skus.rows.forEach((row) => delete row.Perishability);
    });
    expect(errs.join("\n")).toMatch(/SKU_Seed_Data\.xlsx: missing column\(s\): Perishability/);
  });

  it("calendar missing the as-of month", () => {
    const errs = errorsFor((r) => {
      r.calendar.rows = r.calendar.rows.filter((row) => !(row.Year === 2026 && row.Month === 10));
    });
    expect(errs.join("\n")).toMatch(/as-of month 2026-10 is not in the calendar/);
  });

  it("calendar Year_Month disagreeing with Year/Month", () => {
    const errs = errorsFor((r) => (r.calendar.rows[0].Month = 2));
    expect(errs.join("\n")).toMatch(/does not match Year\/Month/);
  });

  it("empty file", () => {
    const errs = errorsFor((r) => (r.distributors.rows = []));
    expect(errs.join("\n")).toMatch(/distributor_master\.xlsx: file has no data rows/);
  });

  it("reports every problem at once, not just the first", () => {
    const errs = errorsFor((r) => {
      r.weeklySales.rows[0].Units_Sold = -1;
      r.weeklySales.rows[1].Units_Sold = 1.5;
      r.skus.rows[0].Perishability = "Medium";
    });
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });

  it("zero units is a warning, not an error", () => {
    const raw = fresh();
    raw.weeklySales.rows[0].Units_Sold = 0;
    const result = validateSeed(raw);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => /zero units/.test(w.message))).toBe(true);
  });
});

describe("runSeed writes nothing when validation fails", () => {
  it("never calls the writer for malformed data", async () => {
    const raw = fresh();
    raw.weeklySales.rows[0].Units_Sold = -5;
    const write = vi.fn(async () => {});
    const result = await runSeed(raw, write);
    expect(result.ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("calls the writer exactly once with clean data", async () => {
    const write = vi.fn(async () => {});
    const result = await runSeed(fresh(), write);
    expect(result.ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe("parseCsv", () => {
  it("handles quotes, CRLF, BOM and blank lines", () => {
    const rows = parseCsv('﻿A,B\r\n"x, y",2\r\n\r\n"say ""hi""",3\r\n');
    expect(rows).toEqual([
      { A: "x, y", B: "2" },
      { A: 'say "hi"', B: "3" },
    ]);
  });
});

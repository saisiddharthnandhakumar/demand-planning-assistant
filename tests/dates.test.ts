import { describe, expect, it } from "vitest";
import {
  excelSerialToIsoDate,
  formatIsoWeek,
  isoWeekOfDate,
  isoWeekStart,
  parseIsoWeek,
  shiftIsoWeek,
} from "@/lib/dates";

describe("ISO week helpers", () => {
  it("parses valid weeks and rejects bad ones", () => {
    expect(parseIsoWeek("2026-W27")).toEqual({ year: 2026, week: 27 });
    expect(parseIsoWeek("2026-27")).toBeNull();
    expect(parseIsoWeek("2026-W7")).toBeNull();
    expect(parseIsoWeek("2026-W00")).toBeNull();
    expect(parseIsoWeek("2026-W54")).toBeNull();
    expect(parseIsoWeek("W27")).toBeNull();
    expect(parseIsoWeek("")).toBeNull();
  });

  it("only allows week 53 in years that have it", () => {
    expect(parseIsoWeek("2026-W53")).toEqual({ year: 2026, week: 53 }); // 2026 has 53 weeks
    expect(parseIsoWeek("2025-W53")).toBeNull(); // 2025 has 52
  });

  it("maps the as-of date 2026-10-19 to W43 and W31..W42 to the right Mondays", () => {
    expect(isoWeekOfDate("2026-10-19")).toEqual({ year: 2026, week: 43 });
    expect(isoWeekStart({ year: 2026, week: 43 })).toBe("2026-10-19");
    expect(isoWeekStart({ year: 2026, week: 27 })).toBe("2026-06-29");
    expect(isoWeekStart({ year: 2026, week: 42 })).toBe("2026-10-12");
  });

  it("handles year boundaries", () => {
    expect(isoWeekOfDate("2026-01-01")).toEqual({ year: 2026, week: 1 });
    expect(isoWeekOfDate("2027-01-01")).toEqual({ year: 2026, week: 53 });
    expect(shiftIsoWeek({ year: 2026, week: 43 }, -1)).toEqual({ year: 2026, week: 42 });
    expect(shiftIsoWeek({ year: 2026, week: 1 }, -1)).toEqual({ year: 2025, week: 52 });
    expect(shiftIsoWeek({ year: 2026, week: 53 }, 1)).toEqual({ year: 2027, week: 1 });
  });

  it("formats weeks with zero padding", () => {
    expect(formatIsoWeek({ year: 2026, week: 7 })).toBe("2026-W07");
  });

  it("converts Excel serial dates", () => {
    expect(excelSerialToIsoDate(46314)).toBe("2026-10-19");
    expect(excelSerialToIsoDate(45658)).toBe("2025-01-01");
  });
});

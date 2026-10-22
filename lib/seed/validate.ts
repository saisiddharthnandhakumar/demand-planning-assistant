import {
  excelSerialToIsoDate,
  formatIsoWeek,
  isValidIsoDate,
  isoWeekOfDate,
  isoWeekStart,
  parseIsoWeek,
  shiftIsoWeek,
  type IsoWeek,
} from "@/lib/dates";
import {
  EXPECTED_COUNTS,
  EXPECTED_FESTIVAL_MONTHS,
  type RawRow,
  type RawSeed,
  type RawTable,
  type SeedData,
  type SeedIssue,
  type SeedValidation,
} from "./types";

/**
 * Validates the raw seed files. Pure: no file or database access. Collects
 * every problem it can find (not just the first) so they can be fixed in one go.
 */
export function validateSeed(raw: RawSeed): SeedValidation {
  const errors: SeedIssue[] = [];
  const warnings: SeedIssue[] = [];
  const err = (t: RawTable, message: string, i?: number) =>
    errors.push({ file: t.file, row: i === undefined ? undefined : i + 2, message });
  const warn = (t: RawTable, message: string, i?: number) =>
    warnings.push({ file: t.file, row: i === undefined ? undefined : i + 2, message });

  // ----- field readers (push an error and return undefined when invalid) -----
  const text = (t: RawTable, r: RawRow, col: string, i: number) => {
    const v = r[col];
    const s = v === null || v === undefined ? "" : String(v).trim();
    if (!s) {
      err(t, `${col} is empty`, i);
      return undefined;
    }
    return s;
  };
  const wholeNumber = (t: RawTable, r: RawRow, col: string, i: number) => {
    const v = r[col];
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (!Number.isFinite(n)) {
      err(t, `${col} "${v ?? ""}" is not a number`, i);
      return undefined;
    }
    if (!Number.isInteger(n)) {
      err(t, `${col} ${n} is not a whole number`, i);
      return undefined;
    }
    return n;
  };
  const nonNegative = (t: RawTable, r: RawRow, col: string, i: number) => {
    const n = wholeNumber(t, r, col, i);
    if (n !== undefined && n < 0) {
      err(t, `${col} ${n} is negative`, i);
      return undefined;
    }
    return n;
  };
  const dateCell = (t: RawTable, r: RawRow, col: string, i: number) => {
    const v = r[col];
    if (typeof v === "number") return excelSerialToIsoDate(v);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "string" && isValidIsoDate(v.trim())) return v.trim();
    err(t, `${col} "${v ?? ""}" is not a recognisable date`, i);
    return undefined;
  };
  const boolCell = (t: RawTable, r: RawRow, col: string, i: number) => {
    const v = r[col];
    if (typeof v === "boolean") return v;
    if (v === 1 || v === 0) return v === 1;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (["true", "1", "yes"].includes(s)) return true;
      if (["false", "0", "no"].includes(s)) return false;
    }
    err(t, `${col} "${v ?? ""}" is not true/false`, i);
    return undefined;
  };

  const requireColumns = (t: RawTable, cols: string[]) => {
    if (t.rows.length === 0) {
      err(t, "file has no data rows");
      return false;
    }
    const missing = cols.filter((c) => !(c in t.rows[0]));
    if (missing.length) {
      err(t, `missing column(s): ${missing.join(", ")}`);
      return false;
    }
    return true;
  };

  const data: SeedData = {
    distributors: [],
    skus: [],
    skuVendorMap: [],
    weeklySales: [],
    inventory: [],
    calendar: [],
  };

  // ----- distributors -----
  const dist = raw.distributors;
  if (requireColumns(dist, ["Distributor_ID", "Distributor_Name", "Region", "Status"])) {
    const seen = new Set<string>();
    dist.rows.forEach((r, i) => {
      const distributorId = text(dist, r, "Distributor_ID", i);
      const distributorName = text(dist, r, "Distributor_Name", i);
      const region = text(dist, r, "Region", i);
      const status = text(dist, r, "Status", i);
      if (!distributorId || !distributorName || !region || !status) return;
      if (seen.has(distributorId)) return err(dist, `duplicate Distributor_ID ${distributorId}`, i);
      seen.add(distributorId);
      if (status !== "Active") warn(dist, `${distributorId} has status "${status}"`, i);
      data.distributors.push({ distributorId, distributorName, region, status });
    });
  }
  const distributorIds = new Set(data.distributors.map((d) => d.distributorId));

  // ----- SKU master -----
  const sk = raw.skus;
  if (
    requireColumns(sk, [
      "SKU_ID",
      "SKU_Name",
      "Category",
      "Perishability",
      "Standard_Reorder_Qty",
      "Unit_of_Measure",
      "Distributor_ID",
    ])
  ) {
    const seen = new Set<string>();
    sk.rows.forEach((r, i) => {
      const skuId = text(sk, r, "SKU_ID", i);
      const skuName = text(sk, r, "SKU_Name", i);
      const category = text(sk, r, "Category", i);
      const perishability = text(sk, r, "Perishability", i);
      const qty = wholeNumber(sk, r, "Standard_Reorder_Qty", i);
      const unitOfMeasure = text(sk, r, "Unit_of_Measure", i);
      const distributorId = text(sk, r, "Distributor_ID", i);
      if (!skuId || !skuName || !category || !perishability || qty === undefined || !unitOfMeasure || !distributorId) return;
      if (perishability !== "High" && perishability !== "Low") {
        return err(sk, `${skuId}: Perishability "${perishability}" must be High or Low`, i);
      }
      if (qty <= 0) return err(sk, `${skuId}: Standard_Reorder_Qty ${qty} must be positive`, i);
      if (seen.has(skuId)) return err(sk, `duplicate SKU_ID ${skuId}`, i);
      seen.add(skuId);
      if (!distributorIds.has(distributorId)) {
        err(sk, `${skuId}: Distributor_ID ${distributorId} is not in the distributor master`, i);
      }
      data.skus.push({
        skuId,
        skuName,
        category,
        perishability,
        standardReorderQty: qty,
        unitOfMeasure,
        distributorId,
      });
    });
  }
  const skuIds = new Set(data.skus.map((s) => s.skuId));

  // distributors with no SKUs is not an error, but worth knowing
  for (const d of data.distributors) {
    if (skuIds.size && !data.skus.some((s) => s.distributorId === d.distributorId)) {
      warn(dist, `${d.distributorId} has no SKUs`);
    }
  }

  // ----- SKU -> vendor map -----
  const vm = raw.skuVendorMap;
  if (requireColumns(vm, ["SKU_ID", "Vendor_Name", "Zoho_Vendor_ID", "Zoho_Item_ID"])) {
    const seen = new Set<string>();
    vm.rows.forEach((r, i) => {
      const skuId = text(vm, r, "SKU_ID", i);
      const vendorName = text(vm, r, "Vendor_Name", i);
      const zohoVendorId = text(vm, r, "Zoho_Vendor_ID", i);
      const zohoItemId = text(vm, r, "Zoho_Item_ID", i);
      if (!skuId || !vendorName || !zohoVendorId || !zohoItemId) return;
      if (seen.has(skuId)) return err(vm, `duplicate mapping for ${skuId}`, i);
      seen.add(skuId);
      if (skuIds.size && !skuIds.has(skuId)) {
        return err(vm, `${skuId} is not in the SKU master`, i);
      }
      data.skuVendorMap.push({ skuId, vendorName, zohoVendorId, zohoItemId });
    });
    for (const id of skuIds) {
      if (!seen.has(id)) err(vm, `${id} has no vendor mapping`);
    }
    const placeholders = data.skuVendorMap.filter(
      (m) => /^PLACEHOLDER/i.test(m.zohoVendorId) || /^PLACEHOLDER/i.test(m.zohoItemId),
    ).length;
    if (placeholders > 0) {
      warn(
        vm,
        `${placeholders} of ${data.skuVendorMap.length} rows use PLACEHOLDER Zoho IDs; dry-run only, live Zoho needs real IDs`,
      );
    }
  }

  // ----- weekly sales -----
  const ws = raw.weeklySales;
  const parsedWeeks = new Map<string, Set<string>>(); // sku -> weeks present
  const allWeeks: IsoWeek[] = [];
  let zeroWeeks = 0;
  if (requireColumns(ws, ["SKU_ID", "Week", "Units_Sold"])) {
    const seen = new Map<string, number>(); // "sku|week" -> first row
    ws.rows.forEach((r, i) => {
      const skuId = text(ws, r, "SKU_ID", i);
      const weekText = text(ws, r, "Week", i);
      const units = nonNegative(ws, r, "Units_Sold", i);
      if (!skuId || !weekText || units === undefined) return;
      const week = parseIsoWeek(weekText);
      if (!week) return err(ws, `${skuId}: Week "${weekText}" is not a valid ISO week like 2026-W27`, i);
      if (skuIds.size && !skuIds.has(skuId)) {
        return err(ws, `${skuId} is not in the SKU master`, i);
      }
      const isoWeek = formatIsoWeek(week);
      const key = `${skuId}|${isoWeek}`;
      if (seen.has(key)) {
        return err(ws, `duplicate SKU/week ${skuId} ${isoWeek} (first seen on row ${seen.get(key)})`, i);
      }
      seen.set(key, i + 2);
      if (units === 0) zeroWeeks++;
      if (!parsedWeeks.has(skuId)) parsedWeeks.set(skuId, new Set());
      parsedWeeks.get(skuId)!.add(isoWeek);
      allWeeks.push(week);
      data.weeklySales.push({ skuId, isoWeek, weekStart: isoWeekStart(week), units });
    });
    if (zeroWeeks > 0) {
      warn(ws, `${zeroWeeks} week(s) have zero units; the engine routes these as data problems`);
    }
  }

  // Missing weeks: every SKU must have every week in the overall range.
  if (allWeeks.length) {
    const starts = allWeeks.map(isoWeekStart).sort();
    const first = isoWeekOfDate(starts[0]);
    const last = isoWeekOfDate(starts[starts.length - 1]);
    const range: string[] = [];
    for (let w = first; ; w = shiftIsoWeek(w, 1)) {
      range.push(formatIsoWeek(w));
      if (w.year === last.year && w.week === last.week) break;
    }
    for (const id of skuIds) {
      const have = parsedWeeks.get(id);
      if (!have) {
        err(ws, `${id} has no sales rows`);
        continue;
      }
      const missing = range.filter((w) => !have.has(w));
      if (missing.length) err(ws, `${id} is missing week(s): ${missing.join(", ")}`);
    }
  }

  // ----- inventory -----
  const inv = raw.inventory;
  if (requireColumns(inv, ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"])) {
    const seen = new Set<string>();
    inv.rows.forEach((r, i) => {
      const skuId = text(inv, r, "SKU_ID", i);
      const location = text(inv, r, "Location", i);
      const unitsOnHand = nonNegative(inv, r, "Units_On_Hand", i);
      const asOfDate = dateCell(inv, r, "As_Of_Date", i);
      if (!skuId || !location || unitsOnHand === undefined || !asOfDate) return;
      if (skuIds.size && !skuIds.has(skuId)) return err(inv, `${skuId} is not in the SKU master`, i);
      const key = `${skuId}|${location}|${asOfDate}`;
      if (seen.has(key)) return err(inv, `duplicate inventory row for ${skuId} at ${location} on ${asOfDate}`, i);
      seen.add(key);
      data.inventory.push({ skuId, location, unitsOnHand, asOfDate });
    });
    for (const id of skuIds) {
      if (!data.inventory.some((x) => x.skuId === id)) err(inv, `${id} is missing from inventory`);
    }
    const dates = [...new Set(data.inventory.map((x) => x.asOfDate))];
    if (dates.length > 1) warn(inv, `multiple As_Of_Date values: ${dates.sort().join(", ")}`);
  }

  // ----- calendar -----
  const cal = raw.calendar;
  if (requireColumns(cal, ["Year", "Month", "Year_Month", "Is_Festival_Month"])) {
    const seen = new Set<string>();
    cal.rows.forEach((r, i) => {
      const year = wholeNumber(cal, r, "Year", i);
      const month = wholeNumber(cal, r, "Month", i);
      const ym = dateCell(cal, r, "Year_Month", i);
      const isFestivalMonth = boolCell(cal, r, "Is_Festival_Month", i);
      if (year === undefined || month === undefined || !ym || isFestivalMonth === undefined) return;
      if (month < 1 || month > 12) return err(cal, `Month ${month} must be 1-12`, i);
      const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
      if (ym.slice(0, 7) !== yearMonth) {
        return err(cal, `Year_Month ${ym.slice(0, 7)} does not match Year/Month ${yearMonth}`, i);
      }
      if (seen.has(yearMonth)) return err(cal, `duplicate calendar month ${yearMonth}`, i);
      seen.add(yearMonth);
      data.calendar.push({ year, month, yearMonth, isFestivalMonth });
    });
    const festival = [...new Set(data.calendar.filter((c) => c.isFestivalMonth).map((c) => c.month))].sort(
      (a, b) => a - b,
    );
    if (festival.join() !== EXPECTED_FESTIVAL_MONTHS.join()) {
      warn(cal, `festival months are [${festival.join(", ")}], expected [${EXPECTED_FESTIVAL_MONTHS.join(", ")}]`);
    }
    // The engine needs the as-of month in the calendar.
    for (const d of new Set(data.inventory.map((x) => x.asOfDate))) {
      if (!seen.has(d.slice(0, 7))) err(cal, `as-of month ${d.slice(0, 7)} is not in the calendar`);
    }
  }

  // ----- cross-file sanity (warnings) -----
  if (allWeeks.length && data.inventory.length) {
    const lastSales = formatIsoWeek(
      isoWeekOfDate([...allWeeks.map(isoWeekStart)].sort().at(-1)!),
    );
    for (const d of new Set(data.inventory.map((x) => x.asOfDate))) {
      const expectedLast = formatIsoWeek(shiftIsoWeek(isoWeekOfDate(d), -1));
      if (lastSales !== expectedLast) {
        warn(
          ws,
          `latest sales week is ${lastSales} but as-of ${d} expects ${expectedLast} as the last complete week`,
        );
      }
    }
  }

  // ----- expected counts (warnings only) -----
  const counts: [keyof typeof EXPECTED_COUNTS, RawTable, number][] = [
    ["skus", raw.skus, data.skus.length],
    ["weeklySales", raw.weeklySales, data.weeklySales.length],
    ["inventory", raw.inventory, data.inventory.length],
    ["calendar", raw.calendar, data.calendar.length],
    ["distributors", raw.distributors, data.distributors.length],
  ];
  for (const [key, table, actual] of counts) {
    if (actual !== EXPECTED_COUNTS[key]) {
      warn(table, `expected ${EXPECTED_COUNTS[key]} ${key} rows, loaded ${actual}`);
    }
  }

  return errors.length ? { ok: false, errors, warnings } : { ok: true, data, warnings };
}

export function formatIssue(i: SeedIssue): string {
  return `${i.file}${i.row ? ` row ${i.row}` : ""}: ${i.message}`;
}

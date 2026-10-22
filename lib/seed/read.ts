import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { SEED_FILES, type RawRow, type RawSeed, type RawTable } from "./types";

export class SeedReadError extends Error {}

const trimKeys = (row: RawRow): RawRow =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim(), v]));

/** Reads the first sheet (sheet names in these files are GUID-like, so ignore them). */
function readWorkbook(file: string, fullPath: string): RawTable {
  const wb = XLSX.read(readFileSync(fullPath), { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new SeedReadError(`${file}: workbook has no sheets`);
  const rows = XLSX.utils
    .sheet_to_json<RawRow>(wb.Sheets[sheetName], { defval: null, raw: true })
    .map(trimKeys);
  return { file, rows };
}

/** Minimal CSV reader (handles quoted fields). Values stay strings. */
export function parseCsv(content: string): RawRow[] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  const text = content.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      records.push(record);
      record = [];
    } else field += c;
  }
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  const nonEmpty = records.filter((r) => r.some((f) => f.trim() !== ""));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? null])));
}

export function readSeedFiles(dir: string): RawSeed {
  const missing = Object.values(SEED_FILES).filter((f) => !existsSync(path.join(dir, f)));
  if (missing.length) {
    throw new SeedReadError(`Seed file(s) not found in ${dir}: ${missing.join(", ")}`);
  }
  const p = (f: string) => path.join(dir, f);
  return {
    distributors: readWorkbook(SEED_FILES.distributors, p(SEED_FILES.distributors)),
    skus: readWorkbook(SEED_FILES.skus, p(SEED_FILES.skus)),
    skuVendorMap: {
      file: SEED_FILES.skuVendorMap,
      rows: parseCsv(readFileSync(p(SEED_FILES.skuVendorMap), "utf8")),
    },
    weeklySales: readWorkbook(SEED_FILES.weeklySales, p(SEED_FILES.weeklySales)),
    inventory: readWorkbook(SEED_FILES.inventory, p(SEED_FILES.inventory)),
    calendar: readWorkbook(SEED_FILES.calendar, p(SEED_FILES.calendar)),
  };
}

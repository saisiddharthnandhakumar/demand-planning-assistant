import type {
  calendar,
  distributors,
  inventory,
  skus,
  skuVendorMap,
  weeklySales,
} from "@/lib/db/schema";

/** One spreadsheet row keyed by its header. Sheet row number is index + 2. */
export type RawRow = Record<string, unknown>;

export type RawTable = { file: string; rows: RawRow[] };

export type RawSeed = {
  distributors: RawTable;
  skus: RawTable;
  skuVendorMap: RawTable;
  weeklySales: RawTable;
  inventory: RawTable;
  calendar: RawTable;
};

export type SeedData = {
  distributors: (typeof distributors.$inferInsert)[];
  skus: (typeof skus.$inferInsert)[];
  skuVendorMap: (typeof skuVendorMap.$inferInsert)[];
  weeklySales: (typeof weeklySales.$inferInsert)[];
  inventory: (typeof inventory.$inferInsert)[];
  calendar: (typeof calendar.$inferInsert)[];
};

export type SeedIssue = {
  file: string;
  /** Spreadsheet row number (header is row 1), when the issue is tied to a row. */
  row?: number;
  message: string;
};

export type SeedValidation =
  | { ok: true; data: SeedData; warnings: SeedIssue[] }
  | { ok: false; errors: SeedIssue[]; warnings: SeedIssue[] };

/** Expected files, keyed by table. Note "Calender" is the real (misspelled) file name. */
export const SEED_FILES = {
  distributors: "distributor_master.xlsx",
  skus: "SKU_Seed_Data.xlsx",
  skuVendorMap: "sku_vendor_map.csv",
  weeklySales: "Weekly_Sales_Seed_Data.xlsx",
  inventory: "Current_Inventory_Seed_Data.xlsx",
  calendar: "Calender_Seed_Data.xlsx",
} as const;

export const EXPECTED_COUNTS = {
  skus: 15,
  weeklySales: 240,
  inventory: 15,
  calendar: 24,
  distributors: 4,
} as const;

export const EXPECTED_FESTIVAL_MONTHS = [3, 10, 11];

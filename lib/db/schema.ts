import { sql } from "drizzle-orm";
import type { EdgeReason, EventTag, SkuMetrics } from "@/lib/engine/types";
import {
  bigint,
  boolean,
  check,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Column names are snake_case in the database (see `casing` in lib/db/index.ts
// and drizzle.config.ts). Property names here are camelCase.

// ---------------------------------------------------------------------------
// Reference data (loaded by scripts/seed.ts)
// ---------------------------------------------------------------------------

export const distributors = pgTable("distributors", {
  distributorId: text().primaryKey(),
  distributorName: text().notNull(),
  region: text().notNull(),
  status: text().notNull(),
});

export const skus = pgTable(
  "skus",
  {
    skuId: text().primaryKey(),
    skuName: text().notNull(),
    category: text().notNull(),
    perishability: text().$type<"High" | "Low">().notNull(),
    standardReorderQty: integer().notNull(),
    unitOfMeasure: text().notNull(),
    // The downstream distributor who buys from the company. NOT the PO vendor.
    distributorId: text()
      .notNull()
      .references(() => distributors.distributorId),
  },
  (t) => [
    check("skus_perishability_chk", sql`${t.perishability} in ('High', 'Low')`),
    check("skus_standard_qty_chk", sql`${t.standardReorderQty} > 0`),
  ],
);

// The supplier procurement orders from, and the matching Zoho item.
export const skuVendorMap = pgTable("sku_vendor_map", {
  skuId: text()
    .primaryKey()
    .references(() => skus.skuId),
  vendorName: text().notNull(),
  zohoVendorId: text().notNull(),
  zohoItemId: text().notNull(),
});

export const weeklySales = pgTable(
  "weekly_sales",
  {
    skuId: text()
      .notNull()
      .references(() => skus.skuId),
    isoWeek: text().notNull(), // e.g. 2026-W27 (zero padded, sorts correctly)
    weekStart: date({ mode: "string" }).notNull(), // Monday of that ISO week
    units: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.skuId, t.isoWeek] }),
    check("weekly_sales_units_chk", sql`${t.units} >= 0`),
  ],
);

export const inventory = pgTable(
  "inventory",
  {
    skuId: text()
      .notNull()
      .references(() => skus.skuId),
    location: text().notNull(),
    unitsOnHand: integer().notNull(),
    asOfDate: date({ mode: "string" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.skuId, t.location, t.asOfDate] }),
    check("inventory_units_chk", sql`${t.unitsOnHand} >= 0`),
  ],
);

// Source of truth for which months get the festival uplift.
export const calendar = pgTable(
  "calendar",
  {
    year: integer().notNull(),
    month: integer().notNull(),
    yearMonth: text().notNull(), // e.g. 2026-10
    isFestivalMonth: boolean().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.year, t.month] }),
    check("calendar_month_chk", sql`${t.month} between 1 and 12`),
  ],
);

// ---------------------------------------------------------------------------
// Rules (editable without a deploy) and their history
// ---------------------------------------------------------------------------

// Single row (id = 1) holding the current rules document.
export const rules = pgTable(
  "rules",
  {
    id: integer().primaryKey().default(1),
    version: integer().notNull().default(1),
    document: jsonb().notNull(),
    updatedBy: text().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("rules_singleton_chk", sql`${t.id} = 1`)],
);

// One row per previous version, written whenever the rules change.
export const rulesHistory = pgTable("rules_history", {
  id: serial().primaryKey(),
  version: integer().notNull(),
  document: jsonb().notNull(),
  changedBy: text().notNull(),
  changedAt: timestamp({ withTimezone: true }).notNull(),
  supersededAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Runs and decisions (the override log)
// ---------------------------------------------------------------------------

export const runs = pgTable(
  "runs",
  {
    id: uuid().primaryKey().defaultRandom(),
    trigger: text().$type<"cron" | "manual">().notNull(),
    asOfDate: date({ mode: "string" }),
    status: text()
      .$type<"skipped" | "open" | "submitted" | "failed">()
      .notNull(),
    skipReason: text(),
    // Why a run failed (status = failed). A skipped run uses skipReason instead.
    error: text(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp({ withTimezone: true }),
    submittedBy: text(),
    // overridden engine decisions / all engine decisions (edge SKUs excluded)
    overrideRate: numeric({ precision: 6, scale: 4, mode: "number" }),
    // Rules version and document used, so a run can always be explained later.
    rulesVersion: integer(),
    rulesSnapshot: jsonb(),
    // The confirmed event tags that were active for this run, so it can be explained later.
    eventsSnapshot: jsonb().$type<EventTag[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    check("runs_trigger_chk", sql`${t.trigger} in ('cron', 'manual')`),
    check(
      "runs_status_chk",
      sql`${t.status} in ('skipped', 'open', 'submitted', 'failed')`,
    ),
  ],
);

export const runItems = pgTable(
  "run_items",
  {
    runId: uuid()
      .notNull()
      .references(() => runs.id),
    skuId: text()
      .notNull()
      .references(() => skus.skuId),
    metrics: jsonb().$type<SkuMetrics>().notNull(),
    flags: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    // What the rules say. For edge SKUs this is reference only.
    recommendedAction: text(),
    recommendedQty: integer(),
    reason: text(),
    isEdge: boolean().notNull().default(false),
    edgeReasons: jsonb().$type<EdgeReason[]>().notNull().default(sql`'[]'::jsonb`),
    edgeBrief: text(),
    // "ai" when Gemini wrote it and it passed the guardrail, "template" otherwise.
    edgeBriefSource: text().$type<"ai" | "template">(),
    // Why the template was used (shown as a small "AI brief unavailable" note).
    edgeBriefFallbackReason: text(),
    decisionStatus: text()
      .$type<"pending" | "approved" | "edited" | "rejected">()
      .notNull()
      .default("pending"),
    finalAction: text(),
    finalQty: integer(),
    overrideReason: text(),
    overrideNote: text(),
    decidedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.skuId] }),
    check(
      "run_items_status_chk",
      sql`${t.decisionStatus} in ('pending', 'approved', 'edited', 'rejected')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Events (free-text notes turned into confirmed tags)
// ---------------------------------------------------------------------------

export const eventNotes = pgTable("event_notes", {
  id: uuid().primaryKey().defaultRandom(),
  text: text().notNull(),
  tags: jsonb(), // structured tags parsed by Gemini, shown for confirmation
  confirmed: boolean().notNull().default(false),
  active: boolean().notNull().default(false),
  createdBy: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp({ withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Draft purchase orders
// ---------------------------------------------------------------------------

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid()
      .notNull()
      .references(() => runs.id),
    vendor: text().notNull(), // Zoho_Vendor_ID from sku_vendor_map
    vendorName: text(),
    zohoPoId: text(),
    zohoPoUrl: text(),
    // pending: a Zoho call was started (or its outcome is unknown); dry_run: preview only;
    // created: Zoho made a draft; failed: nothing was created, safe to retry.
    status: text()
      .$type<"pending" | "dry_run" | "created" | "failed">()
      .notNull(),
    payload: jsonb().notNull(),
    // The order lines as the planner sees them (SKU, name, Zoho item, quantity).
    lines: jsonb().$type<{ skuId: string; skuName?: string; itemId: string; quantity: number }[]>().notNull().default(sql`'[]'::jsonb`),
    response: jsonb(),
    error: text(),
    // Set when Zoho returned a status other than Draft.
    warning: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One PO per vendor per run: a double-click or retry cannot duplicate.
    unique("purchase_orders_run_vendor_uq").on(t.runId, t.vendor),
    check(
      "purchase_orders_status_chk",
      sql`${t.status} in ('pending', 'dry_run', 'created', 'failed')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Money card, kill switch, audit
// ---------------------------------------------------------------------------

export const lossBaseline = pgTable("loss_baseline", {
  quarter: text().primaryKey(), // e.g. 2026-Q3
  stockoutLossInr: bigint({ mode: "number" }).notNull(),
  writeoffLossInr: bigint({ mode: "number" }).notNull(),
  enteredBy: text(),
  enteredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Single row (id = 1).
export const systemState = pgTable(
  "system_state",
  {
    id: integer().primaryKey().default(1),
    paused: boolean().notNull().default(false),
    reason: text(),
    since: timestamp({ withTimezone: true }),
    consecutiveBreaches: integer().notNull().default(0),
    breachRunIds: jsonb().$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [check("system_state_singleton_chk", sql`${t.id} = 1`)],
);

export const auditLog = pgTable("audit_log", {
  id: serial().primaryKey(),
  at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  actor: text().notNull(),
  action: text().notNull(),
  detail: jsonb(),
});

import { count } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "@/lib/db";
import {
  calendar,
  distributors,
  inventory,
  purchaseOrders,
  runItems,
  runs,
  skus,
  skuVendorMap,
  systemState,
  weeklySales,
} from "@/lib/db/schema";
import type { SeedData } from "./types";

export class SeedWriteError extends Error {}

/**
 * Replaces all reference data in ONE transaction (db.batch), so a failure
 * leaves the database exactly as it was. Refuses to run if runs exist, because
 * replacing SKUs would orphan them; pass reset to wipe runs too.
 */
export async function writeSeed(db: Db, data: SeedData, opts: { reset?: boolean } = {}) {
  const [{ n: runCount }] = await db.select({ n: count() }).from(runs);
  if (runCount > 0 && !opts.reset) {
    throw new SeedWriteError(
      `${runCount} run(s) already exist. Re-seeding would orphan them. Re-run with --reset to wipe runs and decisions as well.`,
    );
  }

  const statements: BatchItem<"pg">[] = [];
  if (opts.reset) {
    statements.push(db.delete(purchaseOrders), db.delete(runItems), db.delete(runs));
  }
  statements.push(
    db.delete(weeklySales),
    db.delete(inventory),
    db.delete(skuVendorMap),
    db.delete(skus),
    db.delete(calendar),
    db.delete(distributors),
    db.insert(distributors).values(data.distributors),
    db.insert(skus).values(data.skus),
    db.insert(skuVendorMap).values(data.skuVendorMap),
    db.insert(weeklySales).values(data.weeklySales),
    db.insert(inventory).values(data.inventory),
    db.insert(calendar).values(data.calendar),
    // The pause flag row must exist; never overwrite an existing one.
    db.insert(systemState).values({ id: 1 }).onConflictDoNothing(),
  );
  await db.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
}

export async function tableCounts(db: Db) {
  const c = async (t: PgTable) => {
    const [{ n }] = await db.select({ n: count() }).from(t);
    return n;
  };
  return {
    distributors: await c(distributors),
    skus: await c(skus),
    sku_vendor_map: await c(skuVendorMap),
    weekly_sales: await c(weeklySales),
    inventory: await c(inventory),
    calendar: await c(calendar),
    system_state: await c(systemState),
  };
}

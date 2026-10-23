import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { auditLog, lossBaseline, purchaseOrders, runItems, runs } from "@/lib/db/schema";
import { MAX_RUPEES, quarterKey, type Quarter } from "@/lib/money";

export interface RunStats {
  id: string;
  status: "skipped" | "open" | "submitted" | "failed";
  trigger: "cron" | "manual";
  asOfDate: string | null;
  startedAt: Date;
  submittedAt: Date | null;
  engineTotal: number;
  overridden: number;
  stockout: number;
  overstock: number;
  highDemand: number;
  noAction: number;
  edge: number;
  items: number;
}

/** One row per run with the counts the dashboard needs. Override counts come from the items, the same definition the kill switch uses. */
export async function getRunStats(db: Db, limit = 30): Promise<RunStats[]> {
  return db
    .select({
      id: runs.id,
      status: runs.status,
      trigger: runs.trigger,
      asOfDate: runs.asOfDate,
      startedAt: runs.startedAt,
      submittedAt: runs.submittedAt,
      items: sql<number>`count(${runItems.skuId})::int`,
      engineTotal: sql<number>`(count(*) filter (where not ${runItems.isEdge}))::int`,
      overridden: sql<number>`(count(*) filter (where not ${runItems.isEdge} and ${runItems.decisionStatus} in ('edited', 'rejected')))::int`,
      stockout: sql<number>`(count(*) filter (where ${runItems.flags} @> '["STOCKOUT_RISK"]'::jsonb))::int`,
      overstock: sql<number>`(count(*) filter (where ${runItems.flags} @> '["OVERSTOCK_RISK"]'::jsonb))::int`,
      highDemand: sql<number>`(count(*) filter (where ${runItems.flags} @> '["HIGH_DEMAND"]'::jsonb))::int`,
      noAction: sql<number>`(count(*) filter (where ${runItems.recommendedAction} = 'NO_ACTION'))::int`,
      edge: sql<number>`(count(*) filter (where ${runItems.isEdge}))::int`,
    })
    .from(runs)
    .leftJoin(runItems, eq(runItems.runId, runs.id))
    .groupBy(runs.id)
    .orderBy(desc(runs.startedAt))
    .limit(limit);
}

export async function listPurchaseOrders(db: Db, limit = 30) {
  return db
    .select({
      id: purchaseOrders.id,
      runId: purchaseOrders.runId,
      vendor: purchaseOrders.vendor,
      vendorName: purchaseOrders.vendorName,
      status: purchaseOrders.status,
      zohoPoId: purchaseOrders.zohoPoId,
      zohoPoUrl: purchaseOrders.zohoPoUrl,
      createdAt: purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .orderBy(desc(purchaseOrders.createdAt))
    .limit(limit);
}

export async function listAuditLog(db: Db, limit = 30) {
  return db.select().from(auditLog).orderBy(desc(auditLog.at), desc(auditLog.id)).limit(limit);
}

export async function getLossBaselines(db: Db) {
  return db.select().from(lossBaseline);
}

/** Enters or replaces a quarter's losses, with an audit entry, in one transaction. */
export async function saveQuarterLoss(
  db: Db,
  args: { quarter: Quarter; stockoutLossInr: number; writeoffLossInr: number; enteredBy: string },
) {
  for (const n of [args.stockoutLossInr, args.writeoffLossInr]) {
    if (!Number.isSafeInteger(n) || n < 0 || n > MAX_RUPEES) throw new Error("Amounts must be whole rupees of zero or more.");
  }
  const key = quarterKey(args.quarter);
  await db.batch([
    db
      .insert(lossBaseline)
      .values({ quarter: key, stockoutLossInr: args.stockoutLossInr, writeoffLossInr: args.writeoffLossInr, enteredBy: args.enteredBy })
      .onConflictDoUpdate({
        target: lossBaseline.quarter,
        set: { stockoutLossInr: args.stockoutLossInr, writeoffLossInr: args.writeoffLossInr, enteredBy: args.enteredBy, enteredAt: new Date() },
      }),
    db.insert(auditLog).values({
      actor: args.enteredBy,
      action: "loss.update",
      detail: { quarter: key, stockoutLossInr: args.stockoutLossInr, writeoffLossInr: args.writeoffLossInr },
    }),
  ]);
}

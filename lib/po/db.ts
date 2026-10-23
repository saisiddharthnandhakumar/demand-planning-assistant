import { and, asc, eq } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";
import { getSystemState } from "@/lib/db/queries";
import { auditLog, purchaseOrders, runItems, runs, skus, skuVendorMap } from "@/lib/db/schema";
import { todayInIst } from "@/lib/money";
import { createZohoClient, readFallbackPurchaseRate, readZohoRuntime } from "@/lib/zoho";
import { buildPurchaseOrders } from "./build";
import { createPurchaseOrders, type CreatePosResult, type PoDeps, type PoStatus } from "./create";

export function dbPoDeps(db: Db, env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): PoDeps {
  return {
    async getRun(runId) {
      const [r] = await db.select({ status: runs.status, submittedBy: runs.submittedBy }).from(runs).where(eq(runs.id, runId));
      return r ?? null;
    },

    getSystemState: async () => {
      const s = await getSystemState(db);
      return { paused: s.paused, reason: s.reason };
    },

    async loadDecisions(runId) {
      const rows = await db
        .select({ skuId: runItems.skuId, skuName: skus.skuName, decisionStatus: runItems.decisionStatus, finalAction: runItems.finalAction, finalQty: runItems.finalQty })
        .from(runItems)
        .innerJoin(skus, eq(skus.skuId, runItems.skuId))
        .where(eq(runItems.runId, runId));
      return rows;
    },

    loadVendorMap: () => db.select().from(skuVendorMap),

    listPos: (runId) => db.select({ vendor: purchaseOrders.vendor, status: purchaseOrders.status, zohoPoId: purchaseOrders.zohoPoId, error: purchaseOrders.error }).from(purchaseOrders).where(eq(purchaseOrders.runId, runId)),

    async claim(runId, po, status, from) {
      const values = { runId, vendor: po.vendorId, vendorName: po.vendorName, status, payload: po.payload, lines: po.lines };
      if (from === null) {
        // The unique (run, vendor) constraint decides a race: only one insert wins.
        const inserted = await db.insert(purchaseOrders).values(values).onConflictDoNothing().returning({ id: purchaseOrders.id });
        return inserted.length === 1;
      }
      // Retry: only if the row is still in the state we saw (compare-and-swap).
      const updated = await db
        .update(purchaseOrders)
        .set({ status, payload: po.payload, lines: po.lines, vendorName: po.vendorName, error: null, warning: null, response: null, zohoPoId: null, zohoPoUrl: null, updatedAt: new Date() })
        .where(and(eq(purchaseOrders.runId, runId), eq(purchaseOrders.vendor, po.vendorId), eq(purchaseOrders.status, from)))
        .returning({ id: purchaseOrders.id });
      return updated.length === 1;
    },

    async finish(runId, vendorId, u) {
      await db
        .update(purchaseOrders)
        .set({
          status: u.status,
          ...(u.zohoPoId !== undefined ? { zohoPoId: u.zohoPoId } : {}),
          ...(u.zohoPoUrl !== undefined ? { zohoPoUrl: u.zohoPoUrl } : {}),
          ...(u.response !== undefined ? { response: u.response } : {}),
          ...(u.error !== undefined ? { error: u.error } : {}),
          ...(u.warning !== undefined ? { warning: u.warning } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(purchaseOrders.runId, runId), eq(purchaseOrders.vendor, vendorId)));
    },

    async audit(action, detail) {
      await db.insert(auditLog).values({ actor: "system", action, detail });
    },

    runtime: readZohoRuntime(env),
    createClient: (config) => createZohoClient(config, { fetch: fetchImpl }),
    purchaseRate: readFallbackPurchaseRate(env),
    today: () => todayInIst(new Date()),
  };
}

/** Creates (or, in dry-run, previews) the draft purchase orders for a submitted run. Idempotent. */
export function createPurchaseOrdersForRun(runId: string): Promise<CreatePosResult> {
  return createPurchaseOrders(dbPoDeps(getDb()), runId);
}

export interface RunPo {
  vendor: string;
  vendorName: string | null;
  status: PoStatus;
  zohoPoId: string | null;
  zohoPoUrl: string | null;
  error: string | null;
  warning: string | null;
  lines: { skuId: string; skuName?: string; itemId: string; quantity: number }[];
  payload: unknown;
  updatedAt: Date;
}

export async function listRunPurchaseOrders(db: Db, runId: string): Promise<RunPo[]> {
  return db
    .select({
      vendor: purchaseOrders.vendor,
      vendorName: purchaseOrders.vendorName,
      status: purchaseOrders.status,
      zohoPoId: purchaseOrders.zohoPoId,
      zohoPoUrl: purchaseOrders.zohoPoUrl,
      error: purchaseOrders.error,
      warning: purchaseOrders.warning,
      lines: purchaseOrders.lines,
      payload: purchaseOrders.payload,
      updatedAt: purchaseOrders.updatedAt,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.runId, runId))
    .orderBy(asc(purchaseOrders.vendorName), asc(purchaseOrders.vendor));
}

/**
 * For an order stuck as "pending" because Zoho's answer was unclear: after a
 * person has checked Zoho and found NO order for this run and vendor, mark it
 * failed so it can be retried. Logged with who did it.
 */
export async function releasePendingPo(db: Db, args: { runId: string; vendor: string; actor: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const released = await db
    .update(purchaseOrders)
    .set({ status: "failed", error: `Released for retry by ${args.actor} after checking Zoho and finding no order for this run and vendor.`, updatedAt: new Date() })
    .where(and(eq(purchaseOrders.runId, args.runId), eq(purchaseOrders.vendor, args.vendor), eq(purchaseOrders.status, "pending")))
    .returning({ id: purchaseOrders.id });
  if (released.length !== 1) return { ok: false, error: "That order is not waiting on an unclear answer, so there is nothing to release." };
  await db.insert(auditLog).values({ actor: args.actor, action: "po.release", detail: { runId: args.runId, vendor: args.vendor } });
  return { ok: true };
}

/** What the run would order, computed from its final decisions (for showing skipped lines and the expected number of orders). */
export async function planRunPurchaseOrders(db: Db, runId: string) {
  const deps = dbPoDeps(db);
  const run = await deps.getRun(runId);
  if (!run) return null;
  const [lines, vendorMap] = await Promise.all([deps.loadDecisions(runId), deps.loadVendorMap()]);
  return buildPurchaseOrders({ runId, lines, vendorMap, date: deps.today(), approvedBy: run.submittedBy ?? "the planner", purchaseRate: deps.purchaseRate });
}

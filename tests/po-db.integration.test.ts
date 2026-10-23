import { config } from "dotenv";
import { eq, like, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { auditLog, purchaseOrders, runItems, runs, skuVendorMap, systemState } from "@/lib/db/schema";
import { dbRunDeps } from "@/lib/runs/db-deps";
import { writeEdgeBriefs } from "@/lib/runs/briefs";
import { bulkApproveUntouched, decideItem, submitRun } from "@/lib/runs/decisions-db";
import { startRun } from "@/lib/runs/start";
import { createPurchaseOrders } from "@/lib/po/create";
import { dbPoDeps, listRunPurchaseOrders, releasePendingPo } from "@/lib/po/db";

// OPT-IN integration test: real database, mocked Zoho. It creates a run and
// purchase_orders rows, edits sku_vendor_map temporarily, and puts everything
// back afterwards, so point it at a dev or branch database.
//   TEST_DATABASE_URL="$(grep ^DATABASE_URL= .env.local | cut -d= -f2-)" npx vitest run po-db
config({ path: ".env.local", quiet: true });
const url = process.env.TEST_DATABASE_URL;

const LIVE_ENV = { ZOHO_MODE: "live", ZOHO_DC: "in", ZOHO_CLIENT_ID: "cid-123456", ZOHO_CLIENT_SECRET: "csecret-123456", ZOHO_REFRESH_TOKEN: "rtoken-123456", ZOHO_ORG_ID: "60012345678" };

/** A fake Zoho: answers token requests and purchase-order creates, and records every call. */
function fakeZoho(onCreate: (body: { vendor_id: string }, n: number) => { status?: number; json?: unknown; throws?: Error }) {
  const calls: { url: string; body?: string }[] = [];
  let creates = 0;
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input);
    calls.push({ url: u, body: init?.body === undefined ? undefined : String(init.body) });
    if (u.includes("/oauth/v2/token")) return new Response(JSON.stringify({ access_token: "ACCESS-TOKEN-XYZ123", api_domain: "https://www.zohoapis.in", expires_in: 3600 }), { status: 200 });
    const r = onCreate(JSON.parse(String(init!.body)), ++creates);
    if (r.throws) throw r.throws;
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  });
  return { fetch: fn as unknown as typeof fetch, calls, creates: () => calls.filter((c) => c.url.includes("/purchaseorders")).length };
}
const ok = (n: number) => ({ json: { code: 0, message: "created", purchase_order: { purchaseorder_id: `ZPO${n}`, purchaseorder_number: `PO-${n}`, status: "draft" } } });

describe.skipIf(!url)("purchase orders against the database", () => {
  const db = url ? getDb(url) : (undefined as never);
  let original: { skuId: string; zohoVendorId: string; zohoItemId: string }[] = [];
  let runId = "";

  const clean = async () => {
    await db.delete(purchaseOrders);
    await db.delete(runItems);
    await db.delete(runs);
    await db.delete(auditLog).where(or(like(auditLog.action, "run.%"), like(auditLog.action, "po.%"), like(auditLog.action, "system.%")));
    await db.update(systemState).set({ paused: false, reason: null, since: null, consecutiveBreaches: 0, breachRunIds: [] }).where(eq(systemState.id, 1));
  };
  const setMap = (real: boolean) =>
    db.execute(
      real
        ? sql`update sku_vendor_map set zoho_vendor_id = replace(zoho_vendor_id, 'PLACEHOLDER_', 'V_'), zoho_item_id = replace(zoho_item_id, 'PLACEHOLDER_', 'I_')`
        : sql`select 1`,
    );

  beforeAll(async () => {
    original = await db.select({ skuId: skuVendorMap.skuId, zohoVendorId: skuVendorMap.zohoVendorId, zohoItemId: skuVendorMap.zohoItemId }).from(skuVendorMap);
    await clean();
    // a real submitted run: engine decisions approved in bulk, the edge SKU decided by hand
    const started = await startRun({ ...dbRunDeps(db), writeBriefs: (r, i) => writeEdgeBriefs(r, i, null) }, { trigger: "manual" });
    if (started.status !== "started") throw new Error("run did not start");
    runId = started.runId;
    await bulkApproveUntouched(db, runId, 14);
    await decideItem(db, runId, "SKU001", { decision: "decide", action: "REORDER_NOW", qty: 700, reasonCategory: "market_event" });
    const sub = await submitRun(db, { runId, submittedBy: "Raghav" });
    if (!sub.ok) throw new Error(sub.error);
  });
  afterAll(async () => {
    for (const m of original) await db.update(skuVendorMap).set({ zohoVendorId: m.zohoVendorId, zohoItemId: m.zohoItemId }).where(eq(skuVendorMap.skuId, m.skuId));
    await clean();
  });

  const dry = () => dbPoDeps(db, { ZOHO_MODE: "dry-run" });
  const live = (fetchImpl: typeof fetch) => dbPoDeps(db, LIVE_ENV, fetchImpl);
  const rows = () => db.select().from(purchaseOrders);

  it("dry-run stores a preview per vendor (the section 6.2 reorders plus the edge decision) and is idempotent", async () => {
    const r = await createPurchaseOrders(dry(), runId);
    expect(r).toMatchObject({ ok: true, mode: "dry-run", skipped: [] });
    const stored = await listRunPurchaseOrders(db, runId);
    expect(stored.map((p) => [p.vendorName, p.status, p.lines.reduce((n, l) => n + l.quantity, 0)])).toEqual([
      ["Placeholder Beverage Supplier", "dry_run", 700], // the planner's 700, not the reference 750
      ["Placeholder Condiments Supplier", "dry_run", 120],
      ["Placeholder Dairy Alt Supplier", "dry_run", 150],
      ["Placeholder Staples Supplier", "dry_run", 800],
    ]);
    const staples = stored.find((p) => p.vendorName?.includes("Staples"))!;
    expect(staples.payload).toMatchObject({ reference_number: runId, line_items: [{ item_id: "PLACEHOLDER_ITEM_SKU003", quantity: 300 }, { item_id: "PLACEHOLDER_ITEM_SKU011", quantity: 500 }] });
    expect(staples.lines[0]).toMatchObject({ skuId: "SKU003", skuName: expect.stringContaining("Brown Rice") });

    const again = await createPurchaseOrders(dry(), runId);
    expect(again.ok && again.outcomes.every((o) => o.result === "already")).toBe(true);
    expect(await rows()).toHaveLength(4);
  });

  it("the database itself refuses a second row for the same run and vendor", async () => {
    const [one] = await rows();
    await expect(db.insert(purchaseOrders).values({ runId, vendor: one.vendor, status: "dry_run", payload: {} })).rejects.toThrow();
    expect(await rows()).toHaveLength(4);
  });

  it("placeholder ids are refused in live mode, with no call to Zoho", async () => {
    const z = fakeZoho(() => ok(1));
    const r = await createPurchaseOrders(live(z.fetch), runId);
    expect(r.ok && r.outcomes.every((o) => o.result === "failed" && /PLACEHOLDER/.test(o.message ?? ""))).toBe(true);
    expect(z.calls).toHaveLength(0);
    expect((await rows()).every((p) => p.status === "failed")).toBe(true);
  });

  describe("with real-looking Zoho ids", () => {
    beforeAll(async () => {
      await setMap(true);
      await db.delete(purchaseOrders);
    });

    it("creates one draft per vendor, with exactly the built payload, and stores the id and link", async () => {
      const z = fakeZoho((_b, n) => ok(n));
      const r = await createPurchaseOrders(live(z.fetch), runId);
      expect(r).toMatchObject({ ok: true, mode: "live" });
      expect(z.creates()).toBe(4);
      const sent = z.calls.filter((c) => c.url.includes("/purchaseorders")).map((c) => JSON.parse(c.body!));
      const staples = sent.find((b) => b.vendor_id === "V_VENDOR_STAPLE")!;
      expect(staples).toEqual({
        vendor_id: "V_VENDOR_STAPLE",
        reference_number: runId,
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        notes: `Prepared by Demand Planning Assistant, approved by Raghav, run ${runId}`,
        line_items: [{ item_id: "I_ITEM_SKU003", quantity: 300 }, { item_id: "I_ITEM_SKU011", quantity: 500 }],
      });
      expect(JSON.stringify(sent)).not.toMatch(/rate|price/);
      const stored = await listRunPurchaseOrders(db, runId);
      expect(stored.every((p) => p.status === "created" && p.zohoPoId?.startsWith("ZPO") && p.zohoPoUrl?.includes("/purchaseorders/"))).toBe(true);
      expect(stored[0].payload).toBeTruthy();
      const audits = (await db.select().from(auditLog).where(eq(auditLog.action, "po.created"))).length;
      expect(audits).toBe(4);
    });

    it("a second submit for the same run does not create a second order, and sends nothing to Zoho", async () => {
      const z = fakeZoho((_b, n) => ok(100 + n));
      const again = await createPurchaseOrders(live(z.fetch), runId);
      expect(again.ok && again.outcomes.every((o) => o.result === "already")).toBe(true);
      expect(z.calls).toHaveLength(0); // not even a token request
      expect(await rows()).toHaveLength(4);
    });

    it("two simultaneous requests create one order per vendor", async () => {
      await db.delete(purchaseOrders);
      const z = fakeZoho((_b, n) => ok(200 + n));
      await Promise.all([createPurchaseOrders(live(z.fetch), runId), createPurchaseOrders(live(z.fetch), runId)]);
      expect(z.creates()).toBe(4);
      expect(await rows()).toHaveLength(4);
      expect((await rows()).every((p) => p.status === "created")).toBe(true);
    });

    it("a failed vendor is retried alone; a rejected order is stored as failed with Zoho's message", async () => {
      await db.delete(purchaseOrders);
      let reject = true;
      const z = fakeZoho((b, n) => (b.vendor_id === "V_VENDOR_DAIRYALT" && reject ? { status: 400, json: { code: 1001, message: "Please enter the purchase_rate." } } : ok(300 + n)));
      await createPurchaseOrders(live(z.fetch), runId);
      let stored = await listRunPurchaseOrders(db, runId);
      expect(Object.fromEntries(stored.map((p) => [p.vendor, p.status]))).toMatchObject({ V_VENDOR_DAIRYALT: "failed", V_VENDOR_STAPLE: "created" });
      expect(stored.find((p) => p.vendor === "V_VENDOR_DAIRYALT")!.error).toBe("Please enter the purchase_rate.");

      reject = false;
      const before = z.creates();
      await createPurchaseOrders(live(z.fetch), runId);
      expect(z.creates()).toBe(before + 1); // only the failed vendor
      stored = await listRunPurchaseOrders(db, runId);
      expect(stored.every((p) => p.status === "created")).toBe(true);
    });

    it("an unclear answer leaves the order pending and blocks retries until a person releases it", async () => {
      await db.delete(purchaseOrders);
      let timeout = true;
      const z = fakeZoho((b, n) => (b.vendor_id === "V_VENDOR_BEVERAGE" && timeout ? { throws: new Error("fetch failed: ETIMEDOUT") } : ok(400 + n)));
      await createPurchaseOrders(live(z.fetch), runId);
      let pending = (await listRunPurchaseOrders(db, runId)).find((p) => p.vendor === "V_VENDOR_BEVERAGE")!;
      expect(pending.status).toBe("pending");
      expect(pending.error).toMatch(/Search Zoho for a purchase order with this run id/);

      timeout = false;
      const before = z.creates();
      const retry = await createPurchaseOrders(live(z.fetch), runId);
      expect(z.creates()).toBe(before); // nothing sent: it might exist already
      expect(retry.ok && retry.outcomes.find((o) => o.vendorId === "V_VENDOR_BEVERAGE")!.result).toBe("in_progress");

      expect(await releasePendingPo(db, { runId, vendor: "V_VENDOR_BEVERAGE", actor: "Raghav" })).toEqual({ ok: true });
      expect(await releasePendingPo(db, { runId, vendor: "V_VENDOR_BEVERAGE", actor: "Raghav" })).toMatchObject({ ok: false }); // no longer pending
      await createPurchaseOrders(live(z.fetch), runId);
      pending = (await listRunPurchaseOrders(db, runId)).find((p) => p.vendor === "V_VENDOR_BEVERAGE")!;
      expect(pending.status).toBe("created");
      expect((await db.select().from(auditLog).where(eq(auditLog.action, "po.release")))).toHaveLength(1);
    });
  });

  it("while the system is paused nothing is stored or sent", async () => {
    await db.delete(purchaseOrders);
    await db.update(systemState).set({ paused: true, reason: "Override rate above 30% in 2 consecutive submitted runs.", since: new Date() }).where(eq(systemState.id, 1));
    const z = fakeZoho((_b, n) => ok(n));
    const r = await createPurchaseOrders(live(z.fetch), runId);
    expect(r).toMatchObject({ ok: false, kind: "blocked" });
    expect(await rows()).toHaveLength(0);
    expect(z.calls).toHaveLength(0);
    await db.update(systemState).set({ paused: false, reason: null, since: null }).where(eq(systemState.id, 1));
  });
});

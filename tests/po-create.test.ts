import { describe, expect, it, vi } from "vitest";
import { createPurchaseOrders, type PoDeps, type PoRow, type PoUpdate } from "@/lib/po/create";
import type { DecisionLine, VendorMapRow } from "@/lib/po/build";
import { ZohoError, type CreatedPurchaseOrder, type ZohoClient, type ZohoRuntime } from "@/lib/zoho";

const RUN = "10fcb145-052a-49a3-af8b-4e099a2ea551";
const REAL_MAP: VendorMapRow[] = [
  { skuId: "SKU001", vendorName: "Beverage Co", zohoVendorId: "V-BEV", zohoItemId: "I-001" },
  { skuId: "SKU003", vendorName: "Staples Ltd", zohoVendorId: "V-STA", zohoItemId: "I-003" },
  { skuId: "SKU011", vendorName: "Staples Ltd", zohoVendorId: "V-STA", zohoItemId: "I-011" },
];
const PLACEHOLDER_MAP: VendorMapRow[] = REAL_MAP.map((m) => ({ ...m, zohoVendorId: `PLACEHOLDER_${m.zohoVendorId}`, zohoItemId: `PLACEHOLDER_${m.zohoItemId}` }));
const DECISIONS: DecisionLine[] = [
  { skuId: "SKU001", decisionStatus: "approved", finalAction: "REORDER_NOW", finalQty: 700 }, // an edge decision
  { skuId: "SKU003", decisionStatus: "approved", finalAction: "REORDER_NOW", finalQty: 300 },
  { skuId: "SKU011", decisionStatus: "edited", finalAction: "REORDER", finalQty: 450 }, // edited from 500
  { skuId: "SKU006", decisionStatus: "rejected", finalAction: "NO_ACTION", finalQty: 0 },
  { skuId: "SKU002", decisionStatus: "approved", finalAction: "NO_ACTION", finalQty: 0 },
];
const LIVE_OK: ZohoRuntime = { mode: "live", ok: true, config: { dc: "in", clientId: "id", clientSecret: "secret", refreshToken: "refresh", orgId: "org" } };

type StoredRow = PoRow & { update?: PoUpdate; payload?: unknown; lines?: unknown };

function setup(opts: { runtime?: ZohoRuntime; map?: VendorMapRow[]; paused?: boolean; runStatus?: string | null; zoho?: (payload: Parameters<ZohoClient["createDraftPurchaseOrder"]>[0], n: number) => CreatedPurchaseOrder | Error; preload?: StoredRow[] } = {}) {
  const rows = new Map<string, StoredRow>((opts.preload ?? []).map((r) => [r.vendor, r]));
  const audits: { action: string; detail: Record<string, unknown> }[] = [];
  let n = 0;
  const create = vi.fn(async (payload: Parameters<ZohoClient["createDraftPurchaseOrder"]>[0]) => {
    const r = (opts.zoho ?? ((_p, i) => madeOrder(`ZPO-${i}`)))(payload, ++n);
    if (r instanceof Error) throw r;
    return r;
  });
  const client: ZohoClient = { createDraftPurchaseOrder: create, listVendors: async () => [], listItems: async () => [] };
  const createClient = vi.fn(() => client);

  const deps: PoDeps = {
    getRun: async () => (opts.runStatus === null ? null : { status: opts.runStatus ?? "submitted", submittedBy: "Raghav" }),
    getSystemState: async () => ({ paused: opts.paused ?? false, reason: opts.paused ? "Override rate above 30% in 2 consecutive submitted runs." : null }),
    loadDecisions: async () => DECISIONS,
    loadVendorMap: async () => opts.map ?? REAL_MAP,
    listPos: async () => [...rows.values()].map(({ vendor, status, zohoPoId, error }) => ({ vendor, status, zohoPoId, error })),
    // atomic, like the unique (run, vendor) constraint plus the compare-and-swap update
    claim: async (_run, po, status, from) => {
      const r = rows.get(po.vendorId);
      if (from === null ? r : !r || r.status !== from) return false;
      rows.set(po.vendorId, { vendor: po.vendorId, status, zohoPoId: null, error: null, payload: po.payload, lines: po.lines });
      return true;
    },
    finish: async (_run, vendorId, u) => {
      const r = rows.get(vendorId)!;
      rows.set(vendorId, { ...r, status: u.status, zohoPoId: u.zohoPoId ?? r.zohoPoId, error: u.error ?? null, update: u });
    },
    audit: async (action, detail) => void audits.push({ action, detail }),
    runtime: opts.runtime ?? { mode: "dry-run" },
    createClient,
    today: () => "2026-10-23",
  };
  return { deps, rows, audits, create, createClient };
}

function madeOrder(id: string, extra: Partial<CreatedPurchaseOrder> = {}): CreatedPurchaseOrder {
  return { poId: id, poNumber: `PO-${id}`, url: `https://inventory.zoho.in/app/org#/purchaseorders/${id}`, status: "draft", raw: { code: 0, id }, ...extra };
}
const outcome = (r: Awaited<ReturnType<typeof createPurchaseOrders>>) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.kind}: ${r.error}`);
  return Object.fromEntries(r.outcomes.map((o) => [o.vendorId, o.result]));
};

describe("guards", () => {
  it("a run that does not exist or is not submitted gets nothing", async () => {
    expect(await createPurchaseOrders(setup({ runStatus: null }).deps, RUN)).toMatchObject({ ok: false, kind: "not_found" });
    for (const status of ["open", "skipped", "failed"]) {
      const s = setup({ runStatus: status, runtime: LIVE_OK });
      expect(await createPurchaseOrders(s.deps, RUN)).toMatchObject({ ok: false, kind: "not_submitted" });
      expect(s.rows.size).toBe(0);
      expect(s.create).not.toHaveBeenCalled();
    }
  });

  it("while the system is paused PO creation is refused: nothing stored, nothing sent (dry-run or live)", async () => {
    for (const runtime of [{ mode: "dry-run" } as ZohoRuntime, LIVE_OK]) {
      const s = setup({ paused: true, runtime });
      const r = await createPurchaseOrders(s.deps, RUN);
      expect(r).toMatchObject({ ok: false, kind: "blocked" });
      expect(!r.ok && r.error).toMatch(/paused \(Override rate above 30% in 2 consecutive submitted runs\).*blocked/);
      expect(s.rows.size).toBe(0);
      expect(s.audits).toEqual([]);
      expect(s.createClient).not.toHaveBeenCalled();
      expect(s.create).not.toHaveBeenCalled();
    }
  });

  it("live mode with missing configuration says what is missing and does nothing", async () => {
    const s = setup({ runtime: { mode: "live", ok: false, missing: ["ZOHO_ORG_ID", "ZOHO_REFRESH_TOKEN"] } });
    const r = await createPurchaseOrders(s.deps, RUN);
    expect(r).toMatchObject({ ok: false, kind: "config" });
    expect(!r.ok && r.error).toContain("ZOHO_ORG_ID, ZOHO_REFRESH_TOKEN");
    expect(s.rows.size).toBe(0);
  });
});

describe("dry-run", () => {
  it("stores one preview per vendor with the exact payload, and makes no Zoho call (it does not even build a client)", async () => {
    const s = setup();
    const r = await createPurchaseOrders(s.deps, RUN);
    expect(r).toMatchObject({ ok: true, mode: "dry-run", skipped: [] });
    expect(outcome(r)).toEqual({ "V-BEV": "dry_run", "V-STA": "dry_run" });
    expect([...s.rows.values()].every((x) => x.status === "dry_run")).toBe(true);
    expect(s.createClient).not.toHaveBeenCalled();
    expect(s.create).not.toHaveBeenCalled();

    expect(s.rows.get("V-STA")!.payload).toEqual({
      vendor_id: "V-STA",
      reference_number: RUN,
      date: "2026-10-23",
      notes: `Prepared by Demand Planning Assistant, approved by Raghav, run ${RUN}`,
      line_items: [{ item_id: "I-003", quantity: 300 }, { item_id: "I-011", quantity: 450 }], // the edited quantity, not 500
    });
    expect(s.rows.get("V-BEV")!.payload).toMatchObject({ line_items: [{ item_id: "I-001", quantity: 700 }] });
  });

  it("running it again is a no-op: no new rows, nothing rewritten", async () => {
    const s = setup();
    await createPurchaseOrders(s.deps, RUN);
    const before = JSON.stringify([...s.rows.entries()]);
    const again = await createPurchaseOrders(s.deps, RUN);
    expect(outcome(again)).toEqual({ "V-BEV": "already", "V-STA": "already" });
    expect(JSON.stringify([...s.rows.entries()])).toBe(before);
    expect(s.rows.size).toBe(2);
  });

  it("records the preview in the audit log", async () => {
    const s = setup();
    await createPurchaseOrders(s.deps, RUN);
    expect(s.audits.map((a) => a.action)).toEqual(["po.dry_run", "po.dry_run"]);
  });

  it("works with the sample placeholder ids, so the whole flow can be previewed", async () => {
    const s = setup({ map: PLACEHOLDER_MAP });
    expect(outcome(await createPurchaseOrders(s.deps, RUN))).toEqual({ "PLACEHOLDER_V-BEV": "dry_run", "PLACEHOLDER_V-STA": "dry_run" });
  });

  it("reports SKUs it could not map instead of dropping them silently", async () => {
    const s = setup({ map: REAL_MAP.filter((m) => m.skuId !== "SKU011") });
    const r = await createPurchaseOrders(s.deps, RUN);
    expect(r.ok && r.skipped).toEqual([{ skuId: "SKU011", quantity: 450, reason: expect.stringMatching(/No vendor mapping/) }]);
    expect(s.rows.get("V-STA")!.payload).toMatchObject({ line_items: [{ item_id: "I-003", quantity: 300 }] });
  });

  it("a run with nothing to order makes no order", async () => {
    const s = setup();
    s.deps.loadDecisions = async () => [{ skuId: "SKU002", decisionStatus: "approved", finalAction: "NO_ACTION", finalQty: 0 }];
    expect(await createPurchaseOrders(s.deps, RUN)).toMatchObject({ ok: true, outcomes: [], skipped: [] });
    expect(s.rows.size).toBe(0);
  });
});

describe("live", () => {
  it("creates exactly one draft per vendor with the built payload, and stores the id, link and Zoho's reply", async () => {
    const s = setup({ runtime: LIVE_OK });
    const r = await createPurchaseOrders(s.deps, RUN);
    expect(r).toMatchObject({ ok: true, mode: "live" });
    expect(outcome(r)).toEqual({ "V-BEV": "created", "V-STA": "created" });
    expect(s.create).toHaveBeenCalledTimes(2);
    expect(s.create.mock.calls.map((c) => c[0].vendor_id).sort()).toEqual(["V-BEV", "V-STA"]);
    const sta = s.create.mock.calls.find((c) => c[0].vendor_id === "V-STA")![0];
    expect(sta.line_items).toEqual([{ item_id: "I-003", quantity: 300 }, { item_id: "I-011", quantity: 450 }]);
    expect(JSON.stringify(sta)).not.toMatch(/rate|price/);
    const row = s.rows.get("V-STA")!;
    expect(row).toMatchObject({ status: "created", zohoPoId: "ZPO-2" });
    expect(row.update).toMatchObject({ zohoPoUrl: expect.stringContaining("/purchaseorders/"), response: expect.anything() });
    expect(s.audits.filter((a) => a.action === "po.created")).toHaveLength(2);
  });

  it("a second submit for the same run and vendor does NOT create a second order", async () => {
    const s = setup({ runtime: LIVE_OK });
    await createPurchaseOrders(s.deps, RUN);
    expect(s.create).toHaveBeenCalledTimes(2);
    const again = await createPurchaseOrders(s.deps, RUN);
    expect(outcome(again)).toEqual({ "V-BEV": "already", "V-STA": "already" });
    expect(s.create).toHaveBeenCalledTimes(2); // still two: nothing new went to Zoho
    expect(s.rows.size).toBe(2);
  });

  it("two simultaneous requests (a double-click) still create one order per vendor", async () => {
    const s = setup({ runtime: LIVE_OK });
    const [a, b] = await Promise.all([createPurchaseOrders(s.deps, RUN), createPurchaseOrders(s.deps, RUN)]);
    expect(s.create).toHaveBeenCalledTimes(2);
    const results = [a, b].flatMap((r) => (r.ok ? r.outcomes.map((o) => o.result) : []));
    expect(results.filter((x) => x === "created")).toHaveLength(2);
    expect(results.filter((x) => x === "in_progress" || x === "already")).toHaveLength(2);
  });

  it("one vendor failing does not stop the others, and a retry only attempts the failed one", async () => {
    let first = true;
    const s = setup({
      runtime: LIVE_OK,
      zoho: (p, i) => (p.vendor_id === "V-STA" && first ? new ZohoError("Please enter the purchase_rate for line item 1.", "rejected", 1001, 400) : madeOrder(`ZPO-${i}`)),
    });
    const r = await createPurchaseOrders(s.deps, RUN);
    expect(outcome(r)).toEqual({ "V-BEV": "created", "V-STA": "failed" });
    expect(r.ok && r.outcomes.find((o) => o.vendorId === "V-STA")!.message).toBe("Please enter the purchase_rate for line item 1.");
    expect(s.rows.get("V-STA")).toMatchObject({ status: "failed", error: "Please enter the purchase_rate for line item 1." });

    first = false;
    const callsBefore = s.create.mock.calls.length;
    const retry = await createPurchaseOrders(s.deps, RUN);
    expect(outcome(retry)).toEqual({ "V-BEV": "already", "V-STA": "created" });
    expect(s.create).toHaveBeenCalledTimes(callsBefore + 1); // only the failed vendor was attempted
  });

  it("an unclear answer from Zoho keeps the slot taken and is never retried automatically", async () => {
    let unclear = true;
    const s = setup({ runtime: LIVE_OK, zoho: (p, i) => (p.vendor_id === "V-BEV" && unclear ? new ZohoError("No clear answer from Zoho (ETIMEDOUT).", "unknown") : madeOrder(`ZPO-${i}`)) });
    const r = await createPurchaseOrders(s.deps, RUN);
    expect(outcome(r)).toEqual({ "V-BEV": "unknown", "V-STA": "created" });
    expect(s.rows.get("V-BEV")!.status).toBe("pending");
    expect(s.rows.get("V-BEV")!.error).toMatch(/Search Zoho for a purchase order with this run id/);
    expect(s.audits.some((a) => a.action === "po.unknown")).toBe(true);

    unclear = false;
    const callsBefore = s.create.mock.calls.length;
    const retry = await createPurchaseOrders(s.deps, RUN);
    expect(outcome(retry)).toEqual({ "V-BEV": "in_progress", "V-STA": "already" });
    expect(s.create).toHaveBeenCalledTimes(callsBefore); // no call at all: it might already exist
  });

  it("an auth failure is a safe failure (nothing was sent) and can be retried", async () => {
    const s = setup({ runtime: LIVE_OK, zoho: () => new ZohoError("Zoho refused the token request (invalid_client).", "auth") });
    const r = await createPurchaseOrders(s.deps, RUN);
    expect(outcome(r)).toEqual({ "V-BEV": "failed", "V-STA": "failed" });
    expect([...s.rows.values()].every((x) => x.status === "failed")).toBe(true);
  });

  it("placeholder ids are refused in live mode with no call to Zoho", async () => {
    const s = setup({ runtime: LIVE_OK, map: PLACEHOLDER_MAP });
    const r = await createPurchaseOrders(s.deps, RUN);
    expect(outcome(r)).toEqual({ "PLACEHOLDER_V-BEV": "failed", "PLACEHOLDER_V-STA": "failed" });
    expect(r.ok && r.outcomes[0].message).toMatch(/PLACEHOLDER Zoho ids.*Nothing was sent to Zoho/);
    expect(s.create).not.toHaveBeenCalled();
  });

  it("a preview made earlier in dry-run is replaced by a real order when live mode is turned on", async () => {
    const dry = setup();
    await createPurchaseOrders(dry.deps, RUN);
    const live = setup({ runtime: LIVE_OK, preload: [...dry.rows.values()] });
    expect(outcome(await createPurchaseOrders(live.deps, RUN))).toEqual({ "V-BEV": "created", "V-STA": "created" });
    expect(live.create).toHaveBeenCalledTimes(2);
  });

  it("a status other than Draft from Zoho is recorded as a warning on the order", async () => {
    const s = setup({ runtime: LIVE_OK, zoho: (_p, i) => madeOrder(`ZPO-${i}`, { status: "open", statusWarning: 'Zoho returned status "open" instead of Draft.' }) });
    await createPurchaseOrders(s.deps, RUN);
    expect(s.rows.get("V-STA")!.update).toMatchObject({ warning: expect.stringContaining('"open" instead of Draft') });
  });

  it("uses the configured purchase rate only when one is set", async () => {
    const withRate = setup({ runtime: LIVE_OK });
    withRate.deps.purchaseRate = 12.5;
    await createPurchaseOrders(withRate.deps, RUN);
    expect(withRate.create.mock.calls[0][0].line_items.every((l) => l.purchase_rate === 12.5)).toBe(true);
    const without = setup({ runtime: LIVE_OK });
    await createPurchaseOrders(without.deps, RUN);
    expect(without.create.mock.calls.every((c) => c[0].line_items.every((l) => !("purchase_rate" in l)))).toBe(true);
  });

  it("builds the Zoho client once per call, only in live mode", async () => {
    const s = setup({ runtime: LIVE_OK });
    await createPurchaseOrders(s.deps, RUN);
    expect(s.createClient).toHaveBeenCalledTimes(1);
  });
});

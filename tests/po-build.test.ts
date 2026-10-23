import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPurchaseOrders, isOrderLine, type DecisionLine, type VendorMapRow } from "@/lib/po/build";
import { parseCsv } from "@/lib/seed/read";

const RUN = "10fcb145-052a-49a3-af8b-4e099a2ea551";
const map: VendorMapRow[] = [
  { skuId: "SKU001", vendorName: "Beverage Co", zohoVendorId: "V-BEV", zohoItemId: "I-001" },
  { skuId: "SKU007", vendorName: "Beverage Co", zohoVendorId: "V-BEV", zohoItemId: "I-007" },
  { skuId: "SKU003", vendorName: "Staples Ltd", zohoVendorId: "V-STA", zohoItemId: "I-003" },
  { skuId: "SKU004", vendorName: "Dairy Alt", zohoVendorId: "V-DAI", zohoItemId: "I-004" },
];
const line = (skuId: string, finalAction: string | null, finalQty: number | null, decisionStatus = "approved"): DecisionLine => ({ skuId, finalAction, finalQty, decisionStatus });
const build = (lines: DecisionLine[], extra: Partial<Parameters<typeof buildPurchaseOrders>[0]> = {}) =>
  buildPurchaseOrders({ runId: RUN, lines, vendorMap: map, date: "2026-10-23", approvedBy: "Raghav", ...extra });

describe("which decisions become order lines", () => {
  it("approved or edited REORDER and REORDER_NOW with a positive quantity", () => {
    expect(isOrderLine(line("S", "REORDER_NOW", 300))).toBe(true);
    expect(isOrderLine(line("S", "REORDER", 150, "edited"))).toBe(true);
  });

  it("not pause, no-action, rejected, pending, zero or fractional quantities", () => {
    expect(isOrderLine(line("S", "PAUSE_ORDER", 0))).toBe(false);
    expect(isOrderLine(line("S", "NO_ACTION", 0))).toBe(false);
    expect(isOrderLine(line("S", "REORDER_NOW", 300, "rejected"))).toBe(false);
    expect(isOrderLine(line("S", "REORDER_NOW", 300, "pending"))).toBe(false);
    expect(isOrderLine(line("S", "REORDER", 0))).toBe(false);
    expect(isOrderLine(line("S", "REORDER", null))).toBe(false);
    expect(isOrderLine(line("S", "REORDER", 2.5))).toBe(false);
    expect(isOrderLine(line("S", null, 10))).toBe(false);
  });

  it("an edge SKU's decision with an order quantity counts, one without does not", () => {
    // edge decisions are stored as status "approved" with the planner's own action and quantity
    expect(build([line("SKU001", "REORDER_NOW", 700)]).orders[0].lines).toEqual([{ skuId: "SKU001", itemId: "I-001", quantity: 700, skuName: undefined }]);
    expect(build([line("SKU001", "NO_ACTION", 0)]).orders).toEqual([]);
  });
});

describe("one draft purchase order per vendor", () => {
  const lines = [line("SKU003", "REORDER_NOW", 300), line("SKU001", "REORDER_NOW", 700), line("SKU007", "REORDER", 400), line("SKU004", "REORDER_NOW", 100, "edited")];

  it("groups lines by the vendor in the map, not by distributor", () => {
    const { orders } = build(lines);
    expect(orders.map((o) => [o.vendorId, o.lines.map((l) => l.skuId)])).toEqual([
      ["V-BEV", ["SKU001", "SKU007"]], // Beverage Co (sorted by vendor name)
      ["V-DAI", ["SKU004"]],
      ["V-STA", ["SKU003"]],
    ]);
  });

  it("uses the final quantity (an edit overrides the recommendation) and totals units per order", () => {
    const { orders } = build(lines);
    expect(orders.find((o) => o.vendorId === "V-BEV")).toMatchObject({ totalUnits: 1100 });
    expect(orders.find((o) => o.vendorId === "V-DAI")!.lines[0].quantity).toBe(100);
  });

  it("is deterministic whatever order the decisions arrive in", () => {
    expect(build([...lines].reverse())).toEqual(build(lines));
  });

  it("makes no order for a run with nothing to buy", () => {
    expect(build([line("SKU003", "NO_ACTION", 0), line("SKU004", "REORDER_NOW", 50, "rejected")])).toEqual({ orders: [], skipped: [] });
  });
});

describe("the Zoho payload", () => {
  const { orders } = build([line("SKU003", "REORDER_NOW", 300), line("SKU001", "REORDER", 700)]);
  const sta = orders.find((o) => o.vendorId === "V-STA")!;

  it("has vendor, reference (the run id), date, notes and line items, and nothing else", () => {
    expect(sta.payload).toEqual({
      vendor_id: "V-STA",
      reference_number: RUN,
      date: "2026-10-23",
      notes: `Prepared by Demand Planning Assistant, approved by Raghav, run ${RUN}`,
      line_items: [{ item_id: "I-003", quantity: 300 }],
    });
    expect(Object.keys(sta.payload).sort()).toEqual(["date", "line_items", "notes", "reference_number", "vendor_id"]);
  });

  it("never carries a price unless one is explicitly configured", () => {
    const text = JSON.stringify(orders.map((o) => o.payload));
    expect(text).not.toMatch(/rate|price|amount|total|discount|tax/i);
    expect(buildPurchaseOrders({ runId: RUN, lines: [line("SKU003", "REORDER", 5)], vendorMap: map, date: "2026-10-23", approvedBy: "R", purchaseRate: 12.5 }).orders[0].payload.line_items).toEqual([
      { item_id: "I-003", quantity: 5, purchase_rate: 12.5 },
    ]);
  });

  it("does not set a status, so Zoho creates the order as a draft and nothing here issues or sends it", () => {
    for (const o of orders) expect(o.payload).not.toHaveProperty("status");
  });
});

describe("missing or placeholder mappings", () => {
  it("skips a line with no vendor mapping and says why, instead of inventing a vendor", () => {
    const r = build([line("SKU003", "REORDER_NOW", 300), line("SKU999", "REORDER", 50)]);
    expect(r.orders).toHaveLength(1);
    expect(r.skipped).toEqual([{ skuId: "SKU999", quantity: 50, reason: expect.stringMatching(/No vendor mapping/) }]);
  });

  it("flags placeholder vendor or item ids so they can be previewed but never sent", () => {
    const placeholder: VendorMapRow[] = [
      { skuId: "SKU001", vendorName: "Placeholder Beverage Supplier", zohoVendorId: "PLACEHOLDER_VENDOR_BEVERAGE", zohoItemId: "PLACEHOLDER_ITEM_SKU001" },
      { skuId: "SKU003", vendorName: "Real Vendor", zohoVendorId: "V-REAL", zohoItemId: "PLACEHOLDER_ITEM_SKU003" },
      { skuId: "SKU004", vendorName: "Fully Real", zohoVendorId: "V-OK", zohoItemId: "I-004" },
    ];
    const { orders } = buildPurchaseOrders({
      runId: RUN, vendorMap: placeholder, date: "2026-10-23", approvedBy: "R",
      lines: [line("SKU001", "REORDER", 1), line("SKU003", "REORDER", 1), line("SKU004", "REORDER", 1)],
    });
    expect(Object.fromEntries(orders.map((o) => [o.vendorId, o.hasPlaceholderIds]))).toEqual({ PLACEHOLDER_VENDOR_BEVERAGE: true, "V-REAL": true, "V-OK": false });
  });
});

describe("on the real seed files", () => {
  const rows = parseCsv(readFileSync(path.resolve(__dirname, "../seed/sku_vendor_map.csv"), "utf8"));
  const seedMap: VendorMapRow[] = rows.map((r) => ({ skuId: String(r.SKU_ID), vendorName: String(r.Vendor_Name), zohoVendorId: String(r.Zoho_Vendor_ID), zohoItemId: String(r.Zoho_Item_ID) }));

  it("the section 6.2 reorders (SKU001 750, 003 300, 004 150, 011 500, 013 120) make one PO per seed vendor", () => {
    const { orders, skipped } = buildPurchaseOrders({
      runId: RUN, vendorMap: seedMap, date: "2026-10-23", approvedBy: "Raghav",
      lines: [line("SKU001", "REORDER_NOW", 750), line("SKU003", "REORDER_NOW", 300), line("SKU004", "REORDER_NOW", 150), line("SKU011", "REORDER_NOW", 500), line("SKU013", "REORDER_NOW", 120)],
    });
    expect(skipped).toEqual([]);
    expect(orders.map((o) => [o.vendorName, o.totalUnits])).toEqual([
      ["Placeholder Beverage Supplier", 750], // SKU001
      ["Placeholder Condiments Supplier", 120], // SKU013
      ["Placeholder Dairy Alt Supplier", 150], // SKU004
      ["Placeholder Staples Supplier", 800], // SKU003 + SKU011
    ]);
    expect(orders.every((o) => o.hasPlaceholderIds)).toBe(true); // the sample map is placeholders only
  });
});

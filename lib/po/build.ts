import { isOrderAction } from "@/lib/decisions";

// Turns the planner's final decisions into one draft purchase order per vendor.
// Pure: no network, no database. Prices are never invented: a line carries only
// the Zoho item id and a quantity (plus an optional, explicitly configured
// purchase rate, see `purchaseRate`).

export interface DecisionLine {
  skuId: string;
  skuName?: string;
  decisionStatus: string;
  finalAction: string | null;
  finalQty: number | null;
}

export interface VendorMapRow {
  skuId: string;
  vendorName: string;
  zohoVendorId: string;
  zohoItemId: string;
}

export interface ZohoPoPayload {
  vendor_id: string;
  reference_number: string;
  date: string;
  notes: string;
  line_items: { item_id: string; quantity: number; purchase_rate?: number }[];
}

export interface PlannedPo {
  vendorId: string;
  vendorName: string;
  payload: ZohoPoPayload;
  lines: { skuId: string; skuName?: string; itemId: string; quantity: number }[];
  totalUnits: number;
  /** True when the vendor or any item id is still a PLACEHOLDER from the sample map: such an order can be previewed but never sent to Zoho. */
  hasPlaceholderIds: boolean;
}

export interface SkippedLine {
  skuId: string;
  quantity: number;
  reason: string;
}

const isPlaceholder = (id: string) => /^PLACEHOLDER/i.test(id);

/** A decision becomes an order line only if it ends in an order action with a positive whole quantity. */
export function isOrderLine(l: DecisionLine): boolean {
  return (l.decisionStatus === "approved" || l.decisionStatus === "edited") && isOrderAction(l.finalAction) && Number.isInteger(l.finalQty) && (l.finalQty ?? 0) >= 1;
}

export function buildPurchaseOrders(args: {
  runId: string;
  lines: readonly DecisionLine[];
  vendorMap: readonly VendorMapRow[];
  /** "YYYY-MM-DD" */
  date: string;
  approvedBy: string;
  /** Optional, from configuration only. When unset no price is sent. */
  purchaseRate?: number;
}): { orders: PlannedPo[]; skipped: SkippedLine[] } {
  const mapBySku = new Map(args.vendorMap.map((m) => [m.skuId, m]));
  const byVendor = new Map<string, PlannedPo>();
  const skipped: SkippedLine[] = [];

  for (const line of [...args.lines].filter(isOrderLine).sort((a, b) => a.skuId.localeCompare(b.skuId))) {
    const map = mapBySku.get(line.skuId);
    const quantity = line.finalQty as number;
    if (!map) {
      skipped.push({ skuId: line.skuId, quantity, reason: "No vendor mapping for this SKU, so no purchase order line can be made." });
      continue;
    }
    let po = byVendor.get(map.zohoVendorId);
    if (!po) {
      po = {
        vendorId: map.zohoVendorId,
        vendorName: map.vendorName,
        payload: {
          vendor_id: map.zohoVendorId,
          reference_number: args.runId,
          date: args.date,
          notes: `Prepared by Demand Planning Assistant, approved by ${args.approvedBy}, run ${args.runId}`,
          line_items: [],
        },
        lines: [],
        totalUnits: 0,
        hasPlaceholderIds: isPlaceholder(map.zohoVendorId),
      };
      byVendor.set(map.zohoVendorId, po);
    }
    po.lines.push({ skuId: line.skuId, skuName: line.skuName, itemId: map.zohoItemId, quantity });
    po.payload.line_items.push({
      item_id: map.zohoItemId,
      quantity,
      ...(args.purchaseRate !== undefined ? { purchase_rate: args.purchaseRate } : {}),
    });
    po.totalUnits += quantity;
    if (isPlaceholder(map.zohoItemId)) po.hasPlaceholderIds = true;
  }

  const orders = [...byVendor.values()].sort((a, b) => a.vendorName.localeCompare(b.vendorName) || a.vendorId.localeCompare(b.vendorId));
  return { orders, skipped };
}

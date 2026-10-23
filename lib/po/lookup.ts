import type { ZohoItem, ZohoVendor } from "@/lib/zoho";

// Helps fill sku_vendor_map.csv from what exists in Zoho. Read-only, pure.

export interface MapSuggestion {
  skuId: string;
  /** Zoho item whose SKU code equals our SKU id (the reliable match). */
  itemId: string | null;
  itemName: string | null;
  /** Several Zoho items carry this SKU code: the person must pick. */
  ambiguousItems: ZohoItem[];
}

/** Matches our SKU ids to Zoho items by the item's SKU code. A name is never guessed. */
export function suggestItems(skuIds: readonly string[], items: readonly ZohoItem[]): MapSuggestion[] {
  const byCode = new Map<string, ZohoItem[]>();
  for (const it of items) if (it.sku) byCode.set(it.sku.trim().toUpperCase(), [...(byCode.get(it.sku.trim().toUpperCase()) ?? []), it]);
  return skuIds.map((skuId) => {
    const hits = byCode.get(skuId.toUpperCase()) ?? [];
    return { skuId, itemId: hits.length === 1 ? hits[0].id : null, itemName: hits.length === 1 ? hits[0].name : null, ambiguousItems: hits.length > 1 ? hits : [] };
  });
}

/** A plain text report: vendors, then each SKU with its matched Zoho item or what is missing. */
export function formatLookupReport(args: { vendors: readonly ZohoVendor[]; suggestions: readonly MapSuggestion[]; itemCount: number }): string {
  const lines: string[] = [];
  lines.push(`Vendors in Zoho (${args.vendors.length}). Copy the id into Zoho_Vendor_ID:`);
  for (const v of args.vendors) lines.push(`  ${v.id}  ${v.name}`);
  lines.push("", `Items in Zoho: ${args.itemCount}. Matched by the item's SKU code:`);
  for (const s of args.suggestions) {
    if (s.itemId) lines.push(`  ${s.skuId}  ->  ${s.itemId}  (${s.itemName})`);
    else if (s.ambiguousItems.length) lines.push(`  ${s.skuId}  ->  AMBIGUOUS: ${s.ambiguousItems.map((i) => `${i.id} (${i.name})`).join(", ")}`);
    else lines.push(`  ${s.skuId}  ->  NOT FOUND (create an item in Zoho with SKU "${s.skuId}", or put its id in by hand)`);
  }
  const missing = args.suggestions.filter((s) => !s.itemId).length;
  lines.push("", missing === 0 ? "Every SKU has a matching Zoho item." : `${missing} SKU(s) still need a Zoho item.`);
  return lines.join("\n");
}

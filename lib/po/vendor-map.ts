// Validation for replacing the SKU -> vendor map (seed/sku_vendor_map.csv). Pure.

export interface VendorMapInput {
  skuId: string;
  vendorName: string;
  zohoVendorId: string;
  zohoItemId: string;
}

export type VendorMapCheck =
  | { ok: true; rows: VendorMapInput[]; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

const REQUIRED = ["SKU_ID", "Vendor_Name", "Zoho_Vendor_ID", "Zoho_Item_ID"];

/**
 * Checks the rows before they replace the live map: every column present, no
 * blanks, no duplicate SKU, every SKU known, and every known SKU mapped. Placeholder ids
 * are allowed (the app can still preview) but are reported.
 */
export function validateVendorMap(rows: Record<string, unknown>[], knownSkuIds: readonly string[]): VendorMapCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (rows.length === 0) return { ok: false, errors: ["The file has no rows."], warnings };
  const missing = REQUIRED.filter((c) => !(c in rows[0]));
  if (missing.length) return { ok: false, errors: [`Missing column(s): ${missing.join(", ")}.`], warnings };

  const known = new Set(knownSkuIds);
  const seen = new Set<string>();
  const out: VendorMapInput[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const v = (k: string) => String(r[k] ?? "").trim();
    const row = { skuId: v("SKU_ID"), vendorName: v("Vendor_Name"), zohoVendorId: v("Zoho_Vendor_ID"), zohoItemId: v("Zoho_Item_ID") };
    const blanks = REQUIRED.filter((k) => v(k) === "");
    if (blanks.length) return void errors.push(`Row ${line}: ${blanks.join(", ")} is empty.`);
    if (!known.has(row.skuId)) return void errors.push(`Row ${line}: ${row.skuId} is not a SKU in the database.`);
    if (seen.has(row.skuId)) return void errors.push(`Row ${line}: ${row.skuId} appears more than once.`);
    seen.add(row.skuId);
    out.push(row);
  });
  for (const id of known) if (!seen.has(id)) errors.push(`${id} has no row, so its orders could not be placed.`);

  const placeholders = out.filter((r) => /^PLACEHOLDER/i.test(r.zohoVendorId) || /^PLACEHOLDER/i.test(r.zohoItemId)).length;
  if (placeholders) warnings.push(`${placeholders} of ${out.length} rows still use PLACEHOLDER ids. Orders for them can be previewed but will not be sent to Zoho.`);
  return errors.length ? { ok: false, errors, warnings } : { ok: true, rows: out, warnings };
}

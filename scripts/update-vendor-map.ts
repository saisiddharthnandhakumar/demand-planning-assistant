import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import { auditLog, skus, skuVendorMap } from "@/lib/db/schema";
import { validateVendorMap } from "@/lib/po/vendor-map";
import { parseCsv } from "@/lib/seed/read";

// Replaces ONLY the SKU -> vendor map from seed/sku_vendor_map.csv, in one
// transaction. Unlike `npm run seed` this never touches runs, decisions or rules,
// so it is safe to use once the system is in use.  Usage: npm run vendor-map:update
config({ path: ".env.local", quiet: true });

async function main() {
  const file = path.resolve(process.argv[2] ?? "seed/sku_vendor_map.csv");
  const db = getDb();
  const known = (await db.select({ id: skus.skuId }).from(skus)).map((s) => s.id);
  const check = validateVendorMap(parseCsv(readFileSync(file, "utf8")), known);
  for (const w of check.warnings) console.warn(`  warning  ${w}`);
  if (!check.ok) {
    console.error(`\nNot updated. ${check.errors.length} problem(s) in ${file}:`);
    for (const e of check.errors) console.error(`  error    ${e}`);
    process.exit(1);
  }
  await db.batch([
    db.delete(skuVendorMap),
    db.insert(skuVendorMap).values(check.rows.map((r) => ({ skuId: r.skuId, vendorName: r.vendorName, zohoVendorId: r.zohoVendorId, zohoItemId: r.zohoItemId }))),
    db.insert(auditLog).values({ actor: "script", action: "vendor_map.update", detail: { rows: check.rows.length, file: path.basename(file) } }),
  ]);
  console.log(`\nVendor map updated: ${check.rows.length} rows from ${file}.`);
}

main().catch((e) => {
  console.error("Failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

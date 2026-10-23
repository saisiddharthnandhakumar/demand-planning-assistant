import { config } from "dotenv";
import { getDb } from "@/lib/db";
import { skus } from "@/lib/db/schema";
import { formatLookupReport, suggestItems } from "@/lib/po/lookup";
import { createZohoClient, ZOHO_DOMAINS } from "@/lib/zoho";

// Read-only: lists your Zoho vendors and items so their ids can go into
// seed/sku_vendor_map.csv. Needs ZOHO_DC, ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET,
// ZOHO_REFRESH_TOKEN and ZOHO_ORG_ID in .env.local (works in dry-run mode too),
// and the scopes ZohoInventory.contacts.READ and ZohoInventory.items.READ.
config({ path: ".env.local", quiet: true });

async function main() {
  const env = process.env;
  const dc = env.ZOHO_DC?.trim().toLowerCase() ?? "";
  const need = ["ZOHO_DC", "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORG_ID"].filter((n) => !env[n]?.trim());
  if (need.length || !ZOHO_DOMAINS[dc]) {
    throw new Error(`Set ${need.join(", ") || "a valid ZOHO_DC"} in .env.local first (see docs/SETUP-SERVICES.md).`);
  }
  const client = createZohoClient({ dc, clientId: env.ZOHO_CLIENT_ID!.trim(), clientSecret: env.ZOHO_CLIENT_SECRET!.trim(), refreshToken: env.ZOHO_REFRESH_TOKEN!.trim(), orgId: env.ZOHO_ORG_ID!.trim() });
  const [vendors, items, skuRows] = await Promise.all([client.listVendors(), client.listItems(), getDb().select({ id: skus.skuId }).from(skus).orderBy(skus.skuId)]);
  console.log(formatLookupReport({ vendors, itemCount: items.length, suggestions: suggestItems(skuRows.map((s) => s.id), items) }));
}

main().catch((e) => {
  console.error("Lookup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

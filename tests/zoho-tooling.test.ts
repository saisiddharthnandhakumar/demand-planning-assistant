import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { formatLookupReport, suggestItems } from "@/lib/po/lookup";
import { validateVendorMap } from "@/lib/po/vendor-map";
import { parseCsv } from "@/lib/seed/read";
import { exchangeGrantCode } from "@/lib/zoho";

const SKUS = ["SKU001", "SKU002", "SKU003"];
const row = (skuId: string, v = "V1", i = `I-${skuId}`) => ({ SKU_ID: skuId, Vendor_Name: "Vendor", Zoho_Vendor_ID: v, Zoho_Item_ID: i });

describe("validateVendorMap", () => {
  it("accepts a complete map and returns trimmed rows", () => {
    const r = validateVendorMap([row("SKU001"), row("SKU002"), { ...row("SKU003"), Vendor_Name: "  Spaced  " }], SKUS);
    expect(r).toMatchObject({ ok: true, warnings: [] });
    expect(r.ok && r.rows[2]).toEqual({ skuId: "SKU003", vendorName: "Spaced", zohoVendorId: "V1", zohoItemId: "I-SKU003" });
  });

  it("rejects every kind of mistake, naming the row", () => {
    const r = validateVendorMap([row("SKU001"), row("SKU001"), { ...row("SKU002"), Zoho_Item_ID: " " }, row("SKU999")], SKUS);
    expect(r.ok).toBe(false);
    const e = !r.ok ? r.errors.join("\n") : "";
    expect(e).toContain("Row 3: SKU001 appears more than once.");
    expect(e).toContain("Row 4: Zoho_Item_ID is empty.");
    expect(e).toContain("Row 5: SKU999 is not a SKU in the database.");
    expect(e).toContain("SKU003 has no row");
  });

  it("rejects a missing column or an empty file", () => {
    expect(validateVendorMap([{ SKU_ID: "SKU001" }], SKUS)).toMatchObject({ ok: false, errors: [expect.stringContaining("Zoho_Vendor_ID")] });
    expect(validateVendorMap([], SKUS)).toMatchObject({ ok: false });
  });

  it("allows placeholders but says how many", () => {
    const r = validateVendorMap([row("SKU001", "PLACEHOLDER_V"), row("SKU002"), row("SKU003", "V1", "PLACEHOLDER_I")], SKUS);
    expect(r.ok && r.warnings).toEqual(["2 of 3 rows still use PLACEHOLDER ids. Orders for them can be previewed but will not be sent to Zoho."]);
  });

  it("the real seed file is valid for the 15 seed SKUs and is all placeholders", () => {
    const rows = parseCsv(readFileSync(path.resolve(__dirname, "../seed/sku_vendor_map.csv"), "utf8"));
    const ids = Array.from({ length: 15 }, (_, i) => `SKU${String(i + 1).padStart(3, "0")}`);
    const r = validateVendorMap(rows, ids);
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toContain("15 of 15 rows still use PLACEHOLDER ids");
  });
});

describe("lookup suggestions", () => {
  const items = [
    { id: "i1", name: "Mango Drink", sku: "SKU001" },
    { id: "i2", name: "Oats (a)", sku: "sku002" },
    { id: "i3", name: "Oats (b)", sku: "SKU002" },
    { id: "i4", name: "No code", sku: null },
  ];

  it("matches on the item's SKU code (case-insensitive) and never guesses by name", () => {
    expect(suggestItems(SKUS, items)).toEqual([
      { skuId: "SKU001", itemId: "i1", itemName: "Mango Drink", ambiguousItems: [] },
      { skuId: "SKU002", itemId: null, itemName: null, ambiguousItems: [items[1], items[2]] }, // two items share the code
      { skuId: "SKU003", itemId: null, itemName: null, ambiguousItems: [] },
    ]);
  });

  it("reports matched, ambiguous and missing SKUs in plain text", () => {
    const text = formatLookupReport({ vendors: [{ id: "v1", name: "Beverage Co" }], itemCount: 4, suggestions: suggestItems(SKUS, items) });
    expect(text).toContain("v1  Beverage Co");
    expect(text).toContain("SKU001  ->  i1  (Mango Drink)");
    expect(text).toContain("SKU002  ->  AMBIGUOUS");
    expect(text).toContain('SKU003  ->  NOT FOUND (create an item in Zoho with SKU "SKU003"');
    expect(text).toContain("2 SKU(s) still need a Zoho item.");
  });
});

describe("exchangeGrantCode (the one-time step that yields the refresh token)", () => {
  const args = { dc: "in", clientId: "1000.CLIENTID1234", clientSecret: "SECRETSECRET123456", code: "1000.GRANTCODE.123456" };
  const reply = (json: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;

  it("posts the code to the right accounts server and returns the refresh token", async () => {
    const f = reply({ access_token: "a", refresh_token: "1000.REFRESH.TOKEN", api_domain: "https://www.zohoapis.in" });
    const r = await exchangeGrantCode(args, { fetch: f });
    expect(r).toEqual({ refreshToken: "1000.REFRESH.TOKEN", apiDomain: "https://www.zohoapis.in" });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://accounts.zoho.in/oauth/v2/token");
    expect(init.method).toBe("POST");
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({ grant_type: "authorization_code", client_id: args.clientId, client_secret: args.clientSecret, code: args.code });
  });

  it("explains an expired or used code, without echoing secrets", async () => {
    const err = await exchangeGrantCode(args, { fetch: reply({ error: "invalid_code" }) }).catch((e) => e);
    expect(err.message).toMatch(/wrong, already used or expired.*generate a new one/);
    expect(err.message).toMatch(/ZOHO_DC matches/);
    expect(err.message).not.toContain(args.clientSecret);
  });

  it("rejects an unknown data centre before calling anything", async () => {
    const f = reply({});
    await expect(exchangeGrantCode({ ...args, dc: "mars" }, { fetch: f })).rejects.toThrow(/Unknown data centre "mars"/);
    expect(f).not.toHaveBeenCalled();
  });

  it("a network failure never leaks the secret or code", async () => {
    const f = vi.fn(async () => { throw new Error(`failed for ${args.clientSecret} and ${args.code}`); }) as unknown as typeof fetch;
    const err = await exchangeGrantCode(args, { fetch: f }).catch((e) => e);
    expect(err.message).not.toContain(args.clientSecret);
    expect(err.message).not.toContain(args.code);
  });
});

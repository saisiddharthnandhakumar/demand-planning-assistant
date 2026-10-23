import { describe, expect, it, vi } from "vitest";
import type { ZohoPoPayload } from "@/lib/po/build";
import { createZohoClient, readFallbackPurchaseRate, readZohoRuntime, resolveMode, ZohoError, ZOHO_DOMAINS, type ZohoConfig } from "@/lib/zoho";

const CONFIG: ZohoConfig = { dc: "in", clientId: "1000.CLIENTID123456", clientSecret: "SECRETSECRET123456", refreshToken: "1000.REFRESHTOKEN123456", orgId: "60012345678" };
const PAYLOAD: ZohoPoPayload = {
  vendor_id: "460000000012345",
  reference_number: "10fcb145-052a-49a3-af8b-4e099a2ea551",
  date: "2026-10-23",
  notes: "Prepared by Demand Planning Assistant, approved by Raghav, run 10fcb145",
  line_items: [{ item_id: "460000000099999", quantity: 300 }],
};

type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined };
type Reply = { status?: number; json?: unknown; text?: string; throws?: Error };

/** A fetch that answers from a script and records every call. */
function mockFetch(script: (call: Call, n: number) => Reply) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const body = init?.body === undefined ? undefined : init.body instanceof URLSearchParams ? init.body.toString() : String(init.body);
    const call: Call = { url: String(input), method: init?.method ?? "GET", headers, body };
    calls.push(call);
    const r = script(call, calls.length);
    if (r.throws) throw r.throws;
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const isToken = (c: Call) => c.url.includes("/oauth/v2/token");
const token = (access = "ACCESS-TOKEN-AAAA1111", expires = 3600, extra: object = {}) => ({ json: { access_token: access, api_domain: "https://www.zohoapis.in", token_type: "Bearer", expires_in: expires, ...extra } });
const created = (id = "460000000777777", extra: object = {}) => ({ json: { code: 0, message: "The purchase order has been created.", purchase_order: { purchaseorder_id: id, purchaseorder_number: "PO-00042", status: "draft", ...extra } } });

describe("mode and configuration", () => {
  it("only the exact string 'live' enables live mode: a typo can never send an order", () => {
    expect(resolveMode("live")).toBe("live");
    for (const v of [undefined, "", "dry-run", "LIVE", "Live", " live", "live ", "true", "1", "production"]) expect(resolveMode(v)).toBe("dry-run");
  });

  it("dry-run needs no credentials at all", () => {
    expect(readZohoRuntime({})).toEqual({ mode: "dry-run" });
    expect(readZohoRuntime({ ZOHO_MODE: "dry-run", ZOHO_CLIENT_ID: "x" })).toEqual({ mode: "dry-run" });
  });

  it("live mode lists exactly what is missing", () => {
    const r = readZohoRuntime({ ZOHO_MODE: "live", ZOHO_DC: "in", ZOHO_CLIENT_ID: "id" });
    expect(r).toMatchObject({ mode: "live", ok: false });
    expect(r.mode === "live" && !("config" in r) && r.missing).toEqual(["ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORG_ID"]);
  });

  it("live mode rejects an unknown data centre", () => {
    const r = readZohoRuntime({ ZOHO_MODE: "live", ZOHO_DC: "mars", ZOHO_CLIENT_ID: "a", ZOHO_CLIENT_SECRET: "b", ZOHO_REFRESH_TOKEN: "c", ZOHO_ORG_ID: "d" });
    expect(r.mode === "live" && !("config" in r) && r.missing.join()).toMatch(/unknown data centre "mars"/);
  });

  it("live mode with everything set yields a trimmed, lower-cased config", () => {
    const r = readZohoRuntime({ ZOHO_MODE: "live", ZOHO_DC: " IN ", ZOHO_CLIENT_ID: " a ", ZOHO_CLIENT_SECRET: "b", ZOHO_REFRESH_TOKEN: "c", ZOHO_ORG_ID: "d" });
    expect(r).toEqual({ mode: "live", ok: true, config: { dc: "in", clientId: "a", clientSecret: "b", refreshToken: "c", orgId: "d" } });
  });

  it("knows the data centres, including the India domains from Zoho's docs", () => {
    expect(ZOHO_DOMAINS.in).toMatchObject({ accounts: "https://accounts.zoho.in", api: "https://www.zohoapis.in" });
    expect(ZOHO_DOMAINS.eu.accounts).toBe("https://accounts.zoho.eu");
    expect(ZOHO_DOMAINS["com.au"].accounts).toBe("https://accounts.zoho.com.au");
  });

  it("the fallback purchase rate comes only from configuration and is never invented", () => {
    expect(readFallbackPurchaseRate({})).toBeUndefined();
    expect(readFallbackPurchaseRate({ ZOHO_FALLBACK_PURCHASE_RATE: "" })).toBeUndefined();
    expect(readFallbackPurchaseRate({ ZOHO_FALLBACK_PURCHASE_RATE: "abc" })).toBeUndefined();
    expect(readFallbackPurchaseRate({ ZOHO_FALLBACK_PURCHASE_RATE: "-5" })).toBeUndefined();
    expect(readFallbackPurchaseRate({ ZOHO_FALLBACK_PURCHASE_RATE: "12.5" })).toBe(12.5);
  });
});

describe("creating a draft purchase order (live)", () => {
  it("refreshes a token, then posts the order: exact URLs, headers and body", async () => {
    const m = mockFetch((c) => (isToken(c) ? token() : created()));
    const r = await createZohoClient(CONFIG, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD);

    expect(m.calls).toHaveLength(2);
    const [tokenCall, poCall] = m.calls;
    expect(tokenCall.method).toBe("POST");
    expect(tokenCall.url).toBe("https://accounts.zoho.in/oauth/v2/token");
    expect(tokenCall.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(tokenCall.body))).toEqual({
      grant_type: "refresh_token",
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      refresh_token: CONFIG.refreshToken,
    });

    expect(poCall.method).toBe("POST");
    expect(poCall.url).toBe("https://www.zohoapis.in/inventory/v1/purchaseorders?organization_id=60012345678");
    expect(poCall.headers.Authorization).toBe("Zoho-oauthtoken ACCESS-TOKEN-AAAA1111");
    expect(poCall.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(poCall.body!)).toEqual(PAYLOAD); // exactly what was built: no price added, no status
    expect(r).toMatchObject({ poId: "460000000777777", poNumber: "PO-00042", status: "draft", url: "https://inventory.zoho.in/app/60012345678#/purchaseorders/460000000777777" });
    expect(r.statusWarning).toBeUndefined();
  });

  it("uses the data centre from ZOHO_DC for every domain", async () => {
    const m = mockFetch((c) => (isToken(c) ? token("T-EU-123456", 3600, { api_domain: undefined }) : created()));
    await createZohoClient({ ...CONFIG, dc: "eu" }, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD);
    expect(m.calls[0].url).toBe("https://accounts.zoho.eu/oauth/v2/token");
    expect(m.calls[1].url.startsWith("https://www.zohoapis.eu/inventory/v1/purchaseorders?")).toBe(true);
  });

  it("prefers the api_domain Zoho returns with the token", async () => {
    const m = mockFetch((c) => (isToken(c) ? token("T-1234567", 3600, { api_domain: "https://www.zohoapis.in/" }) : created()));
    await createZohoClient(CONFIG, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD);
    expect(m.calls[1].url.startsWith("https://www.zohoapis.in/inventory/v1/")).toBe(true); // trailing slash tidied
  });

  describe("access tokens", () => {
    it("are reused until they are about to expire", async () => {
      let t = 1_000_000;
      const m = mockFetch((c) => (isToken(c) ? token("T-FIRST-111111", 3600) : created()));
      const client = createZohoClient(CONFIG, { fetch: m.fetch, now: () => t });
      await client.createDraftPurchaseOrder(PAYLOAD);
      t += 30 * 60_000; // 30 minutes later: still valid
      await client.createDraftPurchaseOrder(PAYLOAD);
      expect(m.calls.filter(isToken)).toHaveLength(1);
      t += 40 * 60_000; // 70 minutes after the first: expired (with a 60 s margin)
      await client.createDraftPurchaseOrder(PAYLOAD);
      expect(m.calls.filter(isToken)).toHaveLength(2);
    });

    it("are refreshed once for concurrent callers, not once each", async () => {
      const m = mockFetch((c) => (isToken(c) ? token() : created()));
      const client = createZohoClient(CONFIG, { fetch: m.fetch });
      await Promise.all([client.createDraftPurchaseOrder(PAYLOAD), client.createDraftPurchaseOrder(PAYLOAD), client.listVendors().catch(() => [])]);
      expect(m.calls.filter(isToken)).toHaveLength(1);
    });

    it("a 401 refreshes the token once and retries (the order was not processed)", async () => {
      let issued = 0;
      const m = mockFetch((c) => {
        if (isToken(c)) return token(`T-NUMBER-${++issued}-AAAA`);
        return c.headers.Authorization.includes("T-NUMBER-1") ? { status: 401, json: { code: 57, message: "You are not authorized to perform this operation" } } : created();
      });
      const r = await createZohoClient(CONFIG, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD);
      expect(r.poId).toBe("460000000777777");
      expect(m.calls.filter(isToken)).toHaveLength(2);
      expect(m.calls.filter((c) => !isToken(c))).toHaveLength(2);
    });

    it("two 401s in a row is an auth error, not an endless loop", async () => {
      const m = mockFetch((c) => (isToken(c) ? token() : { status: 401, json: { code: 57, message: "no" } }));
      await expect(createZohoClient(CONFIG, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD)).rejects.toMatchObject({ kind: "auth" });
      expect(m.calls.filter((c) => !isToken(c))).toHaveLength(2);
    });

    it("a refused token request is an auth error that says what to check", async () => {
      const m = mockFetch(() => ({ json: { error: "invalid_client" } }));
      const err = await createZohoClient(CONFIG, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD).catch((e) => e);
      expect(err).toBeInstanceOf(ZohoError);
      expect(err).toMatchObject({ kind: "auth" });
      expect(err.message).toMatch(/invalid_client.*ZOHO_REFRESH_TOKEN/);
      expect(m.calls).toHaveLength(1); // never reached the PO endpoint
    });
  });

  describe("outcomes", () => {
    it("Zoho refusing the order is a definitive rejection with Zoho's own message (safe to retry)", async () => {
      const m = mockFetch((c) => (isToken(c) ? token() : { status: 400, json: { code: 1001, message: "Please enter the purchase_rate for line item 1." } }));
      const err = await createZohoClient(CONFIG, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD).catch((e) => e);
      expect(err).toMatchObject({ kind: "rejected", zohoCode: 1001, httpStatus: 400 });
      expect(err.message).toBe("Please enter the purchase_rate for line item 1.");
    });

    it("HTTP 200 with a non-zero code is also a rejection", async () => {
      const m = mockFetch((c) => (isToken(c) ? token() : { json: { code: 4, message: "Invalid value passed for vendor_id" } }));
      await expect(createZohoClient(CONFIG, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD)).rejects.toMatchObject({ kind: "rejected", zohoCode: 4 });
    });

    it("a server error leaves the outcome unknown, and is NOT retried (a retry could create a duplicate)", async () => {
      const m = mockFetch((c) => (isToken(c) ? token() : { status: 503, text: "<html>Service Unavailable</html>" }));
      await expect(createZohoClient(CONFIG, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD)).rejects.toMatchObject({ kind: "unknown", httpStatus: 503 });
      expect(m.calls.filter((c) => !isToken(c))).toHaveLength(1);
    });

    it("a network failure or timeout after sending leaves the outcome unknown, and is NOT retried", async () => {
      const m = mockFetch((c) => (isToken(c) ? token() : { throws: new Error("fetch failed: ETIMEDOUT") }));
      await expect(createZohoClient(CONFIG, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD)).rejects.toMatchObject({ kind: "unknown" });
      expect(m.calls.filter((c) => !isToken(c))).toHaveLength(1);
    });

    it("success without an order id is unknown, because the order may exist", async () => {
      const m = mockFetch((c) => (isToken(c) ? token() : { json: { code: 0, message: "ok" } }));
      await expect(createZohoClient(CONFIG, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD)).rejects.toMatchObject({ kind: "unknown" });
    });

    it("accepts the alternative response key `purchaseorder`", async () => {
      const m = mockFetch((c) => (isToken(c) ? token() : { json: { code: 0, purchaseorder: { purchaseorder_id: "42", status: "draft" } } }));
      expect((await createZohoClient(CONFIG, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD)).poId).toBe("42");
    });

    it("warns loudly if Zoho ever returns a status other than draft", async () => {
      const m = mockFetch((c) => (isToken(c) ? token() : created("77", { status: "open" })));
      const r = await createZohoClient(CONFIG, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD);
      expect(r.statusWarning).toMatch(/"open" instead of Draft/);
    });
  });

  describe("it can only ever create a draft", () => {
    it("exposes no way to issue, send, submit or approve an order", () => {
      const client = createZohoClient(CONFIG, { fetch: mockFetch(() => ({})).fetch });
      expect(Object.keys(client).sort()).toEqual(["createDraftPurchaseOrder", "listItems", "listVendors"]);
    });

    it("never calls any URL except the token endpoint, POST /purchaseorders, and read-only lists", async () => {
      const m = mockFetch((c) => {
        if (isToken(c)) return token();
        if (c.url.includes("/contacts")) return { json: { code: 0, contacts: [], page_context: { has_more_page: false } } };
        if (c.url.includes("/items")) return { json: { code: 0, items: [], page_context: { has_more_page: false } } };
        return created();
      });
      const client = createZohoClient(CONFIG, { fetch: m.fetch });
      await client.createDraftPurchaseOrder(PAYLOAD);
      await client.listVendors();
      await client.listItems();
      for (const c of m.calls) {
        expect(c.url).not.toMatch(/\/status|\/submit|\/approve|\/issued|\/email|\/sent|\/cancel|\/reject/i);
        if (c.method === "POST") expect(isToken(c) || /\/inventory\/v1\/purchaseorders\?organization_id=/.test(c.url)).toBe(true);
        if (!isToken(c) && c.method === "GET") expect(c.url).toMatch(/\/inventory\/v1\/(contacts|items)\?/);
      }
      expect(m.calls.filter((c) => c.method === "POST" && !isToken(c))).toHaveLength(1);
    });
  });

  describe("secrets never leak", () => {
    it("not even when Zoho echoes them back in an error message", async () => {
      const m = mockFetch((c) => (isToken(c) ? token("ACCESS-TOKEN-LEAKY99") : { status: 400, json: { code: 5, message: `bad token ACCESS-TOKEN-LEAKY99 and refresh ${CONFIG.refreshToken} secret ${CONFIG.clientSecret}` } }));
      const err = await createZohoClient(CONFIG, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD).catch((e) => e);
      for (const secret of ["ACCESS-TOKEN-LEAKY99", CONFIG.refreshToken, CONFIG.clientSecret]) expect(err.message).not.toContain(secret);
      expect(err.message).toContain("[redacted]");
    });

    it("not in network or token errors either", async () => {
      const m = mockFetch((c) => (isToken(c) ? { throws: new Error(`connect failed for client_secret=${CONFIG.clientSecret}`) } : created()));
      const err = await createZohoClient(CONFIG, { fetch: m.fetch }).createDraftPurchaseOrder(PAYLOAD).catch((e) => e);
      expect(err.message).not.toContain(CONFIG.clientSecret);
    });
  });
});

describe("dry-run makes no network call at all", () => {
  it("reading the runtime in dry-run touches nothing, and no client exists to call", () => {
    const spy = vi.fn();
    const original = globalThis.fetch;
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      const rt = readZohoRuntime({ ZOHO_MODE: "dry-run", ZOHO_DC: "in", ZOHO_CLIENT_ID: "a", ZOHO_CLIENT_SECRET: "b", ZOHO_REFRESH_TOKEN: "c", ZOHO_ORG_ID: "d" });
      expect(rt).toEqual({ mode: "dry-run" });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });

  it("creating a client does not itself call the network", () => {
    const m = mockFetch(() => ({}));
    createZohoClient(CONFIG, { fetch: m.fetch });
    expect(m.calls).toHaveLength(0);
  });
});

describe("looking up vendor and item ids (read-only)", () => {
  it("lists vendors across pages", async () => {
    const m = mockFetch((c) => {
      if (isToken(c)) return token();
      const page = new URL(c.url).searchParams.get("page");
      return { json: { code: 0, contacts: [{ contact_id: `c${page}`, contact_name: `Vendor ${page}` }], page_context: { has_more_page: page === "1" } } };
    });
    const vendors = await createZohoClient(CONFIG, { fetch: m.fetch }).listVendors();
    expect(vendors).toEqual([{ id: "c1", name: "Vendor 1" }, { id: "c2", name: "Vendor 2" }]);
    const first = new URL(m.calls[1].url);
    expect(first.pathname).toBe("/inventory/v1/contacts");
    expect(first.searchParams.get("contact_type")).toBe("vendor");
    expect(first.searchParams.get("organization_id")).toBe(CONFIG.orgId);
  });

  it("lists items with their SKU codes", async () => {
    const m = mockFetch((c) => (isToken(c) ? token() : { json: { code: 0, items: [{ item_id: "i1", name: "Mango Drink", sku: "SKU001" }, { item_id: "i2", name: "No sku" }], page_context: { has_more_page: false } } }));
    expect(await createZohoClient(CONFIG, { fetch: m.fetch }).listItems()).toEqual([{ id: "i1", name: "Mango Drink", sku: "SKU001" }, { id: "i2", name: "No sku", sku: null }]);
  });

  it("a failed lookup is a clear error", async () => {
    const m = mockFetch((c) => (isToken(c) ? token() : { status: 400, json: { code: 57, message: "You do not have permission (scope ZohoInventory.contacts.READ)." } }));
    await expect(createZohoClient(CONFIG, { fetch: m.fetch }).listVendors()).rejects.toThrow(/scope ZohoInventory\.contacts\.READ/);
  });
});

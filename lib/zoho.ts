import { redactSecrets } from "@/lib/redact";
import type { ZohoPoPayload } from "@/lib/po/build";

// Zoho Inventory client. Server-only.
//
// What it can do is deliberately small: create a purchase order (which Zoho
// creates as a draft), and read vendors and items so their ids can be looked up.
// There is NO method to issue, send, submit or approve a purchase order, and
// the tests assert that no such URL is ever called.

export type ZohoMode = "dry-run" | "live";

/** Only the exact string "live" enables live mode. Anything else, including a typo, is dry-run. */
export function resolveMode(raw: string | undefined): ZohoMode {
  return raw === "live" ? "live" : "dry-run";
}

interface Domains {
  accounts: string;
  api: string;
  app: string;
}

/**
 * Data-centre domains, keyed by ZOHO_DC. The accounts and India/EU/US API domains
 * are from Zoho's docs; the others follow Zoho's naming and should be checked
 * against the `api_domain` Zoho returns with the token (which is preferred when present).
 */
export const ZOHO_DOMAINS: Record<string, Domains> = {
  com: { accounts: "https://accounts.zoho.com", api: "https://www.zohoapis.com", app: "https://inventory.zoho.com" },
  in: { accounts: "https://accounts.zoho.in", api: "https://www.zohoapis.in", app: "https://inventory.zoho.in" },
  eu: { accounts: "https://accounts.zoho.eu", api: "https://www.zohoapis.eu", app: "https://inventory.zoho.eu" },
  "com.au": { accounts: "https://accounts.zoho.com.au", api: "https://www.zohoapis.com.au", app: "https://inventory.zoho.com.au" },
  jp: { accounts: "https://accounts.zoho.jp", api: "https://www.zohoapis.jp", app: "https://inventory.zoho.jp" },
  ca: { accounts: "https://accounts.zohocloud.ca", api: "https://www.zohoapis.ca", app: "https://inventory.zohocloud.ca" },
  sa: { accounts: "https://accounts.zoho.sa", api: "https://www.zohoapis.sa", app: "https://inventory.zoho.sa" },
  uk: { accounts: "https://accounts.zoho.uk", api: "https://www.zohoapis.uk", app: "https://inventory.zoho.uk" },
};

export interface ZohoConfig {
  dc: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  orgId: string;
}

export type ZohoRuntime =
  | { mode: "dry-run" }
  | { mode: "live"; ok: false; missing: string[] }
  | { mode: "live"; ok: true; config: ZohoConfig };

/**
 * Reads the environment. In dry-run nothing else is needed. In live mode every
 * variable must be present and ZOHO_DC must be a known data centre, otherwise
 * `ok` is false and `missing` says what to fix.
 */
export function readZohoRuntime(env: Record<string, string | undefined> = process.env): ZohoRuntime {
  if (resolveMode(env.ZOHO_MODE) === "dry-run") return { mode: "dry-run" };
  const names = ["ZOHO_DC", "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORG_ID"] as const;
  const missing: string[] = names.filter((n) => !env[n]?.trim());
  const dc = env.ZOHO_DC?.trim().toLowerCase() ?? "";
  if (dc && !ZOHO_DOMAINS[dc]) missing.push(`ZOHO_DC (unknown data centre "${dc}"; use one of ${Object.keys(ZOHO_DOMAINS).join(", ")})`);
  if (missing.length) return { mode: "live", ok: false, missing };
  return {
    mode: "live",
    ok: true,
    config: { dc, clientId: env.ZOHO_CLIENT_ID!.trim(), clientSecret: env.ZOHO_CLIENT_SECRET!.trim(), refreshToken: env.ZOHO_REFRESH_TOKEN!.trim(), orgId: env.ZOHO_ORG_ID!.trim() },
  };
}

/** Optional purchase rate from configuration. Never invented: unset means no price is sent. */
export function readFallbackPurchaseRate(env: Record<string, string | undefined> = process.env): number | undefined {
  const raw = env.ZOHO_FALLBACK_PURCHASE_RATE?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * - rejected: Zoho definitively refused it (nothing was created), so a retry is safe.
 * - unknown: no clear answer (timeout, 5xx, unreadable reply). The order MAY exist in Zoho, so do not blindly retry.
 * - auth: could not get or use an access token.
 */
export class ZohoError extends Error {
  constructor(
    message: string,
    readonly kind: "rejected" | "unknown" | "auth",
    readonly zohoCode?: number,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

export interface CreatedPurchaseOrder {
  poId: string;
  poNumber: string | null;
  /** Link to the order in the Zoho web app (built from a standard pattern; check the first one opens). */
  url: string;
  status: string | null;
  /** Set when Zoho returned a status other than Draft. We never issue orders, so this is surprising and shown loudly. */
  statusWarning?: string;
  raw: unknown;
}

export interface ZohoVendor {
  id: string;
  name: string;
}
export interface ZohoItem {
  id: string;
  name: string;
  sku: string | null;
}

export interface ZohoClient {
  /** Creates a purchase order. Zoho creates it as a draft; this client cannot issue, send or approve it. */
  createDraftPurchaseOrder(payload: ZohoPoPayload): Promise<CreatedPurchaseOrder>;
  listVendors(): Promise<ZohoVendor[]>;
  listItems(): Promise<ZohoItem[]>;
}

type FetchLike = typeof fetch;
const REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_SAFETY_MARGIN_MS = 60_000;

export function createZohoClient(config: ZohoConfig, deps: { fetch?: FetchLike; now?: () => number } = {}): ZohoClient {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const domains = ZOHO_DOMAINS[config.dc];
  const secrets = [config.clientSecret, config.refreshToken, config.clientId];

  let cached: { token: string; apiBase: string; expiresAt: number } | null = null;
  let refreshing: Promise<{ token: string; apiBase: string }> | null = null;
  const safe = (text: string, extra: (string | undefined)[] = []) => redactSecrets(text, [...secrets, cached?.token, ...extra]).slice(0, 500);

  async function refreshAccessToken(): Promise<{ token: string; apiBase: string }> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    });
    let res: Response;
    try {
      res = await doFetch(`${domains.accounts}/oauth/v2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ZohoError(safe(`Could not reach Zoho to get an access token: ${err instanceof Error ? err.message : String(err)}`), "auth");
    }
    const json = (await res.json().catch(() => null)) as { access_token?: string; api_domain?: string; expires_in?: number; error?: string } | null;
    if (!res.ok || !json || json.error || !json.access_token) {
      throw new ZohoError(safe(`Zoho refused the token request (${json?.error ?? `HTTP ${res.status}`}). Check ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN and ZOHO_DC.`), "auth", undefined, res.status);
    }
    const apiBase = (json.api_domain ?? domains.api).replace(/\/+$/, "");
    cached = { token: json.access_token, apiBase, expiresAt: now() + (json.expires_in ?? 3600) * 1000 - TOKEN_SAFETY_MARGIN_MS };
    return { token: cached.token, apiBase };
  }

  /** A valid access token, refreshed when it is about to expire. Concurrent callers share one refresh. */
  async function accessToken(): Promise<{ token: string; apiBase: string }> {
    if (cached && cached.expiresAt > now()) return { token: cached.token, apiBase: cached.apiBase };
    refreshing ??= refreshAccessToken().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  /** One authorised request. If Zoho says the token is invalid (401) it refreshes once and tries again. */
  async function call(method: "GET" | "POST", path: string, query: Record<string, string>, body?: unknown): Promise<{ res: Response; json: Record<string, unknown> | null }> {
    for (let attempt = 0; ; attempt++) {
      const { token, apiBase } = await accessToken();
      const url = `${apiBase}/inventory/v1/${path}?${new URLSearchParams({ ...query, organization_id: config.orgId })}`;
      let res: Response;
      try {
        res = await doFetch(url, {
          method,
          headers: { Authorization: `Zoho-oauthtoken ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        // The request may or may not have reached Zoho. Never retried: a retry could create a second order.
        throw new ZohoError(safe(`No clear answer from Zoho (${err instanceof Error ? err.message : String(err)}). The order may or may not exist.`, [token]), "unknown");
      }
      if (res.status === 401 && attempt === 0) {
        cached = null; // the token was rejected before anything was processed, so retrying is safe
        continue;
      }
      if (res.status === 401) throw new ZohoError("Zoho rejected the access token twice. Check the refresh token and its scopes.", "auth", undefined, 401);
      return { res, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    }
  }

  async function listAll<T>(path: string, key: string, query: Record<string, string>, pick: (row: Record<string, unknown>) => T): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 50; page++) {
      const { res, json } = await call("GET", path, { ...query, page: String(page), per_page: "200" });
      if (!res.ok || !json || (json.code !== undefined && json.code !== 0)) {
        throw new ZohoError(safe(`Zoho could not list ${key}: ${typeof json?.message === "string" ? json.message : `HTTP ${res.status}`}`), "rejected", Number(json?.code) || undefined, res.status);
      }
      for (const row of (json[key] as Record<string, unknown>[] | undefined) ?? []) out.push(pick(row));
      const ctx = json.page_context as { has_more_page?: boolean } | undefined;
      if (!ctx?.has_more_page) break;
    }
    return out;
  }

  return {
    async createDraftPurchaseOrder(payload) {
      const { res, json } = await call("POST", "purchaseorders", {}, payload);
      const code = typeof json?.code === "number" ? json.code : undefined;
      const message = typeof json?.message === "string" ? json.message : undefined;

      if (res.status >= 500) throw new ZohoError(safe(`Zoho had a server problem (HTTP ${res.status}). The order may or may not exist.`), "unknown", code, res.status);
      if (!res.ok || (code !== undefined && code !== 0)) {
        throw new ZohoError(safe(message ?? `Zoho rejected the order (HTTP ${res.status}).`), "rejected", code, res.status);
      }
      // Zoho's docs show the key as `purchase_order`; accept `purchaseorder` too.
      const po = (json?.purchase_order ?? json?.purchaseorder) as Record<string, unknown> | undefined;
      const id = po?.purchaseorder_id;
      if (typeof id !== "string" || !id) {
        throw new ZohoError("Zoho answered success but without an order id, so the order may exist. Check Zoho before retrying.", "unknown", code, res.status);
      }
      const status = typeof po?.status === "string" ? po.status : null;
      return {
        poId: id,
        poNumber: typeof po?.purchaseorder_number === "string" ? po.purchaseorder_number : null,
        url: `${domains.app}/app/${config.orgId}#/purchaseorders/${id}`,
        status,
        statusWarning: status && status.toLowerCase() !== "draft" ? `Zoho returned status "${status}" instead of Draft. This app never issues or sends orders; check the order in Zoho.` : undefined,
        raw: json,
      };
    },

    listVendors: () => listAll("contacts", "contacts", { contact_type: "vendor" }, (r) => ({ id: String(r.contact_id), name: String(r.contact_name ?? r.company_name ?? "") })),
    listItems: () => listAll("items", "items", {}, (r) => ({ id: String(r.item_id), name: String(r.name ?? ""), sku: typeof r.sku === "string" && r.sku ? r.sku : null })),
  };
}
